/**
 * Контракт між моком і майбутнім бекендом. Реалізації тут немає — тільки типи.
 *
 * Сьогодні `store.ts` — це in-memory адаптер цього контракту (Zustand + persist).
 * Коли з'явиться сервер, змінюється адаптер, а не екрани: сторінки викликають лише
 * `Commands`, читають лише `DomainSnapshot` і `Queries`, і жодна з них не знає, чи
 * дані приїхали з localStorage чи по HTTP.
 *
 * ЧОМУ ЕКСПОРТУЄТЬСЯ РІВНО П'ЯТЬ ІМЕН. Храповик `deadcode` вважає експорт мертвим,
 * якщо його не імпортує ІНШИЙ файл; згадка в сусідньому інтерфейсі того самого файлу не
 * рахується. Тому експортовані саме ті пʼять, у яких є справжній імпортер:
 * `DomainSnapshot`, `UiState`, `Commands`, `Queries` — їх бере `store.ts`, а
 * `VisitLineInput` — `ReceptionPage.tsx`. Решта payload-ів лишається локальною: вони й
 * так їдуть разом із `Commands` структурно, а майбутній адаптер отримає їхні типи з
 * підпису методу. Експортувати їх поштучно можна буде тоді, коли з'явиться той, хто
 * імпортує.
 */
import type {
  Berry,
  BerryId,
  DayExpense,
  DayExpenseId,
  DayExpenseKind,
  ExpensePolicy,
  ISODate,
  Kg,
  Payout,
  Point,
  PointId,
  PriceRecord,
  Reception,
  Reweigh,
  ReweighId,
  Role,
  Route,
  Settings,
  Supplier,
  SupplierId,
  SupplierKind,
  TareLine,
  TareType,
  Uah,
} from './types'

/** 1 · Дані, якими володіє сервер. Усе, що синхронізується. */
export interface DomainSnapshot {
  points: Point[]
  berries: Berry[]
  tareTypes: TareType[]
  suppliers: Supplier[]
  prices: PriceRecord[]
  receptions: Reception[]
  payouts: Payout[]
  /** Переважування їдуть у ту саму чергу, що квитанції (09 §2.2) */
  reweighs: Reweigh[]
  /** Позакасовий реєстр витрат керівника (09 §2.3) — касу не рухає */
  expenses: DayExpense[]
  /** Правило розподілу належить парі (день, пункт), не глобальній настройці (D-3) */
  policies: ExpensePolicy[]
  settings: Settings
}

/**
 * 2 · Локальний стан. НІКОЛИ не їде на сервер і не приїжджає з нього.
 *
 * `route` типізований саме як `Route`, а не як `{ name: string; id?: string }`:
 * Shell.tsx звіряє назву розділу з `RouteName`, і розширення до `string` було б
 * втратою типу. Контракт не має права послаблювати те, що вже перевіряється.
 */
export interface UiState {
  role: Role
  activePointId: PointId
  route: Route
  online: boolean
  workDate: ISODate
}

/**
 * Рядок візиту. ЄДИНИЙ payload, що експортується — бо його справді імпортує
 * ReceptionPage.tsx (там `interface DraftLine extends VisitLineInput`).
 * Переїхав сюди зі store.ts; імпорт у ReceptionPage.tsx переведений на '@/lib/ports'.
 */
export interface VisitLineInput {
  berryId: BerryId
  gross: Kg
  pallet: Kg
  tare: TareLine[]
  tareWeight: Kg
  net: Kg
  price: Uah
  bonus: Uah
  amount: Uah
}

/* 3 · Payload-и команд = майбутні тіла POST-запитів. БЕЗ export — див. коментар вище.
   Правило: усе тут мусить бути серіалізовним у JSON. Жодних Date, Map, Set,
   функцій і класів — тільки примітиви, масиви й прості об'єкти. */
