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
  AppConfig,
  AuthResult,
  Berry,
  BerryId,
  CashCount,
  CashFloat,
  CrateAllotment,
  CrateIssue,
  CrateIssueMode,
  CrateReturn,
  CrateShipment,
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
  Product,
  Reception,
  Reweigh,
  ReweighId,
  Route,
  Session,
  Settings,
  Shift,
  Supplier,
  SupplierId,
  SupplierKind,
  TareLine,
  TareType,
  Transfer,
  Uah,
  User,
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
  /* ---- ящики і каса як підзвіт (21 §2.8): вісім ключів, назви — з контракту ----
     Усі вісім лежать САМЕ ТУТ, а не в `UiState`, бо це дані документів, а не пристрою:
     наділ, видачі, повернення й перекази читає й керівник, і сусідня точка.

     ⚠️ ПОПЕРЕДНЄ ОБҐРУНТУВАННЯ ЦЬОГО МІСЦЯ БУЛО ІНШЕ й більше не діє. Тут стояло, що
     вісім ключів лежать у знімку тому, що «офлайн-черга синхронізує рівно те, що описує
     `DomainSnapshot`, а ящики видають і касу рахують під навісом, де звʼязку немає».
     Рішення власника (27.08.2026): офлайн-режиму не буде взагалі. Отже офлайн-черга не
     є аргументом ні за, ні проти складу цього інтерфейсу, і спиратися на неї в майбутніх
     рішеннях не можна. Причина лишилася одна, зате справжня: це спільні дані.

     ЩО ЦЕ МІНЯЄ ДЛЯ ЧИТАННЯ. Поки офлайн був цілью, «завантажити знімок цілком» було
     природним читанням. Без офлайну природним стає читання по проєкціях (`Queries`), а
     повний знімок — особливістю мока. Пастка тут одна й вона іменована: `openDebts()`
     згортає ЗАРАХУВАННЯ по всьому FIFO-ланцюжку, а `supplierBalanceAt()` сканує всі
     прийомки й усі рядки виплат. Такі проєкції не можна віддавати сторінками: вікно
     тихо змінює саме число, а не лише його повноту. */
  /** Наділ ящиків — ІСТОРІЯ, не поле на точці: зміна 600 → 800 це новий запис (21 §2.1) */
  crateAllotments: CrateAllotment[]
  /** Наділ каси; форма дзеркальна до наділу ящиків — «технологія така сама» (1144) */
  cashFloats: CashFloat[]
  /** Видачі ящиків людям: за кошти (гроші в касу) або за розписку (грошей немає) */
  crateIssues: CrateIssue[]
  /** Повернення, у т.ч. часткові; розклад по видачах — FIFO (21 §3.2) */
  crateReturns: CrateReturn[]
  /** Вечірні відправлення на базу; `withBerryUnits` — знімок рушія, не поле вводу (I63) */
  crateShipments: CrateShipment[]
  /** Перекази база → точка; рухають касу й наділ ЛИШЕ у стані 'accepted' (I68) */
  transfers: Transfer[]
  /** Зміни приймальника: `discrepancy` обчислювана, поля вводу немає в жодної ролі (I70) */
  shifts: Shift[]
  /** Перерахунки серед дня — окремим ключем, бо це подія, а не поле зміни (21 §2.7) */
  cashCounts: CashCount[]
  settings: Settings
  /* ---- довідники й параметри, які досі жили в `seed.ts` (27.08.2026) ----
     Три ключі, які екрани раніше імпортували з фікстури демо-даних напряму. У
     `partialize` вони НЕ входять — тим самим правилом, що вже діє для `points` і
     `berries`: жодна команда їх не змінює, тому персистити нічого. */
  /** Товари — рівень над сортом; раніше `PRODUCTS` у `seed.ts` */
  products: Product[]
  /** Реєстр підписів; раніше `OPERATORS` і `OWNER` у `seed.ts`. НЕ облікові записи */
  users: User[]
  /** «Сьогодні» на точці, початок сезону, день відкриття касової книги, id ящика */
  config: AppConfig
}

/**
 * 2 · Локальний стан. НІКОЛИ не їде на сервер і не приїжджає з нього.
 *
 * `route` типізований саме як `Route`, а не як `{ name: string; id?: string }`:
 * Shell.tsx звіряє назву розділу з `RouteName`, і розширення до `string` було б
 * втратою типу. Контракт не має права послаблювати те, що вже перевіряється.
 */
