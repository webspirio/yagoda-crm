export type ISODate = string // YYYY-MM-DD

/*
 * Номінальні аліаси. Документують намір і коштують нуль: це ті самі string і number,
 * тому жоден наявний виклик не зачеплений. Брендованих типів (`string & { __brand }`)
 * тут свідомо НЕМАЄ — вони зачепили б кожен виклик у 12 000 рядках, зламали б
 * заморожені тести й не дали б жодної рантайм-переваги сьогодні. Аліас підвищується
 * до брендованого одним рядком, коли з'явиться сервер і ціна помилки зросте.
 */
export type PointId = string
export type SupplierId = string
export type BerryId = string
/** Гривні. Округлення — round2 на кожній операції, ніколи в проміжних ставках. */
export type Uah = number
/** Кілограми, дві десяті. */
export type Kg = number
/** HH:MM за годинником пристрою. Бізнес-дата — це завжди окремий ISODate. */
export type ClockTime = string

/**
 * `'base'` — склад/холодильник. Ягоду з пунктів там переважують, і водночас це
 * **звичайний пункт прийому** з вищими, оптовими цінами: «склад тоже считається як
 * одна прийомка… Також фіксується як прийомний пункт» (дзвінок №4, ряд. 545–547).
 * Селектори пунктів по цьому полю НЕ фільтруються — правила #54/#84/#107 скасовані (S-22).
 */
export type PointKind = 'reception' | 'base'

export interface Point {
  id: string
  name: string
  village: string
  kind: PointKind
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
  /**
   * Сорт виведений з обігу: не показується в довіднику, на аркуші цін і в селекторі
   * прийомки, але історичні квитанції на нього лишаються валідними.
   * Шість ОПТ-сортів — «Опт забрати просто вже» (дзвінок №4, ряд. 642).
   */
  retired?: boolean
}

/** Container type — tare deducted from gross weight */
export interface TareType {
  id: string
  name: string
  weight: number // kg per unit
  /** ₴ per unit — the crate's value, and the base for a Залог */
  price: number
}

/**
 * Маркер стоїть на людині, не на сорті: «не на сорт получається, а на фамілію» (M24).
 * Взаємовиключно — «не може бути, що одна людина і оптовик, і фермер».
 * Базову ціну товару маркер не змінює: змінюється лише дод. ціна на рядку (M24, M35).
 */
export type SupplierKind = 'none' | 'wholesale' | 'farmer'

export interface Supplier {
  id: string
  name: string
  /** Empty in 209 of 209 rows of their Довідник — undefined here, not invented */
  phone?: string
  village: string
  homePointId: string
  kind: SupplierKind
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

/**
 * Маршрут живе тут, а не в store.ts: `UiState.route` у ports.ts мусить бути саме `Route`,
 * інакше контракт розширив би `name` до `string` і Shell.tsx втратив би перевірку назви
 * розділу — контракт не має права послаблювати типи.
 */
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

export interface Session {
  role: Role
  pointId: string
  operatorName: string
}
