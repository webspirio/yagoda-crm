export type ISODate = string // YYYY-MM-DD

export interface Point {
  id: string
  name: string
  village: string
  isMain: boolean
}

export interface Berry {
  id: string
  name: string
  short: string
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
}

export interface Supplier {
  id: string
  name: string
  phone: string
  village: string
  homePointId: string
  wholesale: boolean
  /** ₴/kg added on top of the day price, e.g. +5 for wholesalers */
  bonus: number
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
  tare: TareLine[]
  tareWeight: number
  net: number
  price: number
  bonus: number
  amount: number
  paid: number
  /** amount - paid, left on the supplier's balance */
  debt: number
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
  operator: string
  synced: boolean
}

export type Role = 'operator' | 'owner'

export interface Session {
  role: Role
  pointId: string
  operatorName: string
}
