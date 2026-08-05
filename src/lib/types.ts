export type ISODate = string // YYYY-MM-DD

export interface Point {
  id: string
  name: string
  village: string
  isMain: boolean
  /** Points that actually receive berries; the rest sit in the registry, ready to open */
  active: boolean
}

/**
 * Сорт — the pricing key, exactly as in the client's Довідник.
 * `product` is the level above it: 9 товарів → 17 сортів.
 */
export interface Berry {
  id: string
  name: string
  short: string
  /** Товар this сорт belongs to — Малина, Ожина, Шипшина… */
  product: string
  /** ОПТ is a separate сорт with its own price, not a multiplier: Ожина 60 / Ожина ОПТ 65 */
  wholesale: boolean
  /** inclusive season window inside the demo period */
  from: ISODate
  to: ISODate
  basePrice: number
}

/** Container type — tare deducted from gross weight */
export interface TareType {
  id: string
  name: string
  weight: number // kg per unit
  /** ₴ per unit — the crate's value, and the base for a Залог */
  price: number
}

export interface Supplier {
  id: string
  name: string
  /** Empty in 209 of 209 rows of their Довідник — undefined here, not invented */
  phone?: string
  village: string
  homePointId: string
  wholesale: boolean
  note?: string
  createdAt: ISODate
}

export interface PriceRecord {
  id: string
  date: ISODate
  pointId: string
  berryId: string
  price: number
  /** HH:MM the price started to apply */
  time: string
  author: string
  reason?: string
}

export interface TareLine {
  tareId: string
  count: number
}

export interface Reception {
  id: string
  code: string
  date: ISODate
  time: string
  pointId: string
  supplierId: string
  berryId: string
  gross: number
  /** Піддон — pallet mass, subtracted BEFORE tare (their column G) */
  pallet: number
  tare: TareLine[]
  tareWeight: number
  net: number
  price: number
  /** Дод. ціна — per-line surcharge in ₴/kg, their column J */
  bonus: number
  amount: number
  paid: number
  /** amount - paid, left on the supplier's balance */
  debt: number
  /**
   * Попередній залишок folded into this visit's «Разом» (their column L).
   * Non-zero only on the first line of a visit, and only when the operator kept
   * «Враховувати залишок» on. Presentation only — the balance itself still lives
   * in the ledger, never in an input field.
   */
  carriedIn: number
  /** Lines of one visit share this: one supplier, N lines, one «Разом», one payout */
  visitId?: string
  operator: string
  synced: boolean
}

export interface Allocation {
  receptionId: string
  originDate: ISODate
  amount: number
}

/** Settling an old balance — money leaves the till today for berries of another day */
export interface Payout {
  id: string
  code: string
  date: ISODate
  time: string
  pointId: string
  supplierId: string
  amount: number
  allocations: Allocation[]
  /**
   * Set when the payout was the excess of a visit's «Разом» over today's berry.
   * Without it a reprint has to guess which of a supplier's same-day payouts belongs
   * to which visit — and a receipt would show cash that was never handed over on it.
   */
  visitId?: string
  operator: string
  synced: boolean
}

/** Owner-level guards. Дод. ціна bounds are what M7 asked for: «не більше 20… чи не більше 30» */
export interface Settings {
  surchargeMin: number
  surchargeMax: number
}

export type Role = 'operator' | 'owner'

export interface Session {
  role: Role
  pointId: string
  operatorName: string
}
