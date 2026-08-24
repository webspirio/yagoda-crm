import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { allocatePayout, openDebts, productDay, round2, splitPaidAcrossLines } from './calc'
import { buildSeed, DEFAULT_SETTINGS, nextCode, nowTime, TODAY } from './seed'
import type { Commands, DomainSnapshot, Queries, UiState } from './ports'
import type {
  DayExpense,
  ExpensePolicy,
  ISODate,
  Payout,
  PriceRecord,
  Reception,
  Reweigh,
  ReweighLine,
  ReweighStatus,
  Role,
  Route,
  Settings,
  Supplier,
  TareType,
} from './types'

/**
 * Дії, що змінюють лише локальний стан: на сервер не їдуть ніколи. Тому вони НЕ в
 * `ports.ts` — контракт описує те, що синхронізується, а роль і маршрут пристроєві.
 * Без export: інтерфейс, використаний лише у своєму файлі, `deadcode` показав би як
 * мертвий експорт.
 */
interface UiActions {
  setRole(role: Role): void
  setActivePoint(id: string): void
  go(route: Route): void
  setOnline(v: boolean): void
  setWorkDate(d: ISODate): void
}

/**
 * Стор — це in-memory адаптер контракту з `ports.ts`. Композиція перевіряється на
 * компіляції самим `create<State>()`: якщо хтось додасть екшн у стор і забуде в
 * `ports.ts`, або змінить підпис, `tsc` червоний. Це і є весь захист від дрейфу.
 */
type State = DomainSnapshot & UiState & UiActions & Commands & Queries

// Старі ключі лишаються в браузері після перейменування — v2 це вже показав: 450 КБ
// мертвого стану поруч із живими 1,4 МБ, і разом вони підбираються до квоти localStorage
try {
  localStorage.removeItem('yagoda-crm-demo-v2')
  localStorage.removeItem('yagoda-crm-demo-v3')
  localStorage.removeItem('yagoda-crm-demo-v4')
} catch {
  // приватний режим без localStorage — демо однаково працює з пам'яті
}

/** Рядок ISO-дати: parseDate() робить split('-').map(Number) і на будь-чому іншому дає «NaN» у підписах */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Локальний type predicate — саме локальний, і це не стиль. Межа rehydrate зараховує лише
 * звуження, семантику яких видно з AST у ЦЬОМУ файлі: предикат, імпортований з іншого
 * модуля, підтвердити неможливо, тому він не рахувався б перевіркою.
 *
 * Перевіряє рівно те, що ламається без нього: з `surchargeMin/Max = NaN` обидва порівняння
 * в `checkSurcharge()` дають false, отже `ok = true` і БУДЬ-ЯКА Дод. ціна проходить. Це
 * єдиний ключ, де зіпсовані дані ВИМИКАЮТЬ наявну бізнес-перевірку, а не ламають число.
 */
function isSettings(v: unknown): v is Settings {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.surchargeMin === 'number' &&
    Number.isFinite(s.surchargeMin) &&
    typeof s.surchargeMax === 'number' &&
    Number.isFinite(s.surchargeMax)
  )
}