interface SetPriceInput {
  date: ISODate
  pointId: PointId
  berryId: BerryId
  price: Uah
  author: string
  reason?: string
}
interface SetPriceEverywhereInput {
  date: ISODate
  berryId: BerryId
  price: Uah
  author: string
  reason?: string
}
interface CreateSupplierInput {
  name: string
  phone?: string
  village: string
  homePointId: PointId
  kind: SupplierKind
}
interface AddVisitInput {
  date: ISODate
  pointId: PointId
  supplierId: SupplierId
  operator: string
  /** Попередній залишок, згорнутий у «Разом»; 0 коли перемикач вимкнений */
  carriedIn: Uah
  /** Видано готівкою — уже обмежене visitMath() */
  paid: Uah
  lines: VisitLineInput[]
}
interface AddPayoutInput {
  date: ISODate
  pointId: PointId
  supplierId: SupplierId
  amount: Uah
  operator: string
  /** стоїть, коли виплата — це перевищення «Разом» над сьогоднішньою ягодою */
  visitId?: string
  /** гасити лише прийомки цього пункту: книга кожного пункту своя */
  scopePointId?: PointId
}
/** Рядок переважування, як його набирає вагар: той самий жест, що на прийомці (09 §2.2) */
interface ReweighLineInput {
  berryId: BerryId
  /** назва товару — рівень, на якому рахується недостача (I49); див. types.ts, розбіжність 2 */
  product: string
  grossKg: Kg
  palletKg: Kg
  tare: TareLine[]
  tareWeightKg: Kg
  tareUnits: number
  netKg: Kg
  note?: string
}
interface AddReweighInput {
  /** день ЯГОДИ, а не день заїзду машини */
  berryDate: ISODate
  fromPointId: PointId
  atPointId: PointId
  operator: string
  lines: ReweighLineInput[]
}
interface AddExpenseInput {
  date: ISODate
  pointId: PointId
  label: string
  amount: Uah
  createdBy: string
  note?: string
  /**
   * Існує РІВНО для того, щоб `I43` («`addExpense({kind:'shortfall'})` відхилено») було
   * перевіряним твердженням, а не обіцянкою в документі: усе, крім `'manual'` та
   * `undefined`, повертає `undefined` і нічого не пише. Рядка недостачі в СТАНІ не буває —
   * його синтезує `costOfDay()` щоразу заново.
   */
  kind?: DayExpenseKind
}

/**
 * 4 · Мутації. Сьогодні синхронні; підписи навмисно готові стати Promise.
 *
 * `addVisit` повертає `{ receptions, payout? }`, бо саме це повертає код: і
 * ReceptionPage.tsx, і шість тестів у visit.test.ts читають `.receptions` та `.payout`.
 * Контракт описує код, а не навпаки.
 */
export interface Commands {
  addSupplier(input: CreateSupplierInput): Supplier
  updateSupplier(id: SupplierId, patch: Partial<Supplier>): void
  updateTareType(id: string, patch: Partial<TareType>): void
  updateSettings(patch: Partial<Settings>): void
  setPrice(input: SetPriceInput): void
  setPriceEverywhere(input: SetPriceEverywhereInput): void
  addVisit(input: AddVisitInput): { receptions: Reception[]; payout?: Payout }
  addPayout(input: AddPayoutInput): Payout | undefined
  /** Документ народжується одразу `posted` разом зі знімком прийомки (D-2, D-5) */
  addReweigh(input: AddReweighInput): Reweigh
  /** Сторно не видаляє: документ лишається зі слідом (I54). Порожня причина — no-op */
  voidReweigh(id: ReweighId, reason: string, operator: string): void
  addExpense(input: AddExpenseInput): DayExpense | undefined
  /**
   * РОЗШИРЕННЯ ПРОТИ `09 §2.3`: у спеці цієї команди немає. Додана свідомо — без неї
   * одруківка керівника в реєстрі витрат незворотна, а екран, з якого не можна прибрати
   * помилково введений рядок на 13 000 ₴ замість 1 300 ₴, непридатний до роботи.
   */
  removeExpense(id: DayExpenseId): void
  /** upsert по парі (date, pointId): правило належить ДНЮ, не настройці (D-3) */
  setExpensePolicy(input: ExpensePolicy): void
  syncAll(): void
  resetDemo(): void
}

/** 5 · Проєкції. Майбутні GET-и або серверні в'юшки. */
export interface Queries {
  priceFor(date: ISODate, pointId: PointId, berryId: BerryId): Uah | undefined
  priceHistory(date: ISODate, pointId: PointId, berryId: BerryId): PriceRecord[]
}
