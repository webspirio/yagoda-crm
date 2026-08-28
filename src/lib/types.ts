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
/*
 * Ці сім НЕ експортуються, і це не недогляд. `deadcode` (knip) вважає експорт мертвим,
 * поки його не імпортує ІНШИЙ файл, а дописувати такий експорт у baseline заборонено
 * (`CLAUDE.md`, правило 3). Усередині цього файлу вони працюють однаково — це ті самі
 * `string`. Експортувати поштучно можна буде тоді, коли з'явиться справжній імпортер;
 * та сама дисципліна вже записана вище для ящикових id і в `ports.ts`.
 */
type ReceptionId = string
type PayoutId = string
type TareTypeId = string
type PriceRecordId = string
type BerryProduct = string
type UserId = string
type ProductId = string
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
  id: PointId
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
  id: BerryId
  name: string
  short: string
  /**
   * Товар this сорт belongs to — Малина, Ожина, Шипшина…
   *
   * НАЗВА, а не id — свідома відкладена розбіжність зі спекою, розписана нижче
   * (розбіжність 2). Ціна цього рішення теж названа там: назви товарів мусять лишатися
   * унікальними, інакше зведення дня почне зливати два товари в один рядок.
   */
  product: BerryProduct
  /** ОПТ is a separate сорт with its own price, not a multiplier: Ожина 60 / Ожина ОПТ 65 */
  wholesale: boolean
  /** inclusive season window inside the demo period */
  from: ISODate
  to: ISODate
  basePrice: Uah
  /**
   * Сорт виведений з обігу: не показується в довіднику, на аркуші цін і в селекторі
   * прийомки, але історичні квитанції на нього лишаються валідними.
   * Шість ОПТ-сортів — «Опт забрати просто вже» (дзвінок №4, ряд. 642).
   */
  retired?: boolean
}

/** Container type — tare deducted from gross weight */
export interface TareType {
  id: TareTypeId
  name: string
  /**
   * kg per unit. ⚠️ РЕДАГОВАНЕ керівником у рантаймі (`RefsPage.tsx`), і саме тому
   * `Reception.tareWeight` мусить бути знімком, а не перерахунком.
   */
  weight: Kg
  /** ₴ per unit — the crate's value, and the base for a Залог. Так само редаговане */
  price: Uah
}

/**
 * Маркер стоїть на людині, не на сорті: «не на сорт получається, а на фамілію» (M24).
 * Взаємовиключно — «не може бути, що одна людина і оптовик, і фермер».
 * Базову ціну товару маркер не змінює: змінюється лише дод. ціна на рядку (M24, M35).
 */
export type SupplierKind = 'none' | 'wholesale' | 'farmer'

export interface Supplier {
  id: SupplierId
  name: string
  /** Empty in 209 of 209 rows of their Довідник — undefined here, not invented */
  phone?: string
  /**
   * НЕ довідникове посилання, а транскрипція так, як її написали в файлі клієнта — 14
   * різних написань на ту саму місцевість. Дублікати засіяні НАВМИСНО (`seed-suppliers.ts`),
   * щоб майбутньому екрану злиття було що знаходити. Не нормалізувати без рішення власника.
   */
  village: string
  homePointId: PointId
  kind: SupplierKind
  note?: string
  createdAt: ISODate
}

/** Append-only: ціна дня версіонована всередині дня, остання-за-`time` перемагає */
export interface PriceRecord {
  id: PriceRecordId
  date: ISODate
  pointId: PointId
  berryId: BerryId
  price: Uah
  /** HH:MM the price started to apply */
  time: ClockTime
  author: string
  reason?: string
}

export interface TareLine {
  tareId: TareTypeId
  count: number
}

/**
 * Квитанція — рядок прийомки.
 *
 * ⚠️ ПОХІДНІ ПОЛЯ ТУТ МАЮТЬ ТРИ РІЗНІ ПРИРОДИ, і з форми `number` цього не видно.
 * Різниця не косметична: два з них ПЕРЕРАХУВАТИ НЕЛЬЗЯ, решту — можна. Нормалізація, що
 * читає лише типи, зітре саме те, чого чіпати не можна. Тому кожне підписане нижче.
 *
 * `tareWeight` і `price` — ЗНІМКИ. `net`, `amount`, `debt` — КЕШІ, з яких лише `debt` має
 * детектор розбіжності. `carriedIn` — не похідне взагалі, а візитна презентація.
 */
