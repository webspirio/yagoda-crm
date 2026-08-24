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
export type ReweighId = string
export type DayExpenseId = string
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

/* ------------------------- собівартість дня (09 §2.2, §2.3) ------------------------- */

/*
 * ТРИ СВІДОМІ РОЗБІЖНОСТІ ЗІ СПЕКОЮ `docs/09 §2.2/§2.3`. Записані тут, бо документ, з якого
 * розбіжність тихо зникла, гірший за документ із поміченою.
 *
 * 1. `ISOStamp` у цьому коді НЕМАЄ і не вводиться. Бізнес-дата й час пристрою — завжди два
 *    окремі поля, рівно як у `Reception.date` / `Reception.time` і `Payout.date` / `.time`.
 *    Тому замість `weighedAt` / `voidedAt` / `createdAt` тут пари
 *    `weighedDate`+`weighedTime`, `voidedDate`+`voidedTime`, `createdDate`+`createdTime`.
 *    Один тип на два різні поняття — це саме та плутанина, від якої §2.2 і застерігає.
 *
 * 2. `productId` зі спеки — це у нас НАЗВА товару (`Berry.product`), а не id. Причина в
 *    коді: `PRODUCTS[].id` сьогодні декоративний, ніхто на нього не посилається, а
 *    `Berry.product` посилається саме на `PRODUCTS[].name`. Перехід на id — це правка 18
 *    рядків `BERRIES` і чотирьох екранів, які до зведення дня стосунку не мають, тому він
 *    відкладений.
 *    ⚠️ ЦІНА ЦЬОГО РІШЕННЯ: назви товарів мусять лишатися унікальними (це стверджує
 *    `seed.test.ts`, «10 товарів»). Щойно в довіднику зʼявиться другий товар із тією самою
 *    назвою, зведення дня почне зливати їх в один рядок — і це буде БАГ, а не особливість.
 *
 * 3. `ExpensePolicy.singleProductId` зі спеки — тут `singleProduct: string | null` із тієї
 *    самої причини, що й у п. 2.
 */

export type ReweighStatus = 'draft' | 'posted' | 'voided'

/**
 * Рядок переважування. Той самий жест, що й на прийомці: брутто, піддон, тара, нетто.
 * Сорт (`berryId`) зберігається як його бачив вагар, але звіряння йде по ТОВАРУ (`I49`):
 * пересортиця в дорозі не є фізичною втратою і не має малювати недостачу.
 */
export interface ReweighLine {
  id: string
  order: number
  berryId: BerryId
  /** денормалізована назва товару — рівень звітності, див. розбіжність 2 вище */
  product: string
  grossKg: Kg
  palletKg: Kg
  tare: TareLine[]
  tareWeightKg: Kg
  tareUnits: number
  netKg: Kg
  note?: string
}

export interface Reweigh {
  id: ReweighId
  /**
   * День ЯГОДИ, а не день заїзду машини: партія за 04.08, переважена вранці 05.08, усе одно
   * належить 04.08 — інакше собівартість дня ніколи не зійдеться.
   */
  berryDate: ISODate
  /** Пункт, ЗВІДКИ приїхала ягода. Саме з ним порівнюємо вагу. */
  fromPointId: PointId
  /** База, ДЕ переважували. */
  atPointId: PointId
  weighedDate: ISODate
  weighedTime: ClockTime
  status: ReweighStatus
  lines: ReweighLine[]
  /**
   * ЗНІМОК прийомки на момент ПРОВЕДЕННЯ (`D-2`). Заповнюється один раз і більше не
   * переписується. Без нього пізня квитанція або сторно заднім числом ТИХО переписали б
   * недостачу і собівартість уже зведеного дня — саме так у їхньому Excel ламався
   * «попередній». Розбіжність зі сьогоднішньою прийомкою показується окремо (`I55`).
   * `avgPoint` тут — ставка БЕЗ округлення.
   */
  snapshot: { product: string; kgPoint: Kg; avgPoint: number }[]
  operator: string
  /** Заповнюються при сторно; сам документ не зникає (`I54`, `06` — тільки INSERT). */
  voidedDate?: ISODate
  voidedTime?: ClockTime
  voidedBy?: string
  voidReason?: string
  /** Переважування їде в ТУ САМУ чергу, що квитанції: база працює під навісом (§2.2). */
  synced: boolean
}

/**
 * `'manual'` набирає людина. `'shortfall'` рахує система, і в СТАНІ такого рядка не буває
 * ніколи — його синтезує `costOfDay()` при кожному виводі (`I43`).
 */
export type DayExpenseKind = 'manual' | 'shortfall'

export interface DayExpense {
  id: DayExpenseId
  date: ISODate
  /** Витрата завжди належить пункту: `ExpenseScope` скасовано цілком (13 §1 П-2). */
  pointId: PointId
  kind: DayExpenseKind
  /** Вільний підпис: «Касир», «Вантажник ×2», «Пальне». */
  label: string
  amount: Uah
  createdBy: string
  createdDate: ISODate
  createdTime: ClockTime
  note?: string
}

/**
 * Правило розподілу НАЛЕЖИТЬ ПАРІ (день, пункт) — `D-3`. Глобальною настройкою воно бути не
 * може: зміна правила сьогодні переписала б собівартість усіх минулих днів, тобто той самий
 * клас тихої помилки, що й `D-2`.
 */
export interface ExpensePolicy {
  date: ISODate
  pointId: PointId
  basis: 'byWeight' | 'byValue'
  /** Аварійний вихід `R-09`: увесь пул на один товар, як керівник робив на папері. */
  singleProduct: string | null
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
  | 'cost'
  | 'reweigh'
  | 'network'
  | 'sheet'

export interface Route {
  name: RouteName
  id?: string
}

export interface Session {
  role: Role
  pointId: string
  operatorName: string
}
