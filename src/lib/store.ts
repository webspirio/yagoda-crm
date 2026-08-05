import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { allocatePayout, openDebts, round2 } from './calc'
import { buildSeed, nextCode, nowTime, TODAY } from './seed'
import type {
  Berry,
  ISODate,
  Payout,
  Point,
  PriceRecord,
  Reception,
  Role,
  Supplier,
  TareLine,
  TareType,
} from './types'

export type RouteName =
  | 'reception'
  | 'day'
  | 'dashboard'
  | 'suppliers'
  | 'supplier'
  | 'debts'
  | 'prices'
  | 'journal'
  | 'points'
  | 'refs'

export interface Route {
  name: RouteName
  id?: string
}

interface State {
  points: Point[]
  berries: Berry[]
  tareTypes: TareType[]
  suppliers: Supplier[]
  prices: PriceRecord[]
  receptions: Reception[]
  payouts: Payout[]

  role: Role
  activePointId: string
  route: Route
  online: boolean
  workDate: ISODate

  setRole: (role: Role) => void
  setActivePoint: (id: string) => void
  go: (route: Route) => void
  setOnline: (v: boolean) => void
  setWorkDate: (d: ISODate) => void

  addSupplier: (s: Omit<Supplier, 'id' | 'createdAt'>) => Supplier
  updateSupplier: (id: string, patch: Partial<Supplier>) => void
  updateTareType: (id: string, patch: Partial<TareType>) => void

  setPrice: (args: {
    date: ISODate
    pointId: string
    berryId: string
    price: number
    author: string
    reason?: string
  }) => void
  priceFor: (date: ISODate, pointId: string, berryId: string) => number | undefined
  priceHistory: (date: ISODate, pointId: string, berryId: string) => PriceRecord[]

  addReception: (r: {
    date: ISODate
    pointId: string
    supplierId: string
    berryId: string
    gross: number
    tare: TareLine[]
    tareWeight: number
    net: number
    price: number
    bonus: number
    amount: number
    paid: number
    operator: string
  }) => Reception
  removeReception: (id: string) => void

  addPayout: (args: {
    date: ISODate
    pointId: string
    supplierId: string
    amount: number
    operator: string
  }) => Payout | undefined

  syncAll: () => void
  resetDemo: () => void
}

const seed = buildSeed()

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ...seed,

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

      addReception: (r) => {
        const st = get()
        const reception: Reception = {
          ...r,
          id: `r_${Math.random().toString(36).slice(2, 9)}`,
          code: nextCode('Ч', st.receptions.map((x) => x.code)),
          time: nowTime(),
          debt: round2(r.amount - r.paid),
          synced: st.online,
        }
        set({ receptions: [...st.receptions, reception] })
        return reception
      },

      removeReception: (id) =>
        set((st) => ({ receptions: st.receptions.filter((r) => r.id !== id) })),

      addPayout: ({ date, pointId, supplierId, amount, operator }) => {
        const st = get()
        const open = openDebts(supplierId, st.receptions, st.payouts)
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
          role: 'operator',
          activePointId: 'p1',
          route: { name: 'reception' },
          online: true,
          workDate: TODAY,
        })
      },
    }),
    {
      name: 'yagoda-crm-demo-v2',
      version: 2,
      partialize: (s) => ({
        suppliers: s.suppliers,
        prices: s.prices,
        tareTypes: s.tareTypes,
        receptions: s.receptions,
        payouts: s.payouts,
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
