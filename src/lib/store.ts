import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  allocateCrateReturn,
  allocatePayout,
  checkBerryPayout,
  checkCrateTransfer,
  cashStanding,
  checkCrateIssue,
  checkCrateRefund,
  checkCrateReturn,
  crateBalance,
  crateIssueMode,
  crateRefund,
  crateShipmentDraft,
  crateStanding,
  openDebts,
  productDay,
  round2,
  shiftDiscrepancy,
  shiftStatusFor,
  splitPaidAcrossLines,
} from './calc'
import {
  actorName,
  canActOnPoint,
  roleOf,
  scopeAfterSignIn,
  sessionUser,
} from './auth'
import { authenticate } from './auth-mock'
import {
  buildSeed,
  DEFAULT_SETTINGS,
  nextCode,
  nowTime,
} from './seed'
import type { AuthCommands, AuthState, Commands, DomainSnapshot, Queries, UiState } from './ports'
import type {
  CashCount,
  CashFloat,
  CrateAllotment,
  CrateIssue,
  CrateReturn,
  CrateShipment,
  DayExpense,
  ExpensePolicy,
  ISODate,
  Payout,
  PointId,
  PriceRecord,
  Reception,
  Reweigh,
  ReweighLine,
  ReweighStatus,
  Role,
  Route,
  Session,
  Settings,
  Shift,
  Supplier,
  TareType,
  Transfer,
  User,
} from './types'

/**
 * Дії, що змінюють лише локальний стан: на сервер не їдуть ніколи. Тому вони НЕ в
 * `ports.ts` — контракт описує те, що синхронізується, а роль і маршрут пристроєві.
 * Без export: інтерфейс, використаний лише у своєму файлі, `deadcode` показав би як
 * мертвий експорт.
 */
interface UiActions {
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
type State = DomainSnapshot & UiState & AuthState & UiActions & Commands & Queries & AuthCommands

// Старі ключі лишаються в браузері після перейменування — v2 це вже показав: 450 КБ
// мертвого стану поруч із живими 1,4 МБ, і разом вони підбираються до квоти localStorage
try {
  localStorage.removeItem('yagoda-crm-demo-v2')
  localStorage.removeItem('yagoda-crm-demo-v3')
  localStorage.removeItem('yagoda-crm-demo-v4')
  localStorage.removeItem('yagoda-crm-demo-v5')
} catch {
  // приватний режим без localStorage — демо однаково працює з пам'яті
}

/** Рядок ISO-дати: parseDate() робить split('-').map(Number) і на будь-чому іншому дає «NaN» у підписах */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
/** Годинник сесії: `startedTime` друкується в сайдбарі, і «сімнадцята година» дала б там сміття */
const CLOCK_TIME = /^\d{2}:\d{2}$/

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

/**
 * Форма сесії на межі rehydrate. Локальний навмисно — та сама причина, що в `isSettings`:
 * межа зараховує лише звуження, семантику яких видно з AST у цьому файлі.
 *
 * Час перевіряється форматом, а не лише типом: `startedTime` друкується в шапці, і рядок
 * «сімнадцята година» дав би там сміття замість «07:10».
 */
function isSession(v: unknown): v is Session {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  return (
    typeof s.userId === 'string' &&
    s.userId !== '' &&
    typeof s.startedDate === 'string' &&
    ISO_DATE.test(s.startedDate) &&
    typeof s.startedTime === 'string' &&
    CLOCK_TIME.test(s.startedTime)
  )
}

/*
 * День, з якого ведеться касова книга, приходить ОДНИМ примірником — зі знімка,
 * `config.cashBookFrom`. Це ПАРАМЕТР рушія, а не константа всередині нього (`21 §3.5`):
 * `cashStanding()` про демо-дані не знає нічого, рівно як `crateShipmentDraft()` не знає,
 * який `tareId` вважається ящиком. Другий примірник тут був би тихою розбіжністю: інша
 * дата — інший залишок на екрані, ніж той, з якого сід зробив `CashCount`.
 */

/** Той самий хвіст id, що вже стоїть у `addVisit`/`addPayout`; винесений, бо тепер його 12 */
const rid = () => Math.random().toString(36).slice(2, 9)

/**
 * Склад наділу точки на дату. Читає ЛИШЕ знімок — тому й типізований `DomainSnapshot`, а не
 * `State`: команда не має права підмішати сюди рольовий стан пристрою.
 */
function standingOf(st: DomainSnapshot, pointId: PointId, date: ISODate) {
  return crateStanding({
    pointId,
    date,
    allotments: st.crateAllotments,
    issues: st.crateIssues,
    returns: st.crateReturns,
    shipments: st.crateShipments,
    transfers: st.transfers,
  })
}

/** Каса точки на дату: дві книги в одній шухляді (`21 §3.5`). Та сама згортка, що на екрані. */
function cashOf(st: DomainSnapshot, pointId: PointId, date: ISODate) {
  return cashStanding({
    pointId,
    date,
    openedOn: st.config.cashBookFrom,
    floats: st.cashFloats,
    receptions: st.receptions,
    payouts: st.payouts,
    transfers: st.transfers,
    issues: st.crateIssues,
    returns: st.crateReturns,
  })
}

/**
 * Перехід переказу в новий стан. Три команди — «Прийняв», «Не сходиться» і сторно —
 * відрізняються лише полями, які дописують; спільне в них головне: перехід дозволений ЛИШЕ
 * з перелічених станів, і документ ЗАМІНЮЄТЬСЯ новим обʼєктом, а не мутується на місці.
 *
 * Тип статусу береться як `Transfer['status']`: окремого експортованого типу немає навмисно —
 * `TransferStatus` у `types.ts` локальний, бо імпортера в нього досі немає.
 */
function transferTransition(
  list: Transfer[],
  id: string,
  from: Transfer['status'][],
  patch: Partial<Transfer>,
): { list: Transfer[]; doc: Transfer } | undefined {
  const found = list.find((t) => t.id === id)
  if (!found || !from.includes(found.status)) return undefined
  const doc: Transfer = { ...found, ...patch }
  return { list: list.map((t) => (t === found ? doc : t)), doc }
}

const seed = buildSeed()

/*
 * Бізнес-дата й підпис керівника читаються ЗІ ЗНІМКА, переданого параметром, а не з
 * `seed.ts` і не з модульного синглтона. Раніше адаптер брав `TODAY` і `OWNER` прямо з
 * фікстури демо-даних; коли ті самі факти переїхали у `config` і `users`, два джерела
 * одного факту розійшлися б тихо — а розходяться тут дата документа й підпис під ним,
 * тобто рівно те, чого ніхто не перечитує.
 *
 * ЧОМУ ПАРАМЕТР, А НЕ `useStore.getState()`. Перша версія цих двох читала синглтон і
 * працювала — але працювала ВИПАДКОВО. `create(persist(…))` виконує і початковий
 * обʼєкт стану, і `merge` ДО того, як `useStore` присвоєний, тому будь-яке майбутнє
 * звуження в `merge`, якому знадобиться бізнес-дата, кидало б `ReferenceException` на
 * ПЕРШОМУ відкритті у свіжому браузері — на шляху, який smoke не проходить ніколи (він
 * щоразу починає з порожнім localStorage). Друга, менш екзотична шкода була видна одразу:
 * `issueCrates` в одному рядку читав дату через синглтон, а `crateTareId` — через `st`,
 * тобто той самий факт двома способами в одній функції. Тепер форма та сама, що вже мають
 * `standingOf(st, …)` і `cashOf(st, …)`: знімок приходить явно, і команда не має чим
 * підмішати сюди стан іншого примірника стора.
 */
const todayOf = (st: DomainSnapshot): ISODate => st.config.businessToday

/** Людина, яка діє. ОДИН спосіб дізнатися це в усьому сторі. */
const actorOf = (st: State) => sessionUser(st.users, st.session)
/** Підпис. `null` означає «немає кого підписати» — команда мусить відмовити. */
const signOf = (st: State) => actorName(st.users, st.session)
/**
 * Право діяти на цій точці ПЛЮС підпис одним викликом: два окремі виклики дали б два шанси
 * забути один.
 *
 * ⚠️ ЦЕ ПЕРЕВІРКА ТОЧКИ, І ВОНА НІКОЛИ НЕ ЗАМІНЯЄ ПЕРЕВІРКУ РОЛІ. `canActOnPoint(owner, …)`
 * завжди `true`, тому «замінити гейт ролі на `actorAt`» означало б скасувати правило.
 */
const actorAt = (st: State, pointId: PointId): { user: User; by: string } | null => {
  const user = actorOf(st)
  if (!user || !canActOnPoint(user, pointId)) return null
  return { user, by: user.name }
}

/**
 * Штамп сторно: дата й підпис одним обʼєктом. Підпис — з СЕСІЇ, а не `ownerName(st.users)`:
 * той віддавав назву ролі кожному, хто дотягнувся до команди, тобто документ стверджував,
 * що його сторнував «Керівник», навіть коли жодного входу не було. `null` тут означає
 * «немає кого підписати», і три виклики зобовʼязані на ньому відмовити.
 */
const stampOf = (st: State): { date: ISODate; by: string } | null => {
  const by = signOf(st)
  if (!by) return null
  return { date: st.config.businessToday, by }
}

/**
 * Спільне тіло трьох сторно ящикових документів: роль, непорожня причина, слід замість
 * видалення. Винесене, бо три однакові команди — це три місця, де можна забути гейт.
 */
function voidCrateDoc<T extends { id: string; voidedDate?: ISODate }>(
  /* `Role | null` — бо ролі без сесії не існує. Перевірка `!== 'owner'` і так відсіює `null`,
     тому окремої гілки «немає сесії» тут не треба: найсуворіше і є правильним. */
  role: Role | null,
  list: T[],
  id: string,
  reason: string,
  /** Штамп і підпис — ПАРАМЕТРИ: у знімку вони одні, і братися мусять звідти, а не з фікстури */
  mark: { date: ISODate; by: string },
): { list: T[]; doc: T } | undefined {
  if (role !== 'owner') return undefined
  if (!reason.trim()) return undefined
  const found = list.find((d) => d.id === id)
  if (!found || found.voidedDate) return undefined
  const doc: T = { ...found, voidedDate: mark.date, voidedBy: mark.by, voidReason: reason }
  return { list: list.map((d) => (d === found ? doc : d)), doc }
}

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seed,
      settings: { ...DEFAULT_SETTINGS },