export interface Reception {
  id: ReceptionId
  /** Номер на папері, який людина забрала з собою; мінтиться `nextCode()` локально */
  code: string
  date: ISODate
  time: ClockTime
  pointId: PointId
  supplierId: SupplierId
  berryId: BerryId
  gross: Kg
  /** Піддон — pallet mass, subtracted BEFORE tare (their column G) */
  pallet: Kg
  tare: TareLine[]
  /**
   * ЗНІМОК, а НЕ кеш — і це єдине поле ваги, яке не можна перерахувати.
   * Вагу тари керівник змінює руками (`RefsPage.tsx` → `updateTareType(id, { weight })`),
   * тому перерахунок `tare[] × TareType.weight` заднім числом переписав би чисту вагу Й
   * СУМУ кожної історичної квитанції. Це той самий аргумент, що повністю розписаний
   * нижче для `CrateIssue.depositPerUnit`. Зберігати обовʼязково.
   */
  tareWeight: Kg
  /**
   * КЕШ: `gross − pallet − tareWeight` — з КЕШОВАНОГО `tareWeight`, що лежить рядком вище.
   * ⚠️ НЕ через `weigh()`: він рахує тару заново з ПОТОЧНОГО довідника, тобто робить рівно
   * те, що знімок вище й забороняє. Відтворювати можна лише формулою по збережених полях.
   */
  net: Kg
  /**
   * ЗНІМОК ціни дня на момент проведення, а НЕ посилання на `PriceRecord`. Ціна дня
   * версіонована всередині дня (`PriceRecord.time`, остання-за-часом), тому читання
   * «поточної» переоцінило б уже надруковану квитанцію.
   */
  price: Uah
  /** Дод. ціна — per-line surcharge in ₴/kg, their column J */
  bonus: Uah
  /** КЕШ: `round2(net × (price + bonus))` */
  amount: Uah
  paid: Uah
  /**
   * КЕШ: `amount − paid`. Єдиний похідний кеш квитанції з детектором розбіжності —
   * `DayReconciliation.drift` зводить `Σ(amount − paid − debt)` і показує його на «Касі за
   * день». Саме це робить його безпечнішим за `net`/`amount`, а не якась інша природа.
   */
  debt: Uah
  /**
   * Попередній залишок folded into this visit's «Разом» (their column L).
   * Non-zero only on the first line of a visit, and only when the operator kept
   * «Враховувати залишок» on. Presentation only — the balance itself still lives
   * in the ledger, never in an input field.
   */
  carriedIn: Uah
  /**
   * Lines of one visit share this: one supplier, N lines, one «Разом», one payout.
   *
   * ⚠️ НЕОБОВʼЯЗКОВЕ, хоча візит — це транзакційна межа (`docs/01-model.md §2.7` називає
   * `Visit` aggregate root: «або все, або нічого»). Окремого запису `Visit` у стані немає,
   * тому «Разом», надруковане на папері, ніде не збережене — воно щоразу перераховується
   * `visitMath()`. Поки чек друкують одразу, це видно лише як `?`; сервер зробить це
   * питанням атомарності одного POST-а. Рішення не ухвалене — див. відкриті питання.
   */
  visitId?: string
  operator: string
  synced: boolean
}

export interface Allocation {
  receptionId: ReceptionId
  originDate: ISODate
  amount: Uah
}