export interface UiState {
  /*
   * ⚠️ `role` ТУТ БІЛЬШЕ НЕМАЄ (фаза 4). Роль — ПОХІДНА від `AuthState.session` і
   * `DomainSnapshot.users`: її віддає `auth.ts:roleOf(users, session)`. Окреме поле стану
   * було другим примірником того самого факту, і другий примірник тут завжди програє —
   * перейменування чи зміна ролі людини в реєстрі лишила б у сховищі пристрою стару.
   * Гірше: поле, яке ставили кнопкою, робило роль ВЛАСТИВІСТЮ ПРИСТРОЮ, а не людини, —
   * тобто рівно тим, чого «вхід під своїм імʼям» і не має бути (`22-tz §18.4`).
   */
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
  /*
   * ⚠️ ТРИ З ЦИХ ПОЛІВ — ПОХІДНІ, І ЦЕ РОЗБІЖНІСТЬ, ЯКУ ТРЕБА НАЗВАТИ.
   * `tareWeight`, `net` і `amount` рахує клієнт (`weigh()` у формі прийомки) і передає
   * готовими; `addVisit` кладе їх у квитанцію як є (`...line`) і рахує сам лише `debt`.
   * Ніщо не звіряє, що `amount` дорівнює `net × (price + bonus)`, а `net` — різниці ваг.
   *
   * Сьогодні це тримається, бо викликач один і всі три беруться з рушія. Але цей
   * інтерфейс описаний як «майбутні тіла POST-запитів»: сервер, який приймає таке тіло,
   * ЗОБОВʼЯЗАНИЙ перерахувати обидва й відхилити розбіжність — інакше підроблене тіло
   * запису пише довільну суму грошей.
   *
   * `price` — НЕ похідне і мусить лишитися в тілі: це ЗНІМОК ціни дня (див. `Reception.price`).
   * Ціна версіонована всередині дня, тому «прочитати поточну» на сервері означало б
   * переоцінити вже надруковану квитанцію.
   *
   * Чому не виправлено зараз: excess-property checking робить кожен літерал payload-а
   * помилкою КОМПІЛЯЦІЇ, тому правка чіпає найбільше заморожених тестів у проєкті — і
   * один із них (`store.test.ts`) НАВМИСНО передає неузгоджений `net` проти брутто й тари,
   * тобто перерахунок змінив би те, що той тест перевіряє. Рішення за власником: або
   * сервер перераховує й відхиляє, або тіло худне до входів.
   */
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
   функцій і класів — тільки примітиви, масиви й прості об'єкти.