      /*
       * Стартовий стан — БЕЗ сесії, і це не деталь: `session: null` означає екран входу
       * (`App.tsx`), а не «приймальник за замовчуванням». Поля `role` тут більше немає —
       * роль читається з реєстру по сесії (`auth.ts:roleOf`).
       *
       * `activePointId: 'p1'` лишається, але вже нікого не пускає: без сесії жодна команда
       * не проходить, а після входу точку ставить `scopeAfterSignIn(user)` — з облікового
       * запису людини, а не літералом.
       */
      session: null,
      activePointId: 'p1',
      route: { name: 'reception' },
      online: true,
      workDate: seed.config.businessToday,

      signIn: ({ login, secret }) => {
        const st = get()
        const res = authenticate(st.users, login, secret, {
          date: st.config.businessToday,
          time: nowTime(),
        })
        if (!res.ok) return res
        const user = sessionUser(st.users, res.session)
        if (!user) return { ok: false, reason: 'no-account' }
        set({ session: res.session, ...scopeAfterSignIn(user) })
        return res
      },

      /**
       * Вихід НЕ чіпає документів: «змінюється тільки там… хто за компʼютером», решта
       * роботи точки лишається на місці (дзвінок №4, ряд. 570). Маршрут скидається, бо
       * маршрут керівника під наступним приймальником був би порожнім екраном.
       */
      signOut: () => set({ session: null, route: { name: 'reception' } }),

      /**
       * Точка приймальника — з облікового запису (`M12`, `C9`, `06 §5.2 G16`). Перевірка
       * стоїть ТУТ, а не лише в тому, що селектора немає на екрані: «сховати пункт меню
       * недостатньо» (`03 §UC-29 п.1`).
       */
      setActivePoint: (id) => {
        const user = actorOf(get())
        if (!user || (user.role === 'operator' && id !== user.pointId)) return
        set({ activePointId: id })
      },
      go: (route) => set({ route }),
      setOnline: (v) => set({ online: v }),
      setWorkDate: (d) => set({ workDate: d }),