/** Settling an old balance — money leaves the till today for berries of another day */
export interface Payout {
  id: PayoutId
  code: string
  date: ISODate
  time: ClockTime
  pointId: PointId
  supplierId: SupplierId
  /** КЕШ: `round2(Σ allocations.amount)`. Детектора розбіжності НЕ має — на відміну від
   *  `Reception.debt`, який зводиться через `DayReconciliation.drift` */
  amount: Uah
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
 * ЧОТИРИ СВІДОМІ РОЗБІЖНОСТІ. Перші три — зі спекою `docs/09 §2.2/§2.3`. Записані тут, бо документ, з якого
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
 *
 * 4. ПОЛЯ `…Id` ДЛЯ ЛЮДЕЙ ТРИМАЮТЬ ІМʼЯ, А НЕ ID — і це стало розбіжністю саме
 *    27.08.2026, коли в знімку зʼявився `User` зі справжніми id (`u_owner`, `u_p1`…).
 *    Доти імені просто не було з чим порівнювати: підпис приходив рядком із
 *    `OPERATORS[pointId]`, і жодного реєстру не існувало. Тепер реєстр є, а
 *    `CrateIssue.operatorId`, `CrateReturn.operatorId`, `CrateShipment.operatorId`,
 *    `Shift.operatorId`, `CrateAllotment.setBy`, `Transfer.sentBy`/`acceptedBy`,
 *    `PriceRecord.author`, `DayExpense.createdBy` і кожен `voidedBy` далі зберігають
 *    ІМʼЯ — з 28.08.2026 те, яке віддає `auth.ts:actorName()` (`signerFor()` більше немає).
 *    ЧОМУ НЕ ВИПРАВЛЕНО ЗАРАЗ: причина лишилася ОДНА — ціна переходу. Це не перейменування
 *    типу, а зміна ЗНАЧЕНЬ у ~61 літералі підпису в 12 тестових файлах плюс усі документи
 *    сіду. Другий аргумент, який стояв тут до 28.08.2026, скасований цією ж фазою:
 *    запасні підписи (`point.name`, `'Каса'`, `'Приймальник'`, роль керівника і
 *    `signerFor(…) ?? ownerName(…)`) справді не мали id — але їх БІЛЬШЕ НЕМАЄ, усі пʼять
 *    прибрано (див. абзац нижче). Тримати його в теперішньому часі означало б, що два
 *    сусідні абзаци одного докблоку кажуть протилежне.
 *    ⟡ ПЕРЕПИСАНО 28.08.2026 (фаза 4, задача 1). Досі тут стояло, що іменних входів
 *    «немає й не буде до сервера» (`docs/22-tz.md §17.2`) і що тому ціна цього рішення
 *    «не реалізується» — фаза 4 робить ОБИДВА твердження хибними. `auth.ts:actorName()`
 *    читає підпис по `Session.userId` з ЦЬОГО Ж реєстру, тому підпис більше не прибитий
 *    до ТОЧКИ — він прибитий до ЛЮДИНИ. Ціна, про яку йшлося, тепер РЕАЛІЗУВАЛАСЯ: двоє
 *    людей з однаковим імʼям стануть одним підписом, а перейменування перепише підпис
 *    під усіма минулими документами людини. Перехід САМИХ ПОЛІВ `…Id` на `UserId` (а не
 *    лише підпису на імʼя) лишається боргом `23 §Б1` — з датою розплати «разом із першим
 *    справжнім сервером», бо саме там імена стануть неунікальними по-справжньому.
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
  product: BerryProduct
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
  snapshot: { product: BerryProduct; kgPoint: Kg; avgPoint: number }[]
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
  surchargeMin: Uah
  surchargeMax: Uah
}

export type Role = 'operator' | 'owner'

/* ------------------------- ящики (21 §2.1–2.5) ------------------------- */

/*
 * ЕКСПОРТОВАНИЙ ТУТ РІВНО ОДИН ID — той, у якого вже є справжній імпортер: `CrateIssueId`
 * бере `calc.ts` під ключ Map у `openCrateIssues()`. Решта чотирьох живуть усередині
 * файлу, бо `deadcode` вважає експорт мертвим, поки його не імпортує ІНШИЙ файл, а
 * дописувати такий експорт у baseline заборонено (`CLAUDE.md`, правило 3). Це та сама
 * дисципліна, що вже записана в `ports.ts`: «експортувати їх поштучно можна буде тоді,
 * коли з'явиться той, хто імпортує». Хвиля 2 (стор) і хвиля 3 (екрани) саме це й зроблять.
 */