const seed = buildSeed()

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seed,
      settings: { ...DEFAULT_SETTINGS },

      role: 'operator',
      activePointId: 'p1',
      route: { name: 'reception' },
      online: true,
      workDate: TODAY,

      setRole: (role) =>
        set({
          role,
          route: role === 'owner' ? { name: 'dashboard' } : { name: 'reception' },
          activePointId: role === 'owner' ? 'all' : 'p1',
        }),
      setActivePoint: (id) => set({ activePointId: id }),
      go: (route) => set({ route }),
      setOnline: (v) => set({ online: v }),
      setWorkDate: (d) => set({ workDate: d }),

      addSupplier: (s) => {
        const id = `s${get().suppliers.length + 1}_${Math.random().toString(36).slice(2, 6)}`
        const supplier: Supplier = { ...s, id, createdAt: TODAY }
        set((st) => ({ suppliers: [...st.suppliers, supplier] }))
        return supplier
      },

      updateSupplier: (id, patch) =>
        set((st) => ({
          suppliers: st.suppliers.map((s) => (s.id === id ? { ...s, ...patch } : s)),
        })),

      updateTareType: (id, patch) =>
        set((st) => ({
          tareTypes: st.tareTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)),
        })),

      updateSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch } })),

      setPrice: ({ date, pointId, berryId, price, author, reason }) =>
        set((st) => ({
          prices: [
            ...st.prices,
            {
              id: `pr_${Math.random().toString(36).slice(2, 9)}`,
              date,
              pointId,
              berryId,
              price,
              time: nowTime(),
              author,
              reason,
            },
          ],
        })),

      /**
       * Ціна дня загальна: одна цифра на всі активні ПУНКТИ ПРИЙОМУ, далі керівник
       * править окремі (M32). Пише стільки записів, скільки пунктів, — журнал ціни
       * лишається попунктним, бо ключ ціни це (дата, пункт, сорт).
       *
       * Склад НЕ входить свідомо. Він приймає ягоду (M37), але за оптовими цінами —
       * «склад тоже считається як одна прийомка, але тут типа як оптові ціни» (ряд. 545).
       * Наскільки саме вони вищі, клієнт не називала: +8 % у сіді — НАША оцінка, і
       * питання досі відкрите (Q-17). Якби «загальна» писала й на склад, один клік
       * стирав би цю надбавку назавжди, а повертати її довелося б поштучно. Ціну складу
       * керівник ставить окремою клітинкою — доки ми не спитаємо в неї правило.
       */
      setPriceEverywhere: ({ date, berryId, price, author, reason }) =>
        set((st) => ({
          prices: [
            ...st.prices,
            ...st.points
              .filter((p) => p.active && p.kind === 'reception')
              .map((p) => ({
                id: `pr_${Math.random().toString(36).slice(2, 9)}`,
                date,
                pointId: p.id,
                berryId,
                price,
                time: nowTime(),
                author,
                reason,
              })),
          ],
        })),

      priceFor: (date, pointId, berryId) => {
        const list = get()
          .prices.filter((p) => p.date === date && p.pointId === pointId && p.berryId === berryId)
          .sort((a, b) => a.time.localeCompare(b.time))
        return list.length ? list[list.length - 1].price : undefined
      },

      priceHistory: (date, pointId, berryId) =>
        get()
          .prices.filter((p) => p.date === date && p.pointId === pointId && p.berryId === berryId)
          .sort((a, b) => a.time.localeCompare(b.time)),

      addVisit: ({ date, pointId, supplierId, operator, carriedIn, paid, lines }) => {
        const st = get()
        const amounts = lines.map((l) => l.amount)
        const accrued = round2(amounts.reduce((s, a) => s + a, 0))
        const paidToday = round2(Math.min(paid, accrued))
        // the excess can never exceed what is actually open, or a Payout would be
        // written for money that has nothing to close and the till would under-report
        const openTotal = round2(
          openDebts(
            supplierId,
            st.receptions.filter((r) => r.pointId === pointId),
            st.payouts,
          ).reduce((s, o) => s + o.open, 0),
        )
        const paidToPast = round2(Math.min(Math.max(0, paid - accrued), openTotal))
        const perLine = splitPaidAcrossLines(amounts, paidToday)

        const visitId = `v_${Math.random().toString(36).slice(2, 9)}`
        const time = nowTime()
        const codes = st.receptions.map((x) => x.code)

        const created: Reception[] = lines.map((line, i) => {
          const code = nextCode('Ч', codes)
          codes.push(code)
          return {
            ...line,
            id: `r_${Math.random().toString(36).slice(2, 9)}`,
            code,
            date,
            time,
            pointId,
            supplierId,
            paid: perLine[i],
            debt: round2(line.amount - perLine[i]),
            // the carried balance belongs to the visit, so it sits on its first line only
            carriedIn: i === 0 ? round2(carriedIn) : 0,
            visitId,
            operator,
            synced: st.online,
          }
        })

        set({ receptions: [...st.receptions, ...created] })

        // the excess over today's berry closes older balances — FIFO, original dates kept
        const payout =
          paidToPast > 0.009
            ? get().addPayout({
                date,
                pointId,
                supplierId,
                amount: paidToPast,
                operator,
                visitId,
                scopePointId: pointId,
              })
            : undefined

        return { receptions: created, payout }
      },

      addPayout: ({ date, pointId, supplierId, amount, operator, visitId, scopePointId }) => {
        const st = get()
        const scoped = scopePointId
          ? st.receptions.filter((r) => r.pointId === scopePointId)
          : st.receptions
        const open = openDebts(supplierId, scoped, st.payouts)
        const allocations = allocatePayout(amount, open)
        if (!allocations.length) return undefined
        const payout: Payout = {
          id: `pay_${Math.random().toString(36).slice(2, 9)}`,
          code: nextCode('В', st.payouts.map((p) => p.code), 3),
          date,
          time: nowTime(),
          pointId,
          supplierId,
          amount: round2(allocations.reduce((s, a) => s + a.amount, 0)),
          allocations,
          visitId,
          operator,
          synced: st.online,
        }
        set({ payouts: [...st.payouts, payout] })
        return payout
      },

      /* ------------------------- собівартість дня (09 §2.2, §2.3) ------------------------- */

      addReweigh: ({ berryDate, fromPointId, atPointId, operator, lines }) => {
        const st = get()
        const id = `rw_${Math.random().toString(36).slice(2, 9)}`
        // Чернетки як ДОКУМЕНТА не існує (D-5): переважування народжується одразу
        // проведеним. Незбережений чернетковий стан живе у формі на екрані, а не в сторі.
        const status: ReweighStatus = 'posted'
        const built: ReweighLine[] = lines.map((l, i) => ({
          ...l,
          id: `${id}_${i + 1}`,
          order: i + 1,
        }))
        const reweigh: Reweigh = {
          id,
          berryDate,
          fromPointId,
          atPointId,
          // День ЯГОДИ обирає людина (`berryDate`), момент зважування ставить годинник.
          // У демо «сьогодні» — це TODAY: справжня дата пристрою поставила б на квитанцію
          // штамп поза сезоном, і день зведення перестав би сходитись із рештою екранів.
          weighedDate: TODAY,
          weighedTime: nowTime(),
          status,
          lines: built,
          /**
           * ЗНІМОК заповнюється РАЗ, тут, і більше НІКОЛИ не переписується (D-2).
           * Без нього пізня квитанція тихо перепише вчорашню собівартість: цифра, на яку
           * вже подивилися, назавтра інша, і ніхто не може сказати чому — рівно так у
           * їхньому Excel ламався «попередній». Розбіжність показується як I55, вголос.
           */
          snapshot: productDay(berryDate, fromPointId, st.receptions, st.berries).map((r) => ({
            product: r.product,
            kgPoint: r.kgPoint,
            avgPoint: r.avgPoint,
          })),
          operator,
          // Переважування їде в ТУ САМУ чергу, що квитанції: база працює під навісом,
          // інтернет там не кращий, ніж на пункті (09 §2.2)
          synced: st.online,
        }
        set({ reweighs: [...st.reweighs, reweigh] })
        return reweigh
      },

      voidReweigh: (id, reason, operator) => {
        // Порожня причина — нічого не робить: сторно без причини не відрізнити від
        // випадкового кліку, а документ після нього вже не повернути (06 — тільки INSERT)
        if (!reason.trim()) return
        set((st) => ({
          reweighs: st.reweighs.map((r) =>
            r.id === id
              ? {
                  ...r,
                  // I54: документ НЕ зникає — він лишається зі слідом, просто не рахується
                  status: 'voided' as ReweighStatus,
                  voidedDate: TODAY,
                  voidedTime: nowTime(),
                  voidedBy: operator,
                  voidReason: reason,
                }
              : r,
          ),
        }))
      },

      /**
       * ВИТРАТИ ДНЯ НЕ РУХАЮТЬ КАСУ. Жодного `CashMovement`, нічого в `reconcileDay()`,
       * нічого в Z-звіті й розбіжності зміни: це позакасовий реєстр КЕРІВНИКА (09 §2.3).
       * Рядки набирає лише власник, тому в закритті зміни приймальника вони й не з'являються.
       * Якщо касир платить вантажнику з тієї самої готівки — це окреме питання обсягу,
       * а не тихе допущення.
       *
       * Поля `synced` у `DayExpense` немає свідомо: це керівницька дія, вона вимагає онлайну.
       */
      addExpense: ({ date, pointId, label, amount, createdBy, note, kind }) => {
        // I43: рядок «недостача в ягоді» ПОХІДНИЙ — його синтезує costOfDay() щоразу
        // заново, і в стані такого рядка не буває. Параметр kind існує РІВНО для того,
        // щоб ця відмова була перевіряним твердженням, а не обіцянкою в документі.
        if (kind !== undefined && kind !== 'manual') return undefined
        const expense: DayExpense = {
          id: `ex_${Math.random().toString(36).slice(2, 9)}`,
          date,
          pointId,
          kind: 'manual',
          label,
          amount: round2(amount),
          createdBy,
          createdDate: TODAY,
          createdTime: nowTime(),
          note,
        }
        set((st) => ({ expenses: [...st.expenses, expense] }))
        return expense
      },

      /**
       * РОЗШИРЕННЯ ПРОТИ `09 §2.3`: у спеці цієї команди немає, вона додана свідомо.
       * Без неї одруківка керівника незворотна — 13 000 ₴ замість 1 300 ₴ лишаються в
       * собівартості дня назавжди, і екран стає непридатним до роботи.
       */
      removeExpense: (id) =>
        set((st) => ({ expenses: st.expenses.filter((e) => e.id !== id) })),

      /**
       * Upsert по парі (date, pointId): правило розподілу належить ДНЮ, а не глобальній
       * настройці (D-3). Якби воно лишалось настройкою, зміна правила сьогодні переписала
       * б собівартість УСІХ минулих днів — той самий клас тихої помилки, що й D-2.
       */
      setExpensePolicy: (input) =>
        set((st) => ({
          policies: [
            ...st.policies.filter((x) => !(x.date === input.date && x.pointId === input.pointId)),
            input,
          ],
        })),

      syncAll: () =>
        set((st) => ({
          receptions: st.receptions.map((r) => (r.synced ? r : { ...r, synced: true })),
          payouts: st.payouts.map((p) => (p.synced ? p : { ...p, synced: true })),
          reweighs: st.reweighs.map((r) => (r.synced ? r : { ...r, synced: true })),
        })),

      resetDemo: () => {
        const fresh = buildSeed()
        set({
          ...fresh,
          settings: { ...DEFAULT_SETTINGS },
          role: 'operator',
          activePointId: 'p1',
          route: { name: 'reception' },
          online: true,
          workDate: TODAY,
        })
      },
    }),
    {
      // v5: у знімку з'явились `reweighs`, `expenses` і `policies` (09 §2.2/§2.3), а
      // Порічка отримала інший сезон — отже вся послідовність генератора інша. Причина та
      // сама, що вже записана для v4 і v3: старий стан має форму, якої більше немає, тому
      // скидаємо, а не міграємо. Без бампа браузер, який уже відкривав демо, віддав би зі
      // свого v4 стан БЕЗ переважувань — і «Собівартість дня» показала б порожній аркуш
      // саме на тому екрані, заради якого фаза й робилась.
      name: 'yagoda-crm-demo-v5',
      version: 5,
      migrate: () => undefined,
      partialize: (s) => ({
        suppliers: s.suppliers,
        prices: s.prices,
        tareTypes: s.tareTypes,
        receptions: s.receptions,
        payouts: s.payouts,
        reweighs: s.reweighs,
        expenses: s.expenses,
        policies: s.policies,
        settings: s.settings,
        role: s.role,
        activePointId: s.activePointId,
        online: s.online,
        workDate: s.workDate,
      }),
      /**
       * ЄДИНА НЕДОВІРЕНА МЕЖА ЦЬОГО ЗАСТОСУНКУ. Сервера немає, HTTP-обробника немає — тож
       * «валідація на вході» означає рівно це місце: JSON із localStorage, який іде прямо
       * в `openDebts()`, `round2()` і `costOfDay()`. Правити його в devtools може будь-хто,
       * і зіпсований масив тут ламається не гучно, а ТИХО: рядок замість `debt` стає 0, і
       * залишок постачальника просто зникає з екрана.
       *
       * Чому саме `merge`, а не `onRehydrateStorage`: `merge` отримує САМЕ збережений
       * payload і повертає злитий стан — це і є справжня межа. `onRehydrateStorage`
       * викликається до гідрації і повертає колбек, тобто перевірка в ньому стоїть на крок
       * пізніше, ніж дані вже потрапили в стор.
       *
       * Кожне звуження нижче падає НЕ в порожнечу, а в значення зі свіжого сіду: краще
       * показати демо-дані, ніж напівзламаний стан, у якому половина сум зникла мовчки.
       *
       * ЧОМУ ТУТ GUARD НА ПОРОЖНІЙ PAYLOAD. zustand 5.0.14 кличе `options.merge`
       * **безумовно** (`node_modules/zustand/esm/middleware.mjs:417`), а коли в сховищі
       * нічого немає, повертає `[false, void 0]` (`:409`) і передає сюди `undefined`. Без
       * цього guard-а перший же рядок (`p.suppliers`) кидав `TypeError` — тобто на **свіжому
       * браузері** і на **кожному бампі версії персисту** (`migrate: () => undefined` — це
       * повний пересід, `09 §8.1`, і він теж дає тут `undefined`) не виконувалося НІ ОДНЕ з
       * 13 звужень нижче. І сталося б це безслідно: `.catch` на `:433` віддає помилку в
       * `postRehydrationCallback`, якого ми не даємо (`onRehydrateStorage` не оголошений),
       * тому вона зникала — ні в консолі, ні в UI, а `ratchet:persist` при цьому зелений.
       * Видимої поломки не було лише тому, що стан і так дорівнював свіжому сіду.
       *
       * ФОРМА GUARD-А НЕ ДОВІЛЬНА — це дефолт параметра (`persisted = {}`), а НЕ
       * `const p = (persisted ?? {}) as …`. `chainOf()` у
       * `scripts/verify/ratchets/persist-boundary.mjs:110-133` розкручує лише `as`, `!` і
       * дужки, але не `??`: через `??` корінь ланцюжка перестає бути параметром `merge`,
       * `p` більше не зараховується його псевдонімом — і чекер перестає бачити ВСІ 13
       * звужень нижче. Зміряно: `??` дає 13 рядків «НОВИЙ НЕЗАХИЩЕНИЙ КЛЮЧ», тобто
       * «виправлення» межі вимкнуло б перевірку самої межі. З дефолтом параметра псевдонім
       * лишається видимим, а кожне звуження при порожньому payload штатно віддає `current`
       * — рівно те, що обіцяє абзац вище.
       * `null` ловиться окремим рядком: дефолт параметра зривається тільки на `undefined`.
       */
      merge: (persisted = {}, current) => {
        if (persisted === null) return { ...current }
        const p = persisted as Record<string, unknown>
        return {
          ...current,
          // довідник для пікера: чужа форма дає битий список вибору, у гроші не входить
          suppliers: Array.isArray(p.suppliers) ? (p.suppliers as Supplier[]) : current.suppliers,
          // гроші опосередковано: priceFor() сортує через a.time.localeCompare(b.time),
          // і не-рядок у полі time — це TypeError під час рендеру «Цін дня»
          prices: Array.isArray(p.prices) ? (p.prices as PriceRecord[]) : current.prices,
          // найтихіше з усіх: tareWeight() множить t.weight * l.count, рядкова вага дає
          // NaN, round2() робить із нього 0 — тара зникає, і все брутто йде в чисту вагу
          tareTypes: Array.isArray(p.tareTypes) ? (p.tareTypes as TareType[]) : current.tareTypes,
          // гроші: масив іде прямо в openDebts()/reconcileDay()/costOfDay()
          receptions: Array.isArray(p.receptions)
            ? (p.receptions as Reception[])
            : current.receptions,
          // гроші й найгостріше: openDebts() ітерує p.allocations без перевірки — не масив
          // означає TypeError просто під час рендеру картки постачальника
          payouts: Array.isArray(p.payouts) ? (p.payouts as Payout[]) : current.payouts,
          // гроші: costOfDay() ітерує r.lines і r.snapshot, і саме звідти береться kgBase
          reweighs: Array.isArray(p.reweighs) ? (p.reweighs as Reweigh[]) : current.reweighs,
          // гроші: Σ manual — це половина пулу розподілу
          expenses: Array.isArray(p.expenses) ? (p.expenses as DayExpense[]) : current.expenses,
          policies: Array.isArray(p.policies) ? (p.policies as ExpensePolicy[]) : current.policies,
          settings: isSettings(p.settings) ? p.settings : current.settings,
          // не гроші, але невідомий рядок лишає інтерфейс ні в тому, ні в тому режимі:
          // Shell малює навігацію приймальника, а перевірки власника не застосовуються
          role:
            typeof p.role === 'string' && (p.role === 'operator' || p.role === 'owner')
              ? p.role
              : current.role,
          // невідомий id тихо перекидає прийомку на першу точку (ReceptionPage.tsx: ?? points[0]),
          // а книга кожної точки окрема — гроші опиняються в чужому звіті дня без жодного знаку
          activePointId:
            typeof p.activePointId === 'string' ? p.activePointId : current.activePointId,
          // впливає лише на прапорець synced нових записів; не-булеве дає truthy/falsy без слідів
          online: typeof p.online === 'boolean' ? p.online : current.online,
          workDate:
            typeof p.workDate === 'string' && ISO_DATE.test(p.workDate)
              ? p.workDate
              : current.workDate,
        }
      },
    },
  ),
)

/* ------------------------- selectors ------------------------- */

export function useScope() {
  const role = useStore((s) => s.role)
  const activePointId = useStore((s) => s.activePointId)
  return { role, activePointId, allPoints: role === 'owner' && activePointId === 'all' }
}

export function scopedReceptions(receptions: Reception[], pointId: string) {
  return pointId === 'all' ? receptions : receptions.filter((r) => r.pointId === pointId)
}

export function scopedPayouts(payouts: Payout[], pointId: string) {
  return pointId === 'all' ? payouts : payouts.filter((p) => p.pointId === pointId)
}

/**
 * Черга на відправку. Переважування рахуються поряд із квитанціями й виплатами (09 §2.2):
 * база працює під навісом, і документ, зроблений там без зв'язку, мусить бути видно в
 * лічильнику так само, як квитанцію з пункту. У `DayExpense` поля `synced` немає свідомо —
 * це керівницька дія, вона вимагає онлайну.
 */
export function pendingCount(receptions: Reception[], payouts: Payout[], reweighs: Reweigh[]) {
  return (
    receptions.filter((r) => !r.synced).length +
    payouts.filter((p) => !p.synced).length +
    reweighs.filter((r) => !r.synced).length
  )
}