      addSupplier: (s) => {
        const id = `s${get().suppliers.length + 1}_${Math.random().toString(36).slice(2, 6)}`
        const supplier: Supplier = { ...s, id, createdAt: todayOf(get()) }
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

      /**
       * Ціну дня ставить ЛИШЕ керівник (`22-tz`, ряд. 671: «буде виправлено»). До фази 4
       * гейта не було зовсім, а підпис приходив параметром — тобто екран приймальника
       * підписував запис журналу рядком «Приймальник» і ціна мінялася.
       *
       * Підпис виводиться ТУТ, зі своєї ж сесії: приймати його від викликача означало б
       * дозволити документ із підписом, якого ніхто не ставив.
       */
      setPrice: ({ date, pointId, berryId, price, reason }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const by = signOf(st)
        if (!by) return undefined
        const doc: PriceRecord = {
          id: `pr_${rid()}`,
          date,
          pointId,
          berryId,
          price,
          time: nowTime(),
          author: by,
          reason,
        }
        set({ prices: [...st.prices, doc] })
        return doc
      },

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
      setPriceEverywhere: ({ date, berryId, price, reason }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const by = signOf(st)
        if (!by) return undefined
        // Переписано з `set((st) => …)` на `get()` + `set({…})` не для стилю: колбек
        // `set()` не віддає значення викликачеві, а команда тепер мусить повернути самі
        // записи — інакше форма не відрізнить відмову від успіху.
        const docs: PriceRecord[] = st.points
          .filter((p) => p.active && p.kind === 'reception')
          .map((p) => ({
            id: `pr_${rid()}`,
            date,
            pointId: p.id,
            berryId,
            price,
            time: nowTime(),
            author: by,
            reason,
          }))
        set({ prices: [...st.prices, ...docs] })
        return docs
      },

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

      addVisit: ({ date, pointId, supplierId, carriedIn, paid, lines }) => {
        const st = get()
        // Прийомка — робота ТОЧКИ: приймальник пише лише на своїй, керівник на будь-якій
        // (`M12`, `C9`). Підпис під квитанцією — імʼя цієї людини, а не назва точки.
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
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
        // G12 / I58 на візиті: із шухляди виходить `paidToday + paidToPast`, і обидва —
        // готівка за ягоду. Перевіряємо СУМУ, а не доданки: людині байдуже, яка її частина
        // закриває сьогоднішню ягоду, а яка давній залишок — шухляда одна.
        const cashLeaving = round2(paidToday + paidToPast)
        // Відмова — `undefined`, як у 18 сусідніх команд. Порожній масив тут був ПРАВДИВИМ
        // обʼєктом, тому `if (!res)` на нього не спрацьовував — і єдиний виклик цим і
        // скористався: тост «Прийнято …» друкувався на відмові.
        if (cashLeaving > 0 && !checkBerryPayout(cashLeaving, cashOf(st, pointId, date).berryCash).ok) {
          return undefined
        }
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
            operator: actor.by,
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
                visitId,
                scopePointId: pointId,
              })
            : undefined