type CrateAllotmentId = string
export type CrateIssueId = string
type CrateReturnId = string
type CrateShipmentId = string
type TransferId = string

/**
 * Спосіб видачі ящиків людині: «Якщо, наприклад, до 50, це буде за кошти кожен ящик.
 * Якщо після 50, це буде за розписку» (дзвінок №4, ряд. 1081).
 *
 * `'deposit'` — за кошти: людина лишає завдаток, і ці гроші ФІЗИЧНО заходять у касу.
 * `'receipt'` — за розписку: грошей немає взагалі, лишається папір.
 */
export type CrateIssueMode = 'deposit' | 'receipt'

/**
 * Наділ ящиків на точку. НЕ поле на Point, а історія: «я за те, щоб поняття фіксованої
 * суми… їм потрібно бачити очима візуально, від якої суми їм потрібно відштовхуватись»
 * (1067–1068). Зміна наділу 600 → 800 — це НОВИЙ запис, старий баланс не перераховується.
 */
export interface CrateAllotment {
  id: CrateAllotmentId
  pointId: PointId
  /** «Тобто це поки по 600 ящиків» (940) */
  units: number
  /** «ми зафіксували від певного дня… з 15-го, наприклад, серпня» (946) */
  effectiveFrom: ISODate
  setBy: string
  setDate: ISODate
  setTime: ClockTime
  /** Обовʼязкова при зміні наявного наділу: «нам треба, щоб було 800» (1062) */
  reason?: string
}

export interface CrateIssue {
  id: CrateIssueId
  date: ISODate
  time: ClockTime
  pointId: PointId
  supplierId: SupplierId
  units: number
  mode: CrateIssueMode
  /**
   * ЗНІМОК ціни ящика на момент видачі, а не посилання на довідник тари. Ціну Чешки
   * змінює керівник (`06 §6` п. 11) — якби повернення читало поточну ціну, зміна
   * 120 → 130 заднім числом переписала б суму, яку ми винні за ящики, взяті місяць тому.
   * За розписку — РІВНО 0, тому завдаток рахується однією формулою для обох способів.
   */
  depositPerUnit: Uah
  /** round2(units × depositPerUnit) — готівка, що зайшла в касу за ящики */
  depositTaken: Uah
  /** «І тоді вже в процесі ми формуємо цю розписку» (1084) — номер паперу */
  receiptNo?: string
  operatorId: string
  /** Заповнюються при сторно; сам документ не зникає (`06 §3` — тільки INSERT) */
  voidedDate?: ISODate
  voidedBy?: string
  voidReason?: string
}

/** Частина повернення, віднесена на одну конкретну видачу (FIFO, 21 §3.2). */
export interface CrateReturnAllocation {
  issueId: CrateIssueId
  units: number
  /** Узятий із ТІЄЇ видачі, не з довідника — інакше зміна ціни переписала б борг */
  perUnit: Uah
  amount: Uah
}

/**
 * Повернення ящиків, у т.ч. ЧАСТКОВЕ: «людина брала 20 ящиків, но вона, наприклад,
 * сьогодні хоче сім ящиків тільки повернути» (1101).
 */
export interface CrateReturn {
  id: CrateReturnId
  date: ISODate
  time: ClockTime
  pointId: PointId
  supplierId: SupplierId
  units: number
  /** «воно автоматично підтягує йому, як та людина брала ящики» (1087) — FIFO по видачах */
  allocations: CrateReturnAllocation[]
  /** round2(Σ allocations.amount) — готівка, що вийшла з каси за ящики */
  depositRefund: Uah
  operatorId: string
  voidedDate?: ISODate
  voidedBy?: string
  voidReason?: string
}

/**
 * Вечірнє відправлення ящиків на базу разом із ягодою.
 * «не вони мають вносити, а тобто сама система, сама програма має вичитати» (1115) —
 * тому `withBerryUnits` це ЗНІМОК, порахований рушієм, а не поле вводу.
 */