   ⚠️ ПІДПИСУ В ТІЛІ НЕМАЄ ЖОДНОГО (фаза 4). Девʼять полів — `author` × 2, `operator` × 3,
   `createdBy`, `operatorId`, плюс два позиційні `by`/`operator` — зникли звідси не заради
   стрункості. Правило вже було записане в `store.acceptTransfer` («приймати рядок від
   викликача означало б дозволити документ із підписом, якого ніхто не ставив») — і в тому
   ж файлі порушувалося: `voidTransfer(id, reason, by)` брала підпис параметром. Це той
   самий клас дефекту, що вже описаний нижче для `VisitLineInput`: тіло, якому вірять на
   слово. Підпис тепер виводить АДАПТЕР зі своєї сесії, і сервер робитиме так само — з
   токена, а не з тіла запиту. */
interface SetPriceInput {
  date: ISODate
  pointId: PointId
  berryId: BerryId
  price: Uah
  reason?: string
}
interface SetPriceEverywhereInput {
  date: ISODate
  berryId: BerryId
  price: Uah
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
  lines: ReweighLineInput[]
}
interface AddExpenseInput {
  date: ISODate
  pointId: PointId
  label: string
  amount: Uah
  note?: string
  /**
   * Існує РІВНО для того, щоб `I43` («`addExpense({kind:'shortfall'})` відхилено») було
   * перевіряним твердженням, а не обіцянкою в документі: усе, крім `'manual'` та
   * `undefined`, повертає `undefined` і нічого не пише. Рядка недостачі в СТАНІ не буває —
   * його синтезує `costOfDay()` щоразу заново.
   */
  kind?: DayExpenseKind
}

/* ---- payload-и ящиків і каси-підзвіту (21 §2). Без export — див. коментар угорі ---- */

interface SetCrateAllotmentInput {
  pointId: PointId
  units: number
  /** «ми зафіксували від певного дня… з 15-го, наприклад, серпня» (946) */
  effectiveFrom: ISODate
  /** Обовʼязкова, коли наділ на цій точці вже є: зміна — це подія, а не переписане число */
  reason?: string
}
interface SetCashFloatInput {
  pointId: PointId
  amount: Uah
  effectiveFrom: ISODate
  reason?: string
}
interface IssueCratesInput {
  pointId: PointId
  supplierId: SupplierId
  units: number
  /**
   * Не передано — спосіб дає `crateIssueMode()` за порогом 50. Передано — так і буде:
   * поріг це ПІДСТАВЛЕННЯ, а не заборона, і перемикання руками дозволене (21 §2.3).
   */
  mode?: CrateIssueMode
  /** «в процесі ми формуємо цю розписку» (1084) — номер паперу, лише для 'receipt' */
  receiptNo?: string
}
interface ReturnCratesInput {
  pointId: PointId
  supplierId: SupplierId
  units: number
}
interface PostShipmentInput {
  pointId: PointId
  /** день ЯГОДИ, за який відвантажують */
  date: ISODate
  /**
   * Бій — РУКАМИ, і це єдине число цієї команди, яке вводить людина: «іменно заламані
   * ящики… треба їм якось виділити строчку» (1117). Поля для `withBerryUnits` немає
   * навмисно (`I63`) — його рахує рушій із квитанцій дня.
   */
  brokenUnits: number
}
interface SendTransferInput {
  pointId: PointId
  crates: number
  cash: Uah
  /** «підписує в зошиті перевізник» (1014) — ТЕКСТ, не обліковий запис (Р-2) */
  carrier: string
  /** UC-36: виправлення розбіжності — це НОВИЙ документ із посиланням на сторнований */
  correctionOf?: string
}
interface DisputeTransferInput {
  /** Що нарахувала точка. ІНФОРМАЦІЯ: у жодну формулу не входить (`I69`) */
  reportedCrates: number
  reportedCash: Uah
  note: string
}
interface OpenShiftInput {
  pointId: PointId
  /** ПЕРЕРАХУНОК приймальника на ранок, а не «скільки має бути» (06 §7.3) */
  openingFloat: Uah
}
interface CountCashInput {
  shiftId: string
  /** Єдине число, яке вводить людина: очікувану суму й розбіжність рахує рушій (`I70`) */
  countedCash: Uah
  note?: string
}
interface CloseShiftInput {
  shiftId: string
  countedCash: Uah
  explanation?: string
}

/**
 * 4 · Мутації. Сьогодні синхронні; підписи навмисно готові стати Promise.
 *
 * `addVisit` повертає `{ receptions, payout? }` на успіху і `undefined` на відмові — тим
 * самим протоколом, що й решта 18 команд. Раніше відмова поверталася як
 * `{ receptions: [], payout: undefined }`, тобто ПРАВДИВИМ обʼєктом, і `if (!doc)`, який
 * виконують усі діалоги фаз 5-6, до неї застосувати було неможливо. Єдиний виклик цього й
 * не робив: ReceptionPage.tsx рапортував відмову зеленим тостом «Прийнято …», форма
 * очищалася, а квитанції не було. Відмова, яку не видно з підпису, рано чи пізно
 * лишиться необробленою — тому вона тепер falsy, як у сусідів.
 */
export interface Commands {
  addSupplier(input: CreateSupplierInput): Supplier
  updateSupplier(id: SupplierId, patch: Partial<Supplier>): void
  updateTareType(id: string, patch: Partial<TareType>): void
  updateSettings(patch: Partial<Settings>): void
  /** Ціну дня ставить лише керівник (`22-tz`, ряд. 671); відмова — `undefined`, як у сусідів */
  setPrice(input: SetPriceInput): PriceRecord | undefined
  setPriceEverywhere(input: SetPriceEverywhereInput): PriceRecord[] | undefined
  addVisit(input: AddVisitInput): { receptions: Reception[]; payout?: Payout } | undefined
  addPayout(input: AddPayoutInput): Payout | undefined
  /** Документ народжується одразу `posted` разом зі знімком прийомки (D-2, D-5) */
  addReweigh(input: AddReweighInput): Reweigh | undefined
  /** Сторно не видаляє: документ лишається зі слідом (I54). Порожня причина — відмова */
  voidReweigh(id: ReweighId, reason: string): Reweigh | undefined
  addExpense(input: AddExpenseInput): DayExpense | undefined
  /**
   * РОЗШИРЕННЯ ПРОТИ `09 §2.3`: у спеці цієї команди немає. Додана свідомо — без неї
   * одруківка керівника в реєстрі витрат незворотна, а екран, з якого не можна прибрати
   * помилково введений рядок на 13 000 ₴ замість 1 300 ₴, непридатний до роботи.
   */
  removeExpense(id: DayExpenseId): void
  /** upsert по парі (date, pointId): правило належить ДНЮ, не настройці (D-3) */
  setExpensePolicy(input: ExpensePolicy): void