        return { receptions: created, payout }
      },

      addPayout: ({ date, pointId, supplierId, amount, visitId, scopePointId }) => {
        const st = get()
        // Гроші виходять із шухляди ЦІЄЇ точки, тому й право діяти перевіряється на ній.
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // G12 / I58: «У касі 12 400 ₴, ви видаєте 42 500 ₴. Готівки не вистачає.»
        // Впирається саме в касу ЗА ЯГОДУ, а не в суму шухляди: інакше виплата за ягоду
        // з'їла б чужі завдатки за ящики (21 §3.5). До цієї правки функція `checkBerryPayout`
        // існувала, була протестована — і не викликалася звідки, тобто єдиний block на
        // готівку в цій фазі не діяв, а екран лише фарбував мінус червоним постфактум.
        if (!checkBerryPayout(amount, cashOf(st, pointId, date).berryCash).ok) return undefined
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
          operator: actor.by,
          synced: st.online,
        }
        set({ payouts: [...st.payouts, payout] })
        return payout
      },

      /* ------------------------- собівартість дня (09 §2.2, §2.3) ------------------------- */

      /**
       * ⚠️ ГЕЙТ ТУТ — РОЛІ, А НЕ ТОЧКИ, і це навмисно. Переважує керівник на базі
       * (`13 §4 S-20`, дзвінок №4, ряд. 617–621), а `fromPointId` — це пункт, ЗВІДКИ
       * приїхала ягода, тобто для керівника він чужий за визначенням. Точкова перевірка
       * тут відмовляла б у кожному переважуванні; наступний читач, який її «додасть»,
       * зламає весь екран бази.
       */
      addReweigh: ({ berryDate, fromPointId, atPointId, lines }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const by = signOf(st)
        if (!by) return undefined
        const id = `rw_${rid()}`
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
          // У демо «сьогодні» — це `config.businessToday`: справжня дата пристрою поставила б на квитанцію
          // штамп поза сезоном, і день зведення перестав би сходитись із рештою екранів.
          weighedDate: todayOf(st),
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
          operator: by,
          // Переважування їде в ТУ САМУ чергу, що квитанції: база працює під навісом,
          // інтернет там не кращий, ніж на пункті (09 §2.2)
          synced: st.online,
        }
        set({ reweighs: [...st.reweighs, reweigh] })
        return reweigh
      },

      voidReweigh: (id, reason) => {
        const st = get()
        // Порожня причина — нічого не робить: сторно без причини не відрізнити від
        // випадкового кліку, а документ після нього вже не повернути (06 — тільки INSERT)
        if (!reason.trim()) return undefined
        const by = signOf(st)
        if (!by) return undefined
        const found = st.reweighs.find((r) => r.id === id)
        // Раніше `map` по неіснуючому id тихо не робив нічого і команда віддавала `void`:
        // екран друкував «сторновано» так само, як на справжньому сторно.
        if (!found) return undefined
        const doc: Reweigh = {
          ...found,
          // I54: документ НЕ зникає — він лишається зі слідом, просто не рахується
          status: 'voided' as ReweighStatus,
          voidedDate: todayOf(st),
          voidedTime: nowTime(),
          voidedBy: by,
          voidReason: reason,
        }
        set({ reweighs: st.reweighs.map((r) => (r.id === id ? doc : r)) })
        return doc
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
      addExpense: ({ date, pointId, label, amount, note, kind }) => {
        const st = get()
        // Витрата належить парі (день, пункт), тому право діяти перевіряється на пункті.
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
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
          createdBy: actor.by,
          createdDate: todayOf(st),
          createdTime: nowTime(),
          note,
        }
        set({ expenses: [...st.expenses, expense] })
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
       *
       * ⚠️ ЄДИНА КОМАНДА ФАЗИ 4 БЕЗ ГЕЙТА, і це свідомо. Вона віддає `void`, тому відмова
       * була б НЕВИДИМОЮ: форма показала б «збережено», а правило розподілу тихо лишилося
       * б попереднім — гірше за відсутність перевірки. Гейт зʼявиться разом із поверненням
       * значення; це борг `Б2` спеки, а не недогляд цієї фази.
       */
      setExpensePolicy: (input) =>
        set((st) => ({
          policies: [
            ...st.policies.filter((x) => !(x.date === input.date && x.pointId === input.pointId)),
            input,
          ],
        })),

      /* ---------------- ящики і каса як підзвіт (21 §2, §3, §7) ----------------
       * ТІЛЬКИ INSERT (06 §3): жодна з дванадцяти команд нижче не править наявний документ
       * заднім числом. Сторно — новий стан документа зі слідом (`voided*`) або новий
       * документ із `correctionOf`, а не витирання. Причина не теоретична: у файлі клієнтки
       * 60 клітинок «Залишок» набрані руками поверх формули, і 20 з них не сходяться зі
       * своїм же рядком (PART C 3). Документ, який можна переписати, рано чи пізно переписують.
       *
       * ВІДМОВА — це `undefined`, за тим самим правилом, що вже діє в `addPayout` і
       * `addExpense`. Самі ПРАВИЛА відмови лежать у `calc.ts` (`checkCrateIssue`,
       * `checkCrateReturn`, `checkCrateRefund`) і викликаються звідси, а не повторюються:
       * форма покаже текст, стор відмовить у команді — але правило одне на двох.
       */

      setCrateAllotment: ({ pointId, units, effectiveFrom, reason }) => {
        const st = get()
        // `effectiveAt()` порівнює `effectiveFrom` ЛЕКСИКОГРАФІЧНО. Рядок довільної форми
        // або ніколи не стає діючим (і тоді `checkCrateIssue` мовчки відмовляє в кожній
        // видачі), або сортується поперед усього. `ISO_DATE` у цьому файлі вже є.
        if (!ISO_DATE.test(effectiveFrom)) return undefined
        // §7: наділ змінює КЕРІВНИК — «чи може керівник збільшувати доступну кількість
        // ящиків?» (1062). Роль перевіряється тут, а не лише в UI: `setBy` нижче прибитий
        // до підпису керівника, тому без цієї перевірки документ приймальника стверджував би, що його
        // ухвалив керівник — брехня в підписі гірша за відсутність підпису.
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        // Точка перевіряється поверх ролі, а не замість неї: `canActOnPoint(owner, …)`
        // завжди `true`, тому `actorAt` сам по собі керівницьким гейтом не є.
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // Зміна ДІЮЧОГО наділу без причини — це і є те переписане число, від якого рятує
        // історія: «нам треба, щоб було 800» (1062) мусить лишитися в документі. Перший
        // наділ точки причини не потребує — попереднього рівня не було, пояснювати нема чого.
        if (st.crateAllotments.some((a) => a.pointId === pointId) && !reason?.trim()) return undefined
        // Ящик не буває дробовим і не буває відʼємним: таке число мовчки зробило б
        // `onHand` відʼємним, і видача перестала б проходити взагалі, без жодного пояснення.
        if (!Number.isInteger(units) || units < 0) return undefined
        const doc: CrateAllotment = {
          id: `ca_${rid()}`,
          pointId,
          units,
          effectiveFrom,
          setBy: actor.by,
          setDate: st.config.businessToday,
          setTime: nowTime(),
          reason,
        }
        // Старий запис ЛИШАЄТЬСЯ, і баланс не перераховується (UC-35 крок 2): діючий наділ
        // на дату обирає `effectiveAt()` — саме тому це масив, а не поле на точці.
        set({ crateAllotments: [...st.crateAllotments, doc] })
        return doc
      },

      setCashFloat: ({ pointId, amount, effectiveFrom, reason }) => {
        const st = get()
        if (!ISO_DATE.test(effectiveFrom)) return undefined
        // §7: наділ каси теж лише керівник — «фіксована сума на користування» (1146).
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // «технологія з грошима така сама, як з ящиками» (1144) — і правило про причину теж.
        if (st.cashFloats.some((f) => f.pointId === pointId) && !reason?.trim()) return undefined
        // NaN із порожнього поля вводу `round2()` перетворює на 0 (це його свідома межа —
        // краще 0 ₴ на екрані, ніж «NaN ₴» на квитанції). Тут саме тому й потрібна відмова:
        // інакше керівник побачив би наділ 0,00 ₴, якого він не ставив, а «не хватає до
        // наділу» сказало б, що база точці не винна нічого.
        if (!Number.isFinite(amount) || amount < 0) return undefined
        const doc: CashFloat = {
          id: `cf_${rid()}`,
          pointId,
          amount: round2(amount),
          effectiveFrom,
          setBy: actor.by,
          setDate: st.config.businessToday,
          setTime: nowTime(),
          reason,
        }
        set({ cashFloats: [...st.cashFloats, doc] })
        return doc
      },

      issueCrates: ({ pointId, supplierId, units, mode, receiptNo }) => {
        const st = get()
        // Ящики видає той, хто стоїть на цій точці (`§7`): приймальник — на своїй.
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // I62: «на точці зараз 341 порожній ящик — 500 видати нема з чого». `onHand === null`
        // (наділу на цю дату ще не було) теж відмова: видані з такої точки ящики не потрапили
        // б у жоден склад наділу і зникли б з обліку тихо.
        if (!checkCrateIssue(units, standingOf(st, pointId, todayOf(st)).onHand).ok) return undefined
        // Поріг 50 — ПІДСТАВЛЕННЯ, а не заборона (21 §2.3): «ми обираємо, якщо за кошти, ми
        // натискаємо в себе за кошти» (1083). Передане руками перемагає підставлене.
        const chosen = mode ?? crateIssueMode(units)
        const cheshka = st.tareTypes.find((t) => t.id === st.config.crateTareId)
        // Ящик — це ЧЕШКА (рішення Р-1). Якщо її в довіднику немає (а довідник приїжджає з
        // localStorage і його там правлять руками), видача за кошти НЕ мовчить нулем:
        // `depositTaken = 0` при `mode:'deposit'` зробив би нас винними нуль за ящики, за які
        // ми справді взяли гроші, і `I66` читав би саме це поле як «розписку».
        if (chosen === 'deposit' && !cheshka) return undefined
        // ЗНІМОК ціни, а не посилання на довідник: керівник міняє ціну Чешки (06 §6 п. 11), а
        // повернення рахується за тим завдатком, з яким ящики брали (I65).
        // За розписку — РІВНО 0, тому обидва способи рахуються однією формулою (I66).
        const perUnit = chosen === 'deposit' && cheshka ? round2(cheshka.price) : 0
        const doc: CrateIssue = {
          id: `ci_${rid()}`,
          date: todayOf(st),
          time: nowTime(),
          pointId,
          supplierId,
          units,
          mode: chosen,
          depositPerUnit: perUnit,
          depositTaken: round2(units * perUnit),
          // Номер паперу існує лише там, де є папір: за кошти розписки не формують.
          receiptNo: chosen === 'receipt' ? receiptNo : undefined,
          operatorId: actor.by,
        }
        set({ crateIssues: [...st.crateIssues, doc] })
        return doc
      },

      returnCrates: ({ pointId, supplierId, units }) => {
        const st = get()
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // Баланс людини НЕ фільтрується по точці: `crateBalance()` і `openCrateIssues()`
        // ведуть його по ЛЮДИНІ, і фільтр тут зробив би стор і рушій двома різними
        // відповідями на питання «скільки ящиків у цієї людини».
        const balance = crateBalance(supplierId, st.crateIssues, st.crateReturns)
        // I64: «людина брала 20, повернути 25 не може». Ящик «нізвідки» — помилка вводу.
        if (!checkCrateReturn(units, balance.units).ok) return undefined
        // FIFO по її ж видачах, і гроші — за ЗНІМКОМ ціни кожної: «воно автоматично підтягує
        // йому, як та людина брала ящики» (1087). Питати людину не треба, порядок видач каже все.
        const allocations = allocateCrateReturn(units, balance.open)
        const refund = crateRefund(allocations)
        // I59: впирається В КАСУ ЗА ЯЩИКИ і НІКОЛИ в касу за ягоду — «не може бути такого,
        // що зараз коштів немає в касі, ну, ми маємо віддати» (1102). Порожня каса за ягоду
        // цю операцію не блокує: вона сюди навіть не передається.
        if (!checkCrateRefund(refund, cashOf(st, pointId, todayOf(st)).crateCash).ok) return undefined
        const doc: CrateReturn = {
          id: `cr_${rid()}`,
          date: todayOf(st),
          time: nowTime(),
          pointId,
          supplierId,
          units,
          allocations,
          depositRefund: refund,
          operatorId: actor.by,
        }
        set({ crateReturns: [...st.crateReturns, doc] })
        return doc
      },

      postShipment: ({ pointId, date, brokenUnits }) => {
        const st = get()
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // Єдина команда, що приймає дату ззовні. Майбутнє відправлення — не помилка вводу,
        // а документ, який `crateStanding` чесно врахує на ту дату; але дня, якого ще не
        // було, у книзі бути не може.
        if (!ISO_DATE.test(date) || date > todayOf(st)) return undefined
        // Бій — ЄДИНЕ число цієї команди, яке вводить людина: «іменно заламані ящики… треба
        // їм якось виділити строчку» (1117). Нуль валідний — «ламані не кожен день» (993).
        if (!Number.isInteger(brokenUnits) || brokenUnits < 0) return undefined
        // I63: поля вводу для кількості з ягодою не існує в жодної ролі — «не вони мають
        // вносити, а сама програма має вичитати» (1115). Записується ЗНІМОК разом із
        // кількістю квитанцій, які його дали: пізніша квитанція має бути ВИДНА (warn), а не
        // тихо переписати вже відправлений день.
        const draft = crateShipmentDraft({
          date,
          pointId,
          receptions: st.receptions,
          crateTareId: st.config.crateTareId,
        })
        const doc: CrateShipment = {
          id: `cs_${rid()}`,
          date,
          pointId,
          withBerryUnits: draft.withBerryUnits,
          receptionCount: draft.receptionCount,
          brokenUnits,
          operatorId: actor.by,
          postedDate: todayOf(st),
          postedTime: nowTime(),
        }
        set({ crateShipments: [...st.crateShipments, doc] })
        return doc
      },

      sendTransfer: ({ pointId, crates, cash, carrier, correctionOf }) => {
        const st = get()
        // §7: переказ створює КЕРІВНИК — «ви клікаєте: я відправляю цій точці» (1172).
        // Точка може лише прийняти або заявити «не сходиться».
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // Відʼємний переказ — це вилучення каси з точки, документа для якого немає взагалі:
        // прийнятий, він тихо зменшив би `berryCash` і зробив би «не хватає до наділу»
        // більшим, ніж база справді винна.
        if (!Number.isFinite(cash) || cash < 0) return undefined
        // База повертає точці те, що ТРИМАЄ (`atBase`), а не те, чого точці не хватає
        // (`shortfall = inField + atBase`). Різниця не косметична: на Шипинках 04.08 це
        // 264 проти 459 — 195 ящиків лежать у ЛЮДЕЙ і базі не належать. Переказ на 459
        // зробив би `atBase = −195`, `onHand = 800` при 195 у полі, і `checkCrateIssue`
        // дозволив би видати ящики, яких на точці немає.
        if (!checkCrateTransfer(crates, standingOf(st, pointId, todayOf(st)).atBase).ok) return undefined
        const doc: Transfer = {
          id: `tf_${rid()}`,
          date: todayOf(st),
          pointId,
          crates,
          cash: round2(cash),
          carrier,
          sentBy: actor.by,
          sentTime: nowTime(),
          // I68: народжується 'sent' і не рухає НІЧОГО — ні касу, ні наділ, — поки точка не
          // натиснула «Прийняв». «це не півтори години, десь так» (1014): дорога — стан, не аварія.
          status: 'sent',
          correctionOf,
        }
        set({ transfers: [...st.transfers, doc] })
        return doc
      },

      acceptTransfer: (id) => {
        const st = get()
        // §7: «Прийняв» тисне ТОЧКА (1172). Роль перевіряється тут, а не лише у формі —
        // за тим самим правилом, що й `voidTransfer` трьома командами нижче.
        //
        // ⚠️ ГЕЙТ РОЛІ ЛИШАЄТЬСЯ, `actorAt` додається ПОВЕРХ. `canActOnPoint(owner, …)`
        // завжди `true`, тому заміна одного на інше дозволила б керівникові тиснути
        // «Прийняв» за точку — скасувавши `I69` у задачі, яка й робиться заради гейтів.
        if (roleOf(st.users, st.session) !== 'operator') return undefined
        // ЛИШЕ зі 'sent'. Заявлений «не сходиться» переказ прийняти тихо не можна — його
        // закриває керівник новим документом (UC-36); а повторне «Прийняв» по вже прийнятому
        // додало б ті самі гроші в касу вдруге.
        const target = st.transfers.find((t) => t.id === id)
        if (!target) return undefined
        // Підпис — імʼя того, хто НАТИСНУВ, і саме тому точку перевіряємо по документу:
        // раніше тут стояв `signerFor(users, target.pointId)`, тобто підпис ЧУЖОЇ точки —
        // приймальник Шипинок міг прийняти переказ на Попівці, а в документі стояло імʼя
        // приймальника Попівців. Тепер такий виклик просто не проходить.
        const actor = actorAt(st, target.pointId)
        if (!actor) return undefined
        const next = transferTransition(st.transfers, id, ['sent'], {
          status: 'accepted',
          acceptedBy: actor.by,
          acceptedDate: todayOf(st),
          acceptedTime: nowTime(),
        })
        if (!next) return undefined
        set({ transfers: next.list })
        return next.doc
      },

      disputeTransfer: (id, { reportedCrates, reportedCash, note }) => {
        const st = get()
        // Гейт ролі лишається, точка додається поверх — та сама причина, що в `acceptTransfer`.
        if (roleOf(st.users, st.session) !== 'operator') return undefined
        const target = st.transfers.find((t) => t.id === id)
        if (!target || !actorAt(st, target.pointId)) return undefined
        // Заявка «не сходиться» зупиняє гроші так само, як сторно, — і заслуговує того
        // самого правила: без причини її не відрізнити від випадкового кліку.
        if (!note.trim()) return undefined
        if (!Number.isInteger(reportedCrates) || reportedCrates < 0) return undefined
        if (!Number.isFinite(reportedCash) || reportedCash < 0) return undefined
        // «Не сходиться» — це ЗАЯВКА: `reportedCrates`/`reportedCash` не входять у жодну
        // формулу (I69), каса й наділ не рухаються взагалі. Розбіжність закриває керівник.
        const next = transferTransition(st.transfers, id, ['sent'], {
          status: 'disputed',
          reportedCrates,
          reportedCash,
          disputeNote: note,
        })
        if (!next) return undefined
        set({ transfers: next.list })
        return next.doc
      },

      voidTransfer: (id, reason) => {
        const st = get()
        // I69: «щоб керівник просто змінював, щоб не вони, бо то ужас буде» (1185). Роль
        // перевіряється САМЕ тут, а не лише в UI: це block-інваріант, а місце block-ів у
        // цьому проєкті — рушій і стор, форма лише малює текст.
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        // Підпис виводиться тут, а не приходить параметром. Правило вже було записане в
        // `acceptTransfer` («приймати рядок від викликача означало б дозволити документ із
        // підписом, якого ніхто не ставив») і в тому ж файлі порушувалося: `voidTransfer`
        // брала `by` третім аргументом. Той самий клас дефекту, що описаний у `VisitLineInput`.
        const by = signOf(st)
        if (!by) return undefined
        // Порожня причина — no-op, як у `voidReweigh`: сторно без причини не відрізнити від
        // випадкового кліку, а документ після нього вже не повернути.
        if (!reason.trim()) return undefined
        const next = transferTransition(st.transfers, id, ['sent', 'accepted', 'disputed'], {
          // Документ НЕ зникає — він лишається зі слідом і просто не рахується (06 §3)
          status: 'void',
          voidedDate: todayOf(st),
          voidedBy: by,
          voidReason: reason,
        })
        if (!next) return undefined
        set({ transfers: next.list })
        return next.doc
      },

      /**
       * СТОРНО ящикових документів. `§7`: «Сторнувати будь-який документ цих фаз —
       * керівник, так, із причиною», і `UC-21 A4` прямо будує на цьому вихід із подвійного
       * відправлення. До цієї правки поля `voidedDate/voidedBy/voidReason` існували в типах,
       * рушій по них фільтрував, тести їх покривали — а СТАВИТИ їх було нічим: помилково
       * вписаний бій «20» замість «2» або видача 30 замість 3 лишалися в обліку назавжди.
       *
       * Документ не зникає — він лишається зі слідом і просто не рахується (`06 §3`).
       */
      voidCrateIssue: (id, reason) => {
        const st = get()
        const mark = stampOf(st)
        if (!mark) return undefined
        const next = voidCrateDoc(roleOf(st.users, st.session), st.crateIssues, id, reason, mark)
        if (!next) return undefined
        set({ crateIssues: next.list })
        return next.doc
      },
      voidCrateReturn: (id, reason) => {
        const st = get()
        const mark = stampOf(st)
        if (!mark) return undefined
        const next = voidCrateDoc(roleOf(st.users, st.session), st.crateReturns, id, reason, mark)
        if (!next) return undefined
        set({ crateReturns: next.list })
        return next.doc
      },
      voidCrateShipment: (id, reason) => {
        const st = get()
        const mark = stampOf(st)
        if (!mark) return undefined
        const next = voidCrateDoc(roleOf(st.users, st.session), st.crateShipments, id, reason, mark)
        if (!next) return undefined
        set({ crateShipments: next.list })
        return next.doc
      },

      /**
       * Зміна, що пішла до керівника з розбіжністю, мусить мати вихід. `§7` дає керівникові
       * право «закрити зміну з розбіжністю», але команди для цього не було: `closeShift`
       * вимагає `status === 'open'`, тому `awaiting_explanation` був глухим кутом назавжди.
       *
       * Розбіжність при цьому НЕ зникає і не підганяється (`06 §7.5` п. 4) — вона лишається
       * в документі; додається лише пояснення й підпис того, хто зміну закрив.
       */
      settleShift: (shiftId, explanation) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'owner') return undefined
        const by = signOf(st)
        if (!by) return undefined
        if (!explanation.trim()) return undefined
        const shift = st.shifts.find((x) => x.id === shiftId)
        if (!shift || shift.status !== 'awaiting_explanation') return undefined
        // Підпис — імʼя керівника, який зміну закрив, а не назва його ролі: саме він
        // лишається в документі поруч із розбіжністю, якої тут ніхто не підганяє.
        const doc: Shift = { ...shift, status: 'closed', explanation, closedBy: by }
        set({ shifts: st.shifts.map((x) => (x.id === shiftId ? doc : x)) })
        return doc
      },

      /**
       * Зміну відкриває САМЕ приймальник цієї точки (`22-tz`, ряд. 669: «закривається разом
       * з обліковими записами»). Гейт подвійний навмисно: роль — бо керівник зміни не
       * відкриває, точка — бо чужу шухляду не рахують. `operatorId` більше не приходить
       * параметром: раніше екран міг відкрити зміну на будь-яке імʼя з довідника.
       */
      openShift: ({ pointId, openingFloat }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'operator') return undefined
        const actor = actorAt(st, pointId)
        if (!actor) return undefined
        // Те саме правило, що в `setCashFloat`: `round2()` перетворює NaN на 0, і зміна
        // відкрилася б із хибною основою згортки, якої ніхто не вводив.
        if (!Number.isFinite(openingFloat) || openingFloat < 0) return undefined
        // Дві відкриті зміни на одній точці — це дві книги на одну шухляду: перерахунок
        // о 16:00 не мав би до чого чіплятися однозначно, а закриття закрило б випадкову.
        if (st.shifts.some((x) => x.pointId === pointId && x.status === 'open')) return undefined
        const doc: Shift = {
          id: `sf_${rid()}`,
          pointId,
          operatorId: actor.by,
          date: todayOf(st),
          openedTime: nowTime(),
          // ПЕРЕРАХУНОК приймальника на ранок, а не «скільки має бути»: якби система
          // показувала очікуване до вводу, перерахунок став би переписуванням (06 §7.3).
          openingFloat: round2(openingFloat),
          status: 'open',
        }
        set({ shifts: [...st.shifts, doc] })
        return doc
      },

      countCash: ({ shiftId, countedCash, note }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'operator') return undefined
        if (!Number.isFinite(countedCash) || countedCash < 0) return undefined
        const shift = st.shifts.find((x) => x.id === shiftId)
        // Перерахунок чіпляється до ВІДКРИТОЇ зміни: на закритій він не має чого фіксувати,
        // а розбіжність там уже зафіксована окремим числом.
        if (!shift || shift.status !== 'open') return undefined
        // Точка береться З ДОКУМЕНТА: шухляда, яку рахують, належить зміні, а не тому, що
        // зараз вибрано в шапці.
        const actor = actorAt(st, shift.pointId)
        if (!actor) return undefined
        // I70: очікувану суму й розбіжність рахує рушій — поля вводу для них немає в жодної
        // ролі. Людина вводить рівно одне число: скільки грошей вона порахувала в шухляді.
        const expected = cashOf(st, shift.pointId, shift.date).expectedCash
        const counted = round2(countedCash)
        const doc: CashCount = {
          id: `cc_${rid()}`,
          shiftId,
          pointId: shift.pointId,
          date: shift.date,
          at: nowTime(),
          countedCash: counted,
          // ЗНІМОК очікуваної на момент перерахунку: пізніша подія дня не має права
          // переписати розбіжність, яку вже показали людині.
          expectedAtCount: expected,
          discrepancy: shiftDiscrepancy(counted, expected),
          // Хто РАХУВАВ, а не хто відкрив зміну: на Шипинках касирів двоє, і перерахунок
          // о 16:00 цілком може робити не той, хто відкривав шухляду о 07:00.
          countedBy: actor.by,
          note,
        }
        // Перерахунок нічого не ВИПРАВЛЯЄ — він лише фіксує факт (1197, 1222).
        set({ cashCounts: [...st.cashCounts, doc] })
        return doc
      },

      closeShift: ({ shiftId, countedCash, explanation }) => {
        const st = get()
        if (roleOf(st.users, st.session) !== 'operator') return undefined
        if (!Number.isFinite(countedCash) || countedCash < 0) return undefined
        const shift = st.shifts.find((x) => x.id === shiftId)
        if (!shift || shift.status !== 'open') return undefined
        const actor = actorAt(st, shift.pointId)
        if (!actor) return undefined
        const expected = cashOf(st, shift.pointId, shift.date).expectedCash
        const counted = round2(countedCash)
        const discrepancy = shiftDiscrepancy(counted, expected)
        // Порогів у v1 НЕМАЄ (Q-23): будь-яка розбіжність ≠ 0 йде до керівника. Тому
        // `closedBy` ставиться ЛИШЕ при нулі — при розбіжності зміна висить
        // 'awaiting_explanation', і закриває її керівник (06 §6 п. 5), а не той, хто рахував.
        const status = shiftStatusFor(discrepancy)
        const doc: Shift = {
          ...shift,
          closedTime: nowTime(),
          countedCash: counted,
          discrepancy,
          status,
          explanation,
          closedBy: status === 'closed' ? actor.by : undefined,
        }
        set({ shifts: st.shifts.map((x) => (x.id === shiftId ? doc : x)) })
        return doc
      },

      syncAll: () =>
        set((st) => ({
          receptions: st.receptions.map((r) => (r.synced ? r : { ...r, synced: true })),
          payouts: st.payouts.map((p) => (p.synced ? p : { ...p, synced: true })),
          reweighs: st.reweighs.map((r) => (r.synced ? r : { ...r, synced: true })),
        })),

      /**
       * ⚠️ СЕСІЮ НЕ ЧІПАЄ — і це рішення, а не недогляд. «Скинути демо-дані» і «Вийти»
       * мусять лишатися двома різними жестами: кнопку тиснуть ПЕРЕД показом (підпис під
       * нею в `Shell.tsx` каже саме це), і виводити презентера з системи посеред показу —
       * не те, про що вона. Тест, якому потрібна відсутність сесії, кличе `signOut()` явно.
       */
      resetDemo: () => {
        const fresh = buildSeed()
        // Точка й маршрут беруться З ТОГО, ХТО ЗАЛИШИВСЯ ЗА КОМПʼЮТЕРОМ. Літерал `'p1'`
        // тут був правильний, поки роль перемикали кнопкою; із сесіями він кидав би
        // приймальника Конищева на Шипинки — екран показував би чужу точку, а кожна
        // команда мовчки відмовляла б через `actorAt`. Без сесії лишається як було.
        const user = actorOf(get())
        set({
          ...fresh,
          settings: { ...DEFAULT_SETTINGS },
          ...(user
            ? scopeAfterSignIn(user)
            : { activePointId: 'p1', route: { name: 'reception' as const } }),
          online: true,
          workDate: fresh.config.businessToday,
        })
      },
    }),
    {
      // v6: у знімку зʼявилися вісім ключів ящиків і каси-підзвіту (21 §2.8). Причина
      // бампа та сама, що вже записана для v5, v4 і v3: старий стан має форму, якої більше
      // немає, тому скидаємо, а не міграємо. Без бампа браузер, який уже відкривав демо,
      // віддав би зі свого v5 стан БЕЗ жодного ящика — `merge` підставив би сюди свіжий сід
      // лише для ВІДСУТНІХ ключів, тому екрани ящиків і каси намалювалися б, але поверх
      // прийомок зі старого payload-а: наділ, видачі й перекази з одного світу, квитанції з
      // іншого. `withBerryUnits` відправлень, порахований по чужих квитанціях, — це саме та
      // тиха розбіжність, яку I63 і мусить робити видимою.
      /*
       * ⚠️ ФАЗА 4 ВЕРСІЮ НЕ БАМПАЄ, і це рішення, а не забутий рядок. Причина бампа, що
       * записана вище, тут не виконується: жоден ключ ДОКУМЕНТІВ не змінює форми — зникає
       * одне поле пристрою (`role`) і додається одне (`session`). Браузер із `v6`-payload
       * віддасть у `merge` старий обʼєкт: `role` ніхто вже не читає, `session` відсутній →
       * `null` → екран входу, тобто рівно те, що й має статися. Бамп натомість викинув би
       * демо-прийомки людини без жодної причини (`migrate: () => undefined` — це повний
       * пересід), і зробив би це посеред показу.
       */
      name: 'yagoda-crm-demo-v6',
      version: 6,
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
        crateAllotments: s.crateAllotments,
        cashFloats: s.cashFloats,
        crateIssues: s.crateIssues,
        crateReturns: s.crateReturns,
        crateShipments: s.crateShipments,
        transfers: s.transfers,
        shifts: s.shifts,
        cashCounts: s.cashCounts,
        settings: s.settings,
        session: s.session,
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
        // Множина id піднята сюди навмисно: `p.session.userId` усередині колбека `some()`
        // TS не звужує (перевірено: error TS18046), а винести `p.session` у власну змінну
        // не можна — храповик атрибутує ключ по ПЕРШІЙ властивості після кореня-параметра,
        // і `isSession(restored)` не зарахувався б ні до якого ключа.
        const userIds = new Set(current.users.map((u) => u.id))
        /*
         * ДВА звуження на одному ключі, і друге важливіше.
         * Форма — локальний предикат. Існування — сесія на `userId`, якого немає в реєстрі,
         * це НЕ сесія (`23 §Р4-6`). Реєстр тут завжди свіжий (`users` не персистяться),
         * тому перевірка справжня.
         *
         * Падає в `null`, а не в `current.session` — на відміну від решти двадцяти ключів,
         * які падають у свіжий сід: свіжий сід для сесії означав би «увійшов хтось», а
         * правильна відповідь на зіпсовану сесію одна — екран входу.
         *
         * ⚠️ ЧОМУ ЗВУЖЕННЯ СТОЇТЬ ТУТ, А НЕ В САМОМУ КЛЮЧІ. Множина id мусить бути піднята
         * (`p.session.userId` усередині колбека `some()` TS не звужує — перевірено:
         * TS18046), а `p.session` МУСИТЬ лишитися всередині виклику `isSession(...)`:
         * храповик атрибутує ключ по ПЕРШІЙ властивості після кореня-параметра, тому
         * `const restored = p.session` з наступним `isSession(restored)` не зарахувався б
         * ні до якого ключа взагалі.
         */
        const restoredSession = isSession(p.session) && userIds.has(p.session.userId) ? p.session : null
        const restoredUser = sessionUser(current.users, restoredSession)
        /*
         * Невідомий id тихо перекидає прийомку на першу точку (`ReceptionPage.tsx`:
         * `?? points[0]`), а книга кожної точки окрема — гроші опиняються в чужому звіті
         * дня без жодного знаку. Тому спершу тип, а нижче — звірка з сесією.
         */
        const rawPoint = typeof p.activePointId === 'string' ? p.activePointId : current.activePointId
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
          // ящики і каса як підзвіт (21 §2.8): вісім ключів, вісім звужень тієї самої форми
          // без масиву `effectiveAt()` не знайде жодного запису — обʼєкт дає TypeError на
          // `for…of`, а рядок мовчки крутиться по літерах. Тихий випадок гірший: наділу
          // «немає», `onHand` стає null, і `checkCrateIssue()` відмовляє в КОЖНІЙ видачі
          crateAllotments: Array.isArray(p.crateAllotments)
            ? (p.crateAllotments as CrateAllotment[])
            : current.crateAllotments,
          // гроші: з наділу на день відкриття книги починається вся згортка каси, і саме до
          // діючого рахується «не хватає до наділу» — обидва читає той самий `effectiveAt()`
          cashFloats: Array.isArray(p.cashFloats) ? (p.cashFloats as CashFloat[]) : current.cashFloats,
          // гроші: Σ depositTaken — це половина каси за ящики, і той самий масив читає
          // баланс людини. Не-масив падає на `.filter()` ще до першої копійки
          crateIssues: Array.isArray(p.crateIssues) ? (p.crateIssues as CrateIssue[]) : current.crateIssues,
          // гроші: `depositRefund` — друга половина каси за ящики, а `openCrateIssues()` ще й
          // ітерує цей масив у циклі, тому не-масив це TypeError просто під час FIFO-розкладу
          crateReturns: Array.isArray(p.crateReturns)
            ? (p.crateReturns as CrateReturn[])
            : current.crateReturns,
          // не гроші, але ящики: без відправлень `atBase` = 0, `onHand` завищений на всі
          // відвантажені — і видача дозволить те, чого на точці фізично немає (I62)
          crateShipments: Array.isArray(p.crateShipments)
            ? (p.crateShipments as CrateShipment[])
            : current.crateShipments,
          // і гроші, і ящики: прийнятий переказ додає `cash` у касу за ягоду і `crates` у
          // наділ; без масиву падає `.filter()` ще до того, як хоч одне з двох порахується
          transfers: Array.isArray(p.transfers) ? (p.transfers as Transfer[]) : current.transfers,
          // не гроші напряму, але саме до відкритої зміни чіпляється перерахунок: без масиву
          // `countCash()` не знайде зміни й відмовить, а `openShift()` відкриє другу книгу
          shifts: Array.isArray(p.shifts) ? (p.shifts as Shift[]) : current.shifts,
          // журнал перерахунків: втрата не рухає жодної суми, але «розбіжність зафіксували»
          // і «розбіжності не рахували» на екрані виглядають однаково — а це різні речі
          cashCounts: Array.isArray(p.cashCounts) ? (p.cashCounts as CashCount[]) : current.cashCounts,
          settings: isSettings(p.settings) ? p.settings : current.settings,
          session: restoredSession,
          /*
           * ⚠️ ТОЧКА ЗВІРЯЄТЬСЯ З СЕСІЄЮ, а не лише з типом (`23 §4.2`). Без цього рядка
           * приймальник, який підправив сховище в devtools, після перезавантаження працював
           * би на ЧУЖІЙ точці — а `ratchet:persist` лишався б зеленим, бо звуження по типу
           * написане. Керівника це не стосується: `activePointId: 'all'` для нього законний.
           */
          activePointId:
            restoredUser && restoredUser.role === 'operator' && rawPoint !== restoredUser.pointId
              ? (restoredUser.pointId ?? rawPoint)
              : rawPoint,
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
  const users = useStore((s) => s.users)
  const session = useStore((s) => s.session)
  const activePointId = useStore((s) => s.activePointId)
  // Роль ПОХІДНА: окремого поля стану більше немає. `null` (сесії немає) деградує до
  // найсуворішого — жодне порівняння з `'owner'` його не пропустить.
  const role = roleOf(users, session)
  return { role, activePointId, allPoints: role === 'owner' && activePointId === 'all' }
}