export interface CrateShipment {
  id: CrateShipmentId
  /** День ЯГОДИ, за який відвантажують */
  date: ISODate
  pointId: PointId
  /** Знімок на момент проведення: Σ Чешок у квитанціях дня */
  withBerryUnits: number
  /** Скільки квитанцій дало цей знімок — щоб пізня квитанція була ВИДНА, а не тиха */
  receptionCount: number
  /** «іменно заламані ящики… треба їм якось виділити строчку» (1117) — РУКАМИ */
  brokenUnits: number
  operatorId: string
  postedDate: ISODate
  postedTime: ClockTime
  voidedDate?: ISODate
  voidedBy?: string
  voidReason?: string
}

/**
 * `'sent'` — виїхало з бази, але точка ще не підтвердила: «це не півтори години, десь
 * так» (1014). У цьому стані переказ НЕ рухає ні касу, ні наділ.
 * `'disputed'` — точка натиснула «Не сходиться». Теж не рухає нічого: «щоб керівник
 * просто змінював, щоб не вони, бо то ужас буде» (1185).
 */
type TransferStatus = 'sent' | 'accepted' | 'disputed' | 'void'

/** Переказ база → точка: ящики і гроші однією поїздкою (M44). */
export interface Transfer {
  id: TransferId
  date: ISODate
  pointId: PointId
  /** Порожні ящики назад на точку */
  crates: number
  /** Готівка на ягоду */
  cash: Uah
  /** «підписує в зошиті перевізник» (1014) — ТЕКСТ, не обліковий запис (рішення Р-2) */
  carrier: string
  sentBy: string
  sentTime: ClockTime
  status: TransferStatus
  acceptedBy?: string
  /**
   * ДЕНЬ ПРИЙНЯТТЯ, не день відправлення. Спека `§2.6` вимагала `acceptedAt: ISODateTime`,
   * і перша реалізація його загубила: обидві згортки фільтрували за `date` (днем виїзду),
   * тому переказ, відправлений увечері 03.08 і прийнятий уранці 04.08 — а це нормальний
   * випадок, «це не півтори години» (1014), — заднім числом додавав гроші й ящики у 03.08.
   */
  acceptedDate?: ISODate
  acceptedTime?: ClockTime
  /** Лише при 'disputed': що нарахувала точка. ІНФОРМАЦІЯ — у формули не входить */
  reportedCrates?: number
  reportedCash?: Uah
  disputeNote?: string
  /** «або другий раз подати їм» (1185) — виправлення це НОВИЙ документ */
  correctionOf?: TransferId
  voidedDate?: ISODate
  voidedBy?: string
  voidReason?: string
}

/* ------------------------- каса як підзвіт (21 §2.2, §2.7) ------------------------- */

type CashFloatId = string
type ShiftId = string
type CashCountId = string

/**
 * Наділ каси на точку. Форма НАВМИСНО дзеркальна до `CrateAllotment`: клієнтка сама
 * сказала «технологія з грошима така сама, як з ящиками» (дзвінок №4, ряд. 1144).
 * Різний по точках — «кожна точка може бути і різне» (1164).
 */
export interface CashFloat {
  id: CashFloatId
  pointId: PointId
  /** «фіксована сума на користування», «ми ставимо 100 000 фіксовано» (1146, 1133) */
  amount: Uah
  effectiveFrom: ISODate
  setBy: string
  setDate: ISODate
  setTime: ClockTime
  reason?: string
}

/**
 * Зміна приймальника. Форма з `06 §7.2` без змін.
 * `openingFloat` — це ПЕРЕРАХУНОК приймальника, а не «скільки має бути»: якби система
 * показувала очікуване до вводу, перерахунок перетворився б на переписування (`06 §7.3`).
 */
export interface Shift {
  id: ShiftId
  pointId: PointId
  operatorId: string
  date: ISODate
  openedTime: ClockTime
  openingFloat: Uah
  closedTime?: ClockTime
  countedCash?: Uah
  /** countedCash − expectedCash. Обчислюване; поля вводу немає в жодної ролі (`I70`) */
  discrepancy?: Uah
  status: 'open' | 'awaiting_explanation' | 'closed'
  explanation?: string
  /** При розбіжності закриває керівник, не приймальник (`06 §6` п. 5) */
  closedBy?: string
}