  /* ---- ящики і каса як підзвіт (21 §2, §7). Тільки INSERT: сторно — новий документ ----
     Кожна з шістнадцяти повертає `| undefined` за тим самим правилом, що вже діє в
     `addPayout` і `addExpense`: відмова — це НЕ виняток і не тихий no-op, а порожнє
     значення, яке той, хто викликав, зобовʼязаний перевірити. Правила відмови живуть у
     `calc.ts` (`checkCrateIssue`, `checkCrateReturn`, `checkCrateRefund`) — форма покаже
     текст, стор відмовить у команді, але правило одне на двох. */

  /** Новий запис наділу; старий лишається, баланс НЕ перераховується (UC-35) */
  setCrateAllotment(input: SetCrateAllotmentInput): CrateAllotment | undefined
  setCashFloat(input: SetCashFloatInput): CashFloat | undefined
  /** `I62`: понад наявні порожні ящики видати не можна */
  issueCrates(input: IssueCratesInput): CrateIssue | undefined
  /** `I64` + `I59`: понад узяте не можна, і впирається в касу за ЯЩИКИ, не за ягоду */
  returnCrates(input: ReturnCratesInput): CrateReturn | undefined
  /** `I63`: кількість із ягодою — знімок рушія; людина вводить лише бій */
  postShipment(input: PostShipmentInput): CrateShipment | undefined
  /** Створює керівник; документ народжується у стані 'sent' і не рухає нічого (`I68`) */
  sendTransfer(input: SendTransferInput): Transfer | undefined
  /** «Прийняв» — і ТІЛЬКИ тут переказ починає рухати касу й наділ (1172) */
  acceptTransfer(id: string): Transfer | undefined
  /** «Не сходиться» — заявка з числом і коментарем; не рухає нічого (`I68`) */
  disputeTransfer(id: string, input: DisputeTransferInput): Transfer | undefined
  /** Сторно переказу — ЛИШЕ керівник (`I69`, 1184–1185); порожня причина — no-op */
  voidTransfer(id: string, reason: string): Transfer | undefined
  /** Сторно ящикових документів — лише керівник, із причиною (`21 §7`) */
  voidCrateIssue(id: string, reason: string): CrateIssue | undefined
  voidCrateReturn(id: string, reason: string): CrateReturn | undefined
  voidCrateShipment(id: string, reason: string): CrateShipment | undefined
  /** Керівник закриває зміну, що чекала пояснення; розбіжність лишається в документі */
  settleShift(shiftId: string, explanation: string): Shift | undefined

  openShift(input: OpenShiftInput): Shift | undefined
  /** Перерахунок серед дня; нічого не виправляє, лише фіксує факт (1197, `I70`) */
  countCash(input: CountCashInput): CashCount | undefined
  /** При розбіжності зміна йде до керівника, а не закривається сама (06 §6 п. 5) */
  closeShift(input: CloseShiftInput): Shift | undefined

  syncAll(): void
  resetDemo(): void
}

/** 5 · Проєкції. Майбутні GET-и або серверні в'юшки. */
export interface Queries {
  priceFor(date: ISODate, pointId: PointId, berryId: BerryId): Uah | undefined
  priceHistory(date: ISODate, pointId: PointId, berryId: BerryId): PriceRecord[]
}

/**
 * 6 · ХТО ЗА КОМПʼЮТЕРОМ. Третя секція контракту, і вона тут не з симетрії.
 *
 * Сесія — ні `DomainSnapshot`, ні `UiState`. Знімок це «дані, якими володіє сервер, усе, що
 * синхронізується» (секція 1); `UiState` це те, що «НІКОЛИ не їде на сервер і не приїжджає
 * з нього» (секція 2). Сесія ПРИХОДИТЬ із сервера — видає її він, і тільки він може
 * сказати, чи вона ще дійсна, — але не синхронізується: два ноутбуки мають різні сесії й не
 * мусять нічого одне одному переписувати. Третього місця в контракті не було.
 *
 * ⚠️ СЕКРЕТУ В КОНТРАКТІ НЕМАЄ НІДЕ — ні тут, ні у знімку. Сервер не віддає паролів і не
 * приймає їх ніде, крім `signIn`.
 */
export interface AuthState {
  session: Session | null
}

interface SignInInput {
  login: string
  secret: string
}

/**
 * Дві команди сесії. Окремим інтерфейсом, а не в `Commands`: `Commands` — це документи
 * («майбутні тіла POST-запитів»), а вхід документа не створює.
 *
 * ⚠️ `signIn` СТАНЕ АСИНХРОННОЮ, коли зʼявиться сервер: пароль перевіряє він, а не браузер.
 * Сьогодні синхронна — тим самим правилом, що й решта контракту («підписи навмисно готові
 * стати Promise», секція 4).
 */
export interface AuthCommands {
  signIn(input: SignInInput): AuthResult
  signOut(): void
}