/** Хто зараз за компʼютером — для показу. Хук, бо шапці й сайдбару потрібна ПІДПИСКА. */
export function useActor() {
  const users = useStore((s) => s.users)
  const session = useStore((s) => s.session)
  const user = sessionUser(users, session)
  return { session, user, name: user?.name ?? null }
}

export function scopedReceptions(receptions: Reception[], pointId: string) {
  return pointId === 'all' ? receptions : receptions.filter((r) => r.pointId === pointId)
}

export function scopedPayouts(payouts: Payout[], pointId: string) {
  return pointId === 'all' ? payouts : payouts.filter((p) => p.pointId === pointId)
}

/**
 * ⚠️ РІШЕННЯ ВЛАСНИКА (27.08.2026): ОФЛАЙН-РЕЖИМУ НЕ БУДЕ ВЗАГАЛІ. Отже цей лічильник,
 * прапорці `synced` на трьох типах документів, `syncAll()` і плашка звʼязку у `Shell.tsx` —
 * це ДЕМОНСТРАЦІЙНА імітація, а не інфраструктура, і `docs/22-tz.md` (ДН-33) саме так її
 * і називає: «за нею немає ні черги, ні відновлення». Обґрунтування нижче — «база працює
 * під навісом» — описує світ, якого не буде; воно лишене як історія рішення, а не як
 * причина щось тут будувати. Той самий запис стоїть у `ports.ts`; він продубльований ТУТ
 * навмисно, бо саме тут лежить машинерія, і читач, який відкриє лише цей файл, інакше
 * повірив би обґрунтуванню, що вже не діє.
 *
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

/**
 * ЄДИНИЙ спосіб для екранів прочитати касу й наділ точки. Без цих двох хуків кожна
 * сторінка збирала б виклик `cashStanding()` сама — і кожна тягла б за собою ще один
 * примірник дати відкриття книги. Їх уже було три (сід, стор, тести), і один із них
 * розійшовся б мовчки: інша дата дає інший залишок на екрані, а не червоний тест.
 *
 * Хуки, а не чисті функції, свідомо: сторінці потрібна ПІДПИСКА на зміни стану, і
 * підписатися на 8 масивів поштучно в кожній сторінці — це вісім шансів забути один.
 */
export function useCashStanding(pointId: string, date: ISODate) {
  const st = useStore()
  return cashStanding({
    pointId,
    date,
    openedOn: st.config.cashBookFrom,
    floats: st.cashFloats,
    receptions: st.receptions,
    payouts: st.payouts,
    transfers: st.transfers,
    issues: st.crateIssues,
    returns: st.crateReturns,
  })
}

export function useCrateStanding(pointId: string, date: ISODate) {
  const st = useStore()
  return crateStanding({
    pointId,
    date,
    allotments: st.crateAllotments,
    issues: st.crateIssues,
    returns: st.crateReturns,
    shipments: st.crateShipments,
    transfers: st.transfers,
  })
}