/**
 * Перерахунок каси СЕРЕД ДНЯ — сутність, якої в `06 §7` немає: там перерахунок був лише
 * на відкритті й закритті. Клієнтка попросила його окремо і пояснила навіщо: «якщо він за
 * півдня його перерахує і передивиться… щоб не цілий день передивлятися» (1197).
 * Перерахунок нічого не ВИПРАВЛЯЄ — він лише фіксує факт (`I70`, ряд. 1222).
 */
export interface CashCount {
  id: CashCountId
  shiftId: ShiftId
  pointId: PointId
  date: ISODate
  at: ClockTime
  countedCash: Uah
  /** знімок очікуваної на момент перерахунку — щоб пізніша подія не переписала розбіжність */
  expectedAtCount: Uah
  discrepancy: Uah
  countedBy: string
  note?: string
}

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
  | 'crates'
  | 'pointcash'
  | 'transfers'

export interface Route {
  name: RouteName
  id?: string
}

/**
 * Товар — рівень над сортом. Досі існував ЛИШЕ як `PRODUCTS` у `seed.ts`, тобто екрани
 * читали довідник із фікстури демо-даних. Запис у знімку робить його тим, чим він і є:
 * серверною сутністю. `Berry.product` поки лишається НАЗВОЮ, а не `ProductId` — ця
 * розбіжність описана вище (розбіжність 2) і знімається окремо.
 */
export interface Product {
  id: ProductId
  name: BerryProduct
}

/**
 * Обліковий запис людини, яка працює в системі.
 *
 * ⚠️ СЕКРЕТУ ТУТ НЕМАЄ І БУТИ НЕ МОЖЕ. Це те, чим володіє сервер і що він віддає клієнтові:
 * імʼя, роль, точка, логін. Пароля сервер не віддає нікому, тому в моці він лежить в
 * `auth-mock.ts` — файлі, який стоїть НА МІСЦІ СЕРВЕРА. Якби секрет лежав у знімку,
 * майбутній HTTP-адаптер мусив би його вигадати, тобто контракт брехав би про те, хто чим
 * володіє (`23 §Р4-2`).
 *
 * ЩО ЗМІНИЛОСЯ 28.08.2026: до фази 4 тут стояло «ЦЕ НЕ ОБЛІКОВИЙ ЗАПИС… сьогодні це РЕЄСТР
 * ПІДПИСІВ», і це було правдою — входу не існувало. Тепер вхід є, і рядок знято.
 *
 * ⚠️ ПЕРЕПИСАНО 28.08.2026 (фаза 4, задача 2). Тут стояло, що «чотири підписи, які система
 * реально ставить, різні НАВМИСНО, і збирати їх в один не можна». Обидва твердження знято.
 * Підписів було не чотири, а ПʼЯТЬ (`point.name` на прийомці, `'Каса'` у погашенні,
 * `'Приймальник'` у цінах, назва ролі з `ownerName()` і `signerFor(…) ?? ownerName(…)` у
 * ящиках), і «навмисно» вони були різні лише тому, що жодного джерела імені не існувало:
 * підпис виводили з ТОЧКИ, а не з людини. Задача 2 прибрала всі пʼять: підпис ставить
 * `auth.ts:actorName(users, session)`, а «немає кого підписати» — це відмова команди, а не
 * запасний рядок. Тому й `signerFor()`/`ownerName()` більше немає в `calc.ts`.
 */
export interface User {
  id: UserId
  name: string
  role: Role
  /** Приймальник прив'язаний до своєї точки; у керівника точки немає (M12) */
  pointId?: PointId
  /**
   * Логін. НЕ секрет: його видно на екрані входу, і сервер віддає його клієнтові так само,
   * як імʼя. Короткий навмисно — його набирають руками на точці.
   */
  login: string
}

