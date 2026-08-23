import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { allocatePayout, openDebts, round2, splitPaidAcrossLines } from './calc'
import { buildSeed, DEFAULT_SETTINGS, nextCode, nowTime, TODAY } from './seed'
import type { Commands, DomainSnapshot, Queries, UiState } from './ports'
import type { ISODate, Payout, Reception, Role, Route, Supplier } from './types'

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
} catch {
  // приватний режим без localStorage — демо однаково працює з пам'яті
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

      syncAll: () =>
        set((st) => ({
          receptions: st.receptions.map((r) => (r.synced ? r : { ...r, synced: true })),
          payouts: st.payouts.map((p) => (p.synced ? p : { ...p, synced: true })),
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
      // v4: `Supplier.wholesale: boolean` став `Supplier.kind: SupplierKind` (M24).
      // Це та сама причина, що й для v3: старий стан має форму, якої більше не існує,
      // тому скидаємо, а не міграємо. Без бампа браузер, який уже відкривав демо, віддав
      // би зі свого v3 208 постачальників БЕЗ поля `kind` — і бейджі маркера показували б
      // порожній підпис у всіх, включно з екраном, який клієнт побачить 28.08.
      name: 'yagoda-crm-demo-v4',
      version: 4,
      migrate: () => undefined,
      partialize: (s) => ({
        suppliers: s.suppliers,
        prices: s.prices,
        tareTypes: s.tareTypes,
        receptions: s.receptions,
        payouts: s.payouts,
        settings: s.settings,
        role: s.role,
        activePointId: s.activePointId,
        online: s.online,
        workDate: s.workDate,
      }),
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

export function pendingCount(receptions: Reception[], payouts: Payout[]) {
  return receptions.filter((r) => !r.synced).length + payouts.filter((p) => !p.synced).length
}