/**
 * Хто зараз за компʼютером (`22-tz §18.4`: «на екрані видно, хто зараз за компʼютером»).
 *
 * ТРИ ПОЛЯ, І ЦЕ НАВМИСНО. Імені, ролі й точки тут НЕМАЄ: вони читаються з `users` по
 * `userId` (`auth.ts:sessionUser`). Сесія з їхніми копіями розійшлася б із реєстром при
 * першому перейменуванні людини, а два примірники одного факту в цьому проєкті заборонені
 * за побудовою (`seed.ts:229`).
 *
 * `startedDate` — БІЗНЕС-дата (`config.businessToday`), не `new Date()`: та сама причина,
 * що в `Reweigh.weighedDate` — годинник пристрою поставив би штамп поза сезоном.
 *
 * ⚠️ ЩО ЗМІНИТЬСЯ З ПРИХОДОМ СЕРВЕРА, і це варто знати наперед: справжня сесія — це
 * непрозорий токен, який видає сервер, тому тут зʼявиться поле токена, `signIn` стане
 * асинхронною, а роль читатиметься з відповіді сервера, а не з клієнтського реєстру. Три
 * поля нижче — форма МОКА, а не пророцтво про сервер.
 */
export interface Session {
  userId: UserId
  startedDate: ISODate
  startedTime: ClockTime
}

/**
 * Чому не `Session | undefined`.
 *
 * Зміряно 28.08.2026: із 31 методу `Commands` `| undefined` віддають 19, `void` — 10, і два
 * віддають значення без `undefined`. Тобто одностайної конвенції, до якої можна апелювати,
 * немає — і перша редакція спеки, яка писала «решта 31 команда домовилася», помилялася.
 *
 * Причина справжня й одна: причин відмови ТРИ, і для людини вони різні. `undefined` злив би
 * їх в одне «не вийшло», і екран мусив би вгадувати текст — рівно те, проти чого стоїть
 * `06 §5.3` («UI лише повторює те саме рішення»).
 *
 * ⚠️ `'unknown-login'` окремо від `'wrong-secret'` — це ДЕМО-зручність, а не проєктне
 * рішення: справжній сервер їх навмисно не розрізняє, щоб не підтверджувати існування
 * логіна. Коли зʼявиться сервер, ці дві причини зіллються в одну.
 */
export type AuthResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'unknown-login' | 'wrong-secret' | 'no-account' }

/**
 * Параметри застосунку, які СЬОГОДНІ приходять із `seed.ts`, а завтра — з сервера.
 *
 * Досі кожен із них екрани імпортували прямо з фікстури демо-даних: 24 файли з 33 брали
 * `TODAY`, `SEASON_START`, `CASH_BOOK_FROM` або `DEFAULT_TARE_ID` із `seed.ts`. Тобто
 * обіцянка `ports.ts` («сторінки викликають лише `Commands`, читають лише
 * `DomainSnapshot` і `Queries`») була неправдою у трьох чвертях екранів, і жодна
 * перевірка цього не бачила: імпорт із сусіднього модуля не порушує жодного правила.
 *
 * `businessToday` — це «сьогодні НА ТОЧЦІ», бізнес-дата, а не `new Date()`. Вона свідомо
 * лишається параметром, а не годинником: демо-сід прив'язаний до неї цілком, і smoke
 * звіряє на ній конкретне число (склад наділу 800 = 341 + 195 + 264, Шипинки 04.08).
 * Сервер підставить сюди свою дату — і жоден екран від цього не змінюється.
 *
 * НЕ плутати з `UiState.workDate`: `businessToday` — це день, який точка проживає зараз,
 * а `workDate` — день, який керівник ГОРТАЄ у звітах. Кожен екран уже вибрав одне з двох
 * свідомо й записав причину; переїзд на `config` цього вибору НЕ змінює.
 */
export interface AppConfig {
  businessToday: ISODate
  seasonStart: ISODate
  /** День, з якого ведеться касова книга — параметр рушія, не константа в ньому (21 §3.5) */
  cashBookFrom: ISODate
  /** Яка саме тара вважається «ящиком» для наділу й відправлень */
  crateTareId: TareTypeId
}
