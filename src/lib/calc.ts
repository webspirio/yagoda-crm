import type {
  Allocation,
  Berry,
  DayExpense,
  ExpensePolicy,
  ISODate,
  Kg,
  Payout,
  Point,
  PointId,
  Reception,
  Reweigh,
  Settings,
  Supplier,
  SupplierId,
  TareLine,
  TareType,
  Uah,
} from './types'

/**
 * Money and kilograms, to the kopeck. Half rounds away from zero, symmetrically,
 * and the epsilon is relative — an absolute nudge fixes 1,005 and still loses 8,325.
 * Never returns −0: it would print as «−0,00 кг» and as a non-zero drift on the day report.
 * Non-finite input becomes 0, not NaN — which means a broken price yields a 0 ₴ line the
 * operator can see, rather than «NaN ₴» on a receipt.
 */
export const round2 = (v: number) => {
  if (!Number.isFinite(v)) return 0
  const scaled = Math.abs(v) * 100
  const r = Math.round(scaled + scaled * Number.EPSILON + Number.EPSILON) / 100
  if (r === 0) return 0
  return v < 0 ? -r : r
}

/** Total tare mass for a set of container lines. */
export function tareWeight(lines: TareLine[], tareTypes: TareType[]) {
  return round2(
    lines.reduce((sum, l) => {
      const t = tareTypes.find((x) => x.id === l.tareId)
      return sum + (t ? t.weight * l.count : 0)
    }, 0),
  )
}

export interface WeighInput {
  gross: number
  /** Піддон — pallet mass, off the top before tare (their column G) */
  pallet?: number
  tare: TareLine[]
  price: number
  bonus: number
}

/**
 * Ефективна ціна ₴/кг: ціна дня плюс Дод. ціна, округлена до копійки.
 *
 * Існує як окремий експорт, бо weigh() рахувала це правильно і викидала: жоден екран не
 * читав WeighResult.effectivePrice, а три з них перескладали ту саму суму з сирих операндів
 * (line.price + line.bonus). Одна реалізація — одна відповідь.
 */
export const effectivePrice = (price: number, bonus: number) => round2(price + bonus)

export interface WeighResult {
  gross: number
  pallet: number
  tareWeight: number
  tareUnits: number
  net: number
  effectivePrice: number
  amount: number
}

/**
 * The whole Excel formula column, in one place.
 * Their column H is `=(((D − G) − VLOOKUP(E,…,2,0) * F))` — the pallet comes off
 * the gross weight first, and only then the tare.
 */
export function weigh(input: WeighInput, tareTypes: TareType[]): WeighResult {
  const tw = tareWeight(input.tare, tareTypes)
  const pallet = round2(Math.max(0, input.pallet ?? 0))
  // round2 refuses non-finite input, so a pasted NaN cannot reach a receipt
  const gross = round2(input.gross)
  const net = round2(Math.max(0, gross - pallet - tw))
  const eff = effectivePrice(input.price, input.bonus)
  return {
    gross,
    pallet,
    tareWeight: tw,
    tareUnits: input.tare.reduce((s, l) => s + l.count, 0),
    net,
    effectivePrice: eff,
    amount: round2(net * eff),
  }
}

/** Running balance a supplier is owed (positive = we owe them). */
export function supplierBalance(
  supplierId: string,
  receptions: Reception[],
  payouts: Payout[],
) {
  const debt = receptions
    .filter((r) => r.supplierId === supplierId)
    .reduce((s, r) => s + r.debt, 0)
  const settled = payouts
    .filter((p) => p.supplierId === supplierId)
    .reduce((s, p) => s + p.amount, 0)
  return round2(debt - settled)
}

/**
 * Книга ОДНОГО пункту: борг його прийомок мінус прив'язки, що на них лягли.
 *
 * Чому не `supplierBalance()` над звуженими масивами: та функція віднімає ЦІЛУ суму виплати,
 * а `payout.pointId` — це каса, з якої вийшла готівка, НЕ пункт погашеної ягоди. Видача
 * в режимі «Усі точки» (`SettleDialog` без `scopePointId`) гасить прийомки кількох пунктів
 * однією виплатою — і тоді пункт-штамп показував би мінус, а сусідній — борг, якого вже
 * немає. Зміряно: постачальник s1 після повної видачі отримував p1 = −7 975,30 ₴ на чеку
 * і p4 = +7 975,30 ₴ на картці при порожньому списку решток, хоча мережевий борг = 0.
 *
 * Ключ — прив'язка, а не штамп. Саме на прив'язках стоять решта семи екранів через
 * `openDebts()`, тому ця функція робить ті самі гроші, що вони, і зводиться з ними до копійки.
 * Звуження робить вона сама: залишити його виклику й означало помилку, яку тут виправлено.
 *
 * `pointId === 'all'` дає мережеву книгу — та сама угода, що в `scopedReceptions()`.
 */
export function supplierBalanceAt(
  supplierId: string,
  receptions: Reception[],
  payouts: Payout[],
  pointId: string,
) {
  const mine = receptions.filter(
    (r) => r.supplierId === supplierId && (pointId === 'all' || r.pointId === pointId),
  )
  const ids = new Set(mine.map((r) => r.id))
  const settled = payouts
    .filter((p) => p.supplierId === supplierId)
    .flatMap((p) => p.allocations)
    .filter((a) => ids.has(a.receptionId))
  return round2(sum(mine, (r) => r.debt) - sum(settled, (a) => a.amount))
}

/**
 * Per-reception outstanding remainder after allocations, oldest first.
 *
 * An overpaid line (negative `debt` — 257 such rows exist in their file, H7) is a credit:
 * it is netted off the oldest remainders, so `Σ open` always equals `supplierBalance()`.
 * Without that a supplier card lists remainders adding up to more than its own balance,
 * and anything that pays out «Усе» hands over money that is not owed.
 */
export function openDebts(supplierId: string, receptions: Reception[], payouts: Payout[]) {
  const settledByReception = new Map<string, number>()
  for (const p of payouts) {
    if (p.supplierId !== supplierId) continue
    for (const a of p.allocations) {
      settledByReception.set(a.receptionId, (settledByReception.get(a.receptionId) ?? 0) + a.amount)
    }
  }

  const mine = receptions.filter((r) => r.supplierId === supplierId)
  let credit = 0
  for (const r of mine) {
    const net = round2(r.debt - (settledByReception.get(r.id) ?? 0))
    if (net < 0) credit = round2(credit - net)
  }

  const owed = mine
    .filter((r) => r.debt > 0)
    .map((r) => ({
      reception: r,
      open: round2(r.debt - (settledByReception.get(r.id) ?? 0)),
    }))
    .filter((x) => x.open > 0.009)
    .sort((a, b) =>
      a.reception.date === b.reception.date
        ? a.reception.time.localeCompare(b.reception.time)
        : a.reception.date.localeCompare(b.reception.date),
    )

  if (credit <= 0.009) return owed

  const out: typeof owed = []
  for (const item of owed) {
    if (credit <= 0.009) {
      out.push(item)
      continue
    }
    const take = Math.min(credit, item.open)
    credit = round2(credit - take)
    const left = round2(item.open - take)
    if (left > 0.009) out.push({ ...item, open: left })
  }
  return out
}

/**
 * Spend `amount` on the open remainders in the order given, and stop when it runs out.
 * FIFO is `openDebts()`'s contract — it hands them over oldest first — and each allocation
 * keeps the date the berry was accepted, which is what makes their column `попередній`
 * (and its 124 broken links) unnecessary.
 */
export function allocatePayout(
  amount: number,
  open: { reception: Reception; open: number }[],
): Allocation[] {
  let left = round2(amount)
  const out: Allocation[] = []
  for (const item of open) {
    if (left <= 0.009) break
    const take = Math.min(left, item.open)
    out.push({ receptionId: item.reception.id, originDate: item.reception.date, amount: round2(take) })
    left = round2(left - take)
  }
  return out
}

export interface DayReconciliation {
  date: ISODate
  /** value of berries accepted today */
  accrued: number
  netKg: number
  receptionCount: number
  /** cash handed over today for today's berries */
  paidToday: number
  /** cash handed over today closing balances from earlier days */
  paidForPastDays: number
  /** cash handed over today closing a balance created earlier the same day */
  settledSameDay: number
  /**
   * The part of `settledSameDay` that closed a line in THIS slice. `newDebt` is derived
   * from it, so it — not `settledSameDay` — is what makes the day ledger column add up.
   * The two differ only when a payout booked here settles a line accepted elsewhere.
   */
  closedHere: number
  /** total cash that left the till today */
  cashOut: number
  /** balances created today and still open at the end of it */
  newDebt: number
  /** breakdown of past-day settlements by the date the berry was accepted */
  pastByOriginDate: { date: ISODate; amount: number }[]
  /**
   * Σ (Разом − Виплачено − Залишок) over the day's lines — 0 unless a line disagrees
   * with its own arithmetic. This is exactly the check their file fails: 20 of the 60
   * hand-typed `Залишок` cells do not match their own row (PART C 3).
   */
  drift: number
}

export function reconcileDay(
  date: ISODate,
  receptions: Reception[],
  payouts: Payout[],
): DayReconciliation {
  const dayReceptions = receptions.filter((r) => r.date === date)
  const dayPayouts = payouts.filter((p) => p.date === date)

  const accrued = round2(dayReceptions.reduce((s, r) => s + r.amount, 0))
  const paidToday = round2(dayReceptions.reduce((s, r) => s + r.paid, 0))
  const debtCreated = round2(dayReceptions.reduce((s, r) => s + r.debt, 0))
  const cashToPayouts = round2(dayPayouts.reduce((s, p) => s + p.amount, 0))

  // A supplier who comes twice in one day can close the morning's remainder in the
  // evening — that is today's money for today's berry, not a settlement of another day.
  // `closedHere` is the part of it that closed a line in THIS slice: the caller filters
  // receptions by point, but an allocation can point at a line accepted elsewhere, and
  // subtracting that from this point's balances would drive newDebt negative.
  const dayIds = new Set(dayReceptions.map((r) => r.id))
  const byOrigin = new Map<ISODate, number>()
  let settledSameDay = 0
  let closedHere = 0
  for (const p of dayPayouts) {
    for (const a of p.allocations) {
      if (a.originDate === date) {
        settledSameDay = round2(settledSameDay + a.amount)
        if (dayIds.has(a.receptionId)) closedHere = round2(closedHere + a.amount)
        continue
      }
      byOrigin.set(a.originDate, round2((byOrigin.get(a.originDate) ?? 0) + a.amount))
    }
  }

  const pastByOriginDate = [...byOrigin.entries()]
    .map(([d, amount]) => ({ date: d, amount }))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    date,
    accrued,
    netKg: round2(dayReceptions.reduce((s, r) => s + r.net, 0)),
    receptionCount: dayReceptions.length,
    paidToday,
    // straight from the allocations it lists, not from the payout headers
    paidForPastDays: sum(pastByOriginDate, (x) => x.amount),
    settledSameDay,
    closedHere,
    cashOut: round2(paidToday + cashToPayouts),
    newDebt: round2(debtCreated - closedHere),
    pastByOriginDate,
    drift: sum(dayReceptions, (r) => r.amount - r.paid - r.debt),
  }
}

/* ------------------------- M10: «Разом» before the payout ------------------------- */

export interface VisitMathInput {
  /** amount of every line of the visit, in entry order */
  lineAmounts: number[]
  /** what we currently owe the supplier, from the ledger */
  balance: number
  /** «Враховувати залишок» — off means behave exactly as before M10 */
  includeBalance: boolean
  /** «Видано готівкою», as typed */
  paidInput: number
}

export interface VisitMath {
  /** Нараховано сьогодні — Σ of today's lines (their column K) */
  accrued: number
  /** Попередній залишок folded in (their column L) */
  carriedIn: number
  /** РАЗОМ ДО ВИДАЧІ — the screen's main figure (their column M) */
  total: number
  /** the payout ceiling: today's berry plus the carried balance, never more */
  payCap: number
  /** Видано готівкою after clamping (their column N) */
  paid: number
  /** part of the cash that pays for today's berry — goes into Reception.paid */
  paidToday: number
  /** part of the cash that closes older balances — goes out as a separate Payout */
  paidToPast: number
  /** balance created by today's lines */
  debtToday: number
  /** Залишок за нами after this visit (their column O) */
  remainder: number
}

/**
 * The one explicit correction the client gave us (M10):
 * «щоб воно не спочатку залишок віддати, а потім ввести суму, а щоб воно зразу…
 *  щоб воно додало, да, щоб разом».
 *
 * Today's berry first, then the carried balance is added in, then ONE «Разом»,
 * and only then the payout decision. The ledger is untouched: the excess over
 * today's berry leaves as a separate dated Payout, allocated FIFO.
 */
export function visitMath({
  lineAmounts,
  balance,
  includeBalance,
  paidInput,
}: VisitMathInput): VisitMath {
  const accrued = round2(lineAmounts.reduce((s, a) => s + a, 0))
  // an overpaid supplier (negative balance) has nothing to carry in
  const carriedIn = includeBalance ? round2(Math.max(0, balance)) : 0
  const total = round2(accrued + carriedIn)
  const payCap = total
  const paid = round2(Math.max(0, Math.min(payCap, Number.isFinite(paidInput) ? paidInput : 0)))
  const paidToday = round2(Math.min(paid, accrued))
  return {
    accrued,
    carriedIn,
    total,
    payCap,
    paid,
    paidToday,
    paidToPast: round2(Math.max(0, paid - accrued)),
    debtToday: round2(accrued - paidToday),
    remainder: round2(total - paid),
  }
}

/**
 * Spread the cash that pays for today's berry across the visit's lines in entry
 * order — first line gets its full amount, the shortfall lands on the last ones.
 */
export function splitPaidAcrossLines(lineAmounts: number[], paidToday: number) {
  let left = round2(paidToday)
  return lineAmounts.map((amount) => {
    const take = round2(Math.max(0, Math.min(left, amount)))
    left = round2(left - take)
    return take
  })
}

/* ------------------------- input guards (M7) ------------------------- */

/**
 * uah() prints a real minus sign (U+2212) and no-break spaces, so a figure read off
 * the screen and typed back must survive both — otherwise Дод. ціна −15 becomes +15.
 */
function normalizeSigns(raw: string) {
  return String(raw).replace(/[−–—]/g, '-')
}

/**
 * One decimal separator, comma or dot, at most `maxDecimals` places, nothing else.
 * This is the guard against «поставили кому там що хотіли» — 10,0 typed as 100.
 */
export function maskDecimalInput(raw: string, maxDecimals = 2, allowNegative = false) {
  let s = normalizeSigns(raw).replace(/,/g, '.').replace(/[^0-9.-]/g, '')
  const negative = allowNegative && s.startsWith('-')
  s = s.replace(/-/g, '')
  const [head, ...rest] = s.split('.')
  const tail = rest.join('')
  // maxDecimals 0 means whole numbers only — keep no dangling separator
  const body = rest.length && maxDecimals > 0 ? `${head}.${tail.slice(0, maxDecimals)}` : head
  return (negative ? '-' : '') + body
}

/**
 * Numbers off a keypad. Comma and dot are the same separator, and the spaces
 * uah()/num() print — including the no-break ones — are stripped, so a figure read
 * off the screen and typed back in is still a number and not a silent zero.
 * Anything genuinely ambiguous returns 0, i.e. it is refused rather than guessed.
 */
export function parseNumeric(raw: string) {
  const cleaned = normalizeSigns(raw)
    .replace(/[\s   ]/g, '')
    .replace(/₴|кг/g, '') // a figure pasted off the screen brings its unit with it
    .replace(/,/g, '.')
  if (!cleaned) return 0
  const v = Number(cleaned)
  return Number.isFinite(v) ? v : 0
}

/**
 * Дод. ціна bounds — M7: «закладено умовою так, що не більше 20… чи не більше 30».
 * Over the cap the value is refused, not silently trimmed: the operator sees
 * «Надіслано на підтвердження керівнику» instead of a number nobody approved.
 */
export function checkSurcharge(value: number, settings: Settings) {
  // NaN fails both comparisons, so a non-numeric surcharge would sail through the one
  // guard M7 actually asked for. ±Infinity still reports which bound it broke.
  if (Number.isNaN(value)) {
    return { ok: false, over: false, under: false, clamped: 0 }
  }
  const over = value > settings.surchargeMax
  const under = value < settings.surchargeMin
  return {
    ok: !over && !under,
    over,
    under,
    clamped: round2(Math.max(settings.surchargeMin, Math.min(settings.surchargeMax, value))),
  }
}

/** Unique reception dates a payout closed, oldest first. */
export function originDates(allocations: Allocation[]) {
  return [...new Set(allocations.map((a) => a.originDate))].sort()
}

export function sum<T>(items: T[], pick: (t: T) => number) {
  return round2(items.reduce((s, i) => s + pick(i), 0))
}

/* ------------------------- собівартість дня (09 §3) ------------------------- */

/*
 * ЧОМУ ЦЕ ТУТ, А НЕ В НОВОМУ `cost.ts`. `docs/09 §3` і `docs/10` кажуть «новий файл
 * src/lib/cost.ts, calc.ts не чіпаємо». Замовник фази 2 вказав `costOfDay()` саме в
 * `calc.ts`, і саме `calc.ts` перелічений у таблиці доказів `CLAUDE.md` («+ npm run
 * coverage, і назвати цифру»). Два грошові рушії в двох файлах означали б два місця, де
 * можна округлити по-різному. Наявні функції не змінені — тільки додавання нижче.
 */

/** Рядок прийомки, зведений до ТОВАРУ: рівня, на якому рахується недостача (`I49`). */
export interface ProductDayRow {
  product: string
  kgPoint: Kg
  /** НАРАХОВАНО за ягоду (Σ `Reception.amount`), а не готівка з каси (§3.1). */
  paid: Uah
  /**
   * Ставка БЕЗ округлення. Округлена ламає `I42` на `kgPoint × похибку`: на 800 кг
   * похибка в пів копійки ставки — це 4 ₴ розбіжності в рядку, який мусить зійтися точно.
   */
  avgPoint: number
  lineCount: number
}

/**
 * Прийомка (date, pointId), згорнута по товару. Сортування — за вагою спадно, далі за
 * назвою: керівник читає аркуш згори, і найважчий товар має стояти першим.
 */
export function productDay(
  date: ISODate,
  pointId: PointId,
  receptions: Reception[],
  berries: Berry[],
): ProductDayRow[] {
  const productOf = new Map(berries.map((b) => [b.id, b.product]))
  const acc = new Map<string, { kgPoint: number; paid: number; lineCount: number }>()
  for (const r of receptions) {
    if (r.date !== date || r.pointId !== pointId) continue
    // Сорт, якого немає в довіднику, лишається окремим рядком під власним id: гроші не
    // мають зникати з аркуша тільки тому, що хтось прибрав сорт із BERRIES.
    const product = productOf.get(r.berryId) ?? r.berryId
    const cur = acc.get(product) ?? { kgPoint: 0, paid: 0, lineCount: 0 }
    cur.kgPoint += r.net
    cur.paid += r.amount
    cur.lineCount += 1
    acc.set(product, cur)
  }
  return [...acc.entries()]
    .map(([product, v]) => {
      const kgPoint = round2(v.kgPoint)
      const paid = round2(v.paid)
      return {
        product,
        kgPoint,
        paid,
        avgPoint: kgPoint === 0 ? 0 : paid / kgPoint,
        lineCount: v.lineCount,
      }
    })
    .sort((a, b) => (b.kgPoint - a.kgPoint) || a.product.localeCompare(b.product, 'uk'))
}

/**
 * Розподіл пулу між вагами — до копійки, метод найбільшого залишку (`09 §3.4`).
 *
 * Дробити частками з плаваючою точкою не можна: три поділки по 6,39344 не дають 5 460,00.
 * Тому працюємо В КОПІЙКАХ ЦІЛИМИ, а ваги приймаємо теж цілими (грами або копійки).
 * Множення — на `BigInt`: `poolKop × weight_g` при реальних обсягах підходить до 2^53
 * (546 000 × 790 000 = 4,3 × 10^11 тут, але на тонажі сезону це вже мільярди помножені на
 * мільйони), і double там більше не гарантує точного `div`/`mod`.
 *
 * Тай-брейк детермінований: більший залишок, далі більша вага, далі ключ за алфавітом —
 * інакше та сама копійка щоразу лягала б на інший товар.
 *
 * Відʼємний пул (надлишок переважив витрати) рахується на `abs(pool)` і повертається зі
 * знаком мінус: `div`/`mod` над відʼємними BigInt відсікають до нуля, і дефіцит вийшов би
 * не той.
 */
export function allocateByLargestRemainder(
  poolUah: Uah,
  weights: { key: string; weight: number }[],
): Map<string, Uah> {
  const out = new Map<string, Uah>()
  for (const w of weights) out.set(w.key, 0)

  const pool = round2(poolUah)
  const sign = pool < 0 ? -1 : 1
  const poolKop = BigInt(Math.round(Math.abs(pool) * 100))
  // відʼємна вага — не «менша частка», а зіпсовані дані; беремо за нуль
  const ints = weights.map((w) => ({
    key: w.key,
    w: BigInt(Math.max(0, Math.round(w.weight))),
  }))
  const total = ints.reduce((s, x) => s + x.w, 0n)
  if (total === 0n || poolKop === 0n) return out

  const parts = ints.map((x) => {
    const num = poolKop * x.w
    return { key: x.key, w: x.w, q: num / total, r: num % total }
  })
  let deficit = poolKop - parts.reduce((s, p) => s + p.q, 0n)
  const order = [...parts].sort((a, b) => {
    if (a.r !== b.r) return a.r > b.r ? -1 : 1
    if (a.w !== b.w) return a.w > b.w ? -1 : 1
    return a.key.localeCompare(b.key, 'uk')
  })
  for (const p of order) {
    if (deficit <= 0n) break
    p.q += 1n
    deficit -= 1n
  }
  for (const p of parts) out.set(p.key, round2((sign * Number(p.q)) / 100))
  return out
}

/**
 * `I49`, місце 1: селектор сорту на переважуванні пропонує лише товари, прийняті на цьому
 * пункті того дня. Чиста функція саме тому, що це та сама перевірка, що й у рушії, і
 * розійтися вони не мають права.
 */
export function reweighLineValid(product: string, dayProducts: string[]) {
  return dayProducts.includes(product)
}

export interface CostRow {
  product: string
  kgPoint: Kg
  paid: Uah
  /** НЕокруглена — див. `ProductDayRow.avgPoint` */
  avgPoint: number
  kgBase: Kg
  shortKg: Kg
  shortUah: Uah
  baseSum: Uah
  share: number
  alloc: Uah
  costTotal: Uah
  /** НЕокруглена: форматування — справа екрана, округлюємо ОДИН раз (§3.3) */
  avgFinal: number | null
  uplift: number | null
  upliftShort: number | null
  upliftExpense: number | null
  reweighed: boolean
  /** `I49`: рядок переважування на товар, якого на цьому пункті того дня не приймали */
  foreign: boolean
}

export interface Violation {
  code: string
  severity: 'block' | 'warn'
  message: string
}

export interface CostOfDay {
  date: ISODate
  pointId: PointId
  rows: CostRow[]
  manualExpenses: DayExpense[]
  /** СИНТЕЗОВАНИЙ щоразу; у стані такого рядка не буває (`I43`) */
  shortfallRow: DayExpense | null
  expensesManual: Uah
  shortfallTotal: Uah
  pool: Uah
  kgPointTotal: Kg
  kgBaseTotal: Kg
  paidTotal: Uah
  costTotal: Uah
  avgFinalTotal: number | null
  /** пул / Σ kgBase, НЕокруглена */
  rate: number
  upliftShortRate: number
  upliftExpenseRate: number
  basis: 'byWeight' | 'byValue'
  singleProduct: string | null
  /** true коли `kgPoint`/`avgPoint` узяті зі знімка проведеного переважування (`D-2`, `I41`) */
  fromSnapshot: boolean
  status: 'awaiting-reweigh' | 'summed'
  violations: Violation[]
  checks: { allocEqualsPool: boolean; conservation: boolean }
}

/** Та сама межа, що в `openDebts()`: пів копійки — це вже не «нуль», а копійка — вже помилка. */
const EPS = 0.009

/**
 * Зведення дня по пункту: `docs/09 §3.1`, дослівно.
 *
 * Дві речі, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. Після ПРОВЕДЕННЯ переважування `kgPoint`/`avgPoint` беруться ЗІ ЗНІМКА і НІКОЛИ не
 *    перераховуються з живих квитанцій (`D-2`, `I41`). Інакше пізня квитанція тихо
 *    переписує вчорашню собівартість — рівно так у їхньому Excel ламався «попередній».
 *    Розбіжність показується вголос як `I55`, а не мовчки.
 * 2. `paid` — це НАРАХОВАНО (Σ `Reception.amount`), а не готівка з каси. Борг дня на
 *    собівартість не впливає: ягода куплена — гроші зобовʼязані.
 */
export function costOfDay(input: {
  date: ISODate
  pointId: PointId
  receptions: Reception[]
  berries: Berry[]
  reweighs: Reweigh[]
  expenses: DayExpense[]
  policy?: ExpensePolicy
  /**
   * Поріг «недостача підозріло велика». 3 % — ДЕМОНСТРАЦІЙНЕ ЧИСЛО, НЕ УЗГОДЖЕНА ПОЛІТИКА:
   * нормальної недостачі у відсотках клієнт не називав, і питання стоїть у списку на
   * пʼятницю (`A-09`, `Q-07`). Тому це попередження, а не блок.
   */
  shortfallWarnPct?: number
  /**
   * Пункт **важить сам себе**: `kgBase = kgPoint` для кожного товару дня, тому недостачі в
   * нього немає **за визначенням** — недостача це різниця ваги пункту й ваги бази, а тут це
   * та сама вага. Пул зводиться до самих ручних витрат.
   *
   * ЧОМУ ЦЕ ІСНУЄ (рішення замовника 24.08.2026). База (`Point.kind === 'base'`, у сіді
   * `{ id: 'base', name: 'Склад' }`) — це місце, **де** переважують. Її власні квитанції не
   * переважує ніхто й ніколи, тому `kgBase` бази нульовий **за побудовою**, і рушій чесно
   * казав `awaiting-reweigh`. Але `09 §3.5` разом із `13 §4 S-22` вимагає включити базу в
   * мережеву суму — і без цього прапорця мережева звірка на 04.08.2026 розходилася **рівно
   * на 98 420,00 ₴, весь обіг складу**: `Σ нараховано` по всіх пунктах 383 471,55 + ручні
   * 23 530,00 = 407 001,55, а `Σ costTotal` виходило 308 581,55.
   *
   * Прапорець, а НЕ довідник `Point[]`: рушій не має ставати залежним від довідника пунктів
   * через одне поле, а `selfWeighed` описує саме те, що відбувається. На `kind` дивиться
   * викликач (`networkAverage`, сторінки).
   */
  selfWeighed?: boolean
}): CostOfDay {
  const { date, pointId, receptions, berries, reweighs, expenses } = input
  const warnPct = input.shortfallWarnPct ?? 3
  const selfWeighed = input.selfWeighed ?? false

  const live = productDay(date, pointId, receptions, berries)
  const mine = reweighs.filter((r) => r.berryDate === date && r.fromPointId === pointId)
  // `I54`: сторноване не рахується, але й не пропадає — це просто фільтр, не порушення
  const active = mine.filter((r) => r.status !== 'voided' && r.lines.length > 0)
  // Знімок бере НАЙРАНІШЕ проведення: саме той момент, коли день зафіксували. Якщо машин
  // було дві, друга приїхала вже в зафіксований день і переписувати його не має права.
  const posted = active
    .filter((r) => r.status === 'posted' && r.snapshot.length > 0)
    .sort((a, b) =>
      a.weighedDate === b.weighedDate
        ? a.weighedTime.localeCompare(b.weighedTime)
        : a.weighedDate.localeCompare(b.weighedDate),
    )
  const snapshot = posted.length ? posted[0].snapshot : null
  const fromSnapshot = snapshot !== null

  /** Вага й ставка пункту: зі знімка, якщо день зведений, інакше з живих квитанцій. */
  const pointRows = new Map<string, { kgPoint: Kg; paid: Uah; avgPoint: number }>()
  if (snapshot) {
    for (const s of snapshot) {
      // `paid` відновлюється зі знімка тим самим множенням, яким його туди й поклали:
      // avgPoint там неокруглена, тому kgPoint × avgPoint дає рівно нараховане того дня
      pointRows.set(s.product, {
        kgPoint: s.kgPoint,
        paid: round2(s.kgPoint * s.avgPoint),
        avgPoint: s.avgPoint,
      })
    }
  } else {
    for (const r of live) {
      pointRows.set(r.product, { kgPoint: r.kgPoint, paid: r.paid, avgPoint: r.avgPoint })
    }
  }

  const baseByProduct = new Map<string, number>()
  if (selfWeighed) {
    // Вага пункту І Є наша вага. Документи переважування з `fromPointId === <цей пункт>`
    // у `kgBase` НЕ беруться навмисно: якби база колись відвантажила партію далі й це
    // записали переважуванням, воно розповіло б про відвантаження, а не про приймання —
    // і подвоїло б вагу дня. Знімок (`D-2`) при цьому лишається в силі: він визначає
    // `kgPoint`, а `kgBase` тут дорівнює саме йому.
    for (const [product, p] of pointRows) baseByProduct.set(product, p.kgPoint)
  } else {
    for (const rw of active) {
      for (const l of rw.lines) {
        baseByProduct.set(l.product, (baseByProduct.get(l.product) ?? 0) + l.netKg)
      }
    }
  }

  const products = [...new Set([...pointRows.keys(), ...baseByProduct.keys()])]

  interface Draft {
    product: string
    kgPoint: Kg
    paid: Uah
    avgPoint: number
    kgBase: Kg
    shortKg: Kg
    shortUah: Uah
    baseSum: Uah
    foreign: boolean
  }
  const drafts: Draft[] = products.map((product) => {
    const p = pointRows.get(product)
    const kgPoint = p?.kgPoint ?? 0
    const paid = p?.paid ?? 0
    const avgPoint = p?.avgPoint ?? 0
    const kgBase = round2(baseByProduct.get(product) ?? 0)
    // `I50`: shortKg/shortUah рахуються ЗАГАЛЬНОЮ формулою і для товару без переважування
    // теж (−kgPoint / −paid). Інакше `N` перестає скорочуватись і `I46` не сходиться.
    const shortKg = round2(kgBase - kgPoint)
    const shortUah = round2(shortKg * avgPoint)
    return {
      product,
      kgPoint,
      paid,
      avgPoint,
      kgBase,
      shortKg,
      shortUah,
      baseSum: round2(kgBase * avgPoint),
      foreign: p === undefined,
    }
  })

  const manualExpenses = expenses.filter(
    (e) => e.date === date && e.pointId === pointId && e.kind === 'manual',
  )
  const expensesManual = sum(manualExpenses, (e) => e.amount)
  // `I43`: недостача входить у пул ДОДАТНОЮ величиною. Зберегли б її як −1 660 — пул став
  // би 2 140, і собівартість розійшлася б із нарахованим на 2N (13 §1 П-1, §3.2).
  const shortfallTotal = round2(-sum(drafts, (d) => d.shortUah))
  const pool = round2(expensesManual + shortfallTotal)

  const kgBaseTotal = sum(drafts, (d) => d.kgBase)
  const kgPointTotal = sum(drafts, (d) => d.kgPoint)
  const paidTotal = sum(drafts, (d) => d.paid)

  const violations: Violation[] = []

  /* --- правило розподілу: належить ДНЮ, не глобальній настройці (D-3) --- */
  const askedBasis = input.policy?.basis ?? 'byWeight'
  const askedSingle = input.policy?.singleProduct ?? null
  const singleOk =
    askedSingle !== null && (baseByProduct.get(askedSingle) ?? 0) > 0
  if (askedSingle !== null && !singleOk) {
    violations.push({
      code: 'policy-fallback',
      severity: 'warn',
      message:
        `правило «усе на ${askedSingle}» тут не діє — того дня його не переважено, ` +
        `розподіл по вазі`,
    })
  }
  // У результат їде ДІЙСНЕ правило, а не запитане: екран, який показав би «усе на Порічку»
  // над таблицею, розкиданою по вазі, брехав би тихіше за будь-яку помилку. Тому при
  // відкоті і `basis`, і `singleProduct` показують те, що справді відпрацювало.
  const fellBack = askedSingle !== null && !singleOk
  const basis: 'byWeight' | 'byValue' = fellBack ? 'byWeight' : askedBasis
  const singleProduct = singleOk ? askedSingle : null

  const weightOf = (d: Draft) => {
    if (singleProduct !== null) return d.product === singleProduct ? 1 : 0
    // цілі: грами для «по вазі», копійки для «по сумі» — жодного Math.round на частках
    return basis === 'byValue' ? Math.round(d.baseSum * 100) : Math.round(d.kgBase * 1000)
  }
  const weights = drafts.map((d) => ({ key: d.product, weight: weightOf(d) }))
  const weightTotal = weights.reduce((s, w) => s + w.weight, 0)
  const alloc = allocateByLargestRemainder(pool, weights)

  const rate = kgBaseTotal === 0 ? 0 : pool / kgBaseTotal
  const upliftShortRate = kgBaseTotal === 0 ? 0 : shortfallTotal / kgBaseTotal
  const upliftExpenseRate = kgBaseTotal === 0 ? 0 : expensesManual / kgBaseTotal

  const rows: CostRow[] = drafts.map((d) => {
    const a = alloc.get(d.product) ?? 0
    const costTotal = round2(d.baseSum + a)
    const reweighed = d.kgBase > 0
    return {
      product: d.product,
      kgPoint: d.kgPoint,
      paid: d.paid,
      avgPoint: d.avgPoint,
      kgBase: d.kgBase,
      shortKg: d.shortKg,
      shortUah: d.shortUah,
      baseSum: d.baseSum,
      share: weightTotal === 0 ? 0 : weightOf(d) / weightTotal,
      alloc: a,
      costTotal,
      avgFinal: reweighed ? costTotal / d.kgBase : null,
      uplift: reweighed ? a / d.kgBase : null,
      upliftShort: reweighed ? upliftShortRate : null,
      upliftExpense: reweighed ? upliftExpenseRate : null,
      reweighed,
      foreign: d.foreign,
    }
  })
  rows.sort(
    (a, b) =>
      (b.kgPoint - a.kgPoint) ||
      (b.kgBase - a.kgBase) ||
      a.product.localeCompare(b.product, 'uk'),
  )

  const costTotal = sum(rows, (r) => r.costTotal)
  const allocSum = sum(rows, (r) => r.alloc)

  /* --- інваріанти: рушій ЗОБОВʼЯЗАНИЙ віддати їх, а не сховати в тесті --- */
  for (const r of rows) {
    if (Math.abs(r.baseSum - round2(r.paid + r.shortUah)) > EPS) {
      violations.push({
        code: 'I42',
        severity: 'block',
        message:
          `${r.product}: сума за нашою вагою ${r.baseSum.toFixed(2)} ₴ не дорівнює ` +
          `нарахованому з недостачею ${round2(r.paid + r.shortUah).toFixed(2)} ₴`,
      })
    }
    if (r.foreign) {
      violations.push({
        code: 'I49',
        severity: 'block',
        message:
          `${r.product}: цього товару на цьому пункті того дня не приймали — ` +
          `${r.kgBase.toFixed(2)} кг переважування стоять окремим рядком`,
      })
    }
    // `I50` має сенс лише коли день переважений, а цей товар пропустили. Коли не переважено
    // НІЧОГО, це `I51`, і 8 однакових попереджень поруч із ним були б шумом.
    if (kgBaseTotal > 0 && r.kgBase === 0 && r.kgPoint > 0) {
      violations.push({
        code: 'I50',
        severity: 'warn',
        message: `${r.product} прийняли, а зважити забули — собівартості в нього поки немає`,
      })
    }
    if (r.avgFinal !== null && r.avgFinal < r.avgPoint - EPS) {
      violations.push({
        code: 'I47',
        severity: 'warn',
        message:
          `Собівартість нижча за закупку: ${r.product} ${r.avgFinal.toFixed(4)} < ` +
          `${r.avgPoint.toFixed(4)} ₴/кг — так буває тільки при надлишку, перевірте`,
      })
    }
    if (r.reweighed && r.kgPoint > 0) {
      const pct = (Math.abs(r.shortKg) / r.kgPoint) * 100
      if (pct > warnPct) {
        violations.push({
          code: 'shortfall-threshold',
          severity: 'warn',
          message: `${r.product}: недостача ${pct.toFixed(1)} % — перевірте вагу й тару`,
        })
      }
    }
  }

  const allocEqualsPool = Math.abs(allocSum - pool) <= EPS
  if (!allocEqualsPool) {
    violations.push({
      code: 'I45',
      severity: 'block',
      message:
        `розподілено ${allocSum.toFixed(2)} ₴ із пулу ${pool.toFixed(2)} ₴ — ` +
        `${round2(pool - allocSum).toFixed(2)} ₴ лишилися нерозподіленими`,
    })
  }
  // Порівнюємо саме з `Σ нараховано + ручні витрати`, а НЕ з `Σ baseSum + пул`: друге —
  // тавтологія, зелена завжди, бо costTotal := baseSum + alloc за побудовою (§3.2).
  const conservation = Math.abs(costTotal - round2(paidTotal + expensesManual)) <= EPS
  if (!conservation) {
    violations.push({
      code: 'I46',
      severity: 'block',
      message:
        `собівартість ${costTotal.toFixed(2)} ₴ не дорівнює нарахованому з витратами ` +
        `${round2(paidTotal + expensesManual).toFixed(2)} ₴ — гроші дня десь зникли`,
    })
  }
  if (kgBaseTotal === 0 && drafts.length > 0) {
    // У повідомленні стоять саме РУЧНІ витрати, не пул: без переважування вся вага дня
    // читається загальною формулою як недостача, і `pool` тут роздутий на ціну всієї ягоди.
    // Сказати керівникові «13 800 ₴ витрат» замість «1 800 ₴» означало б збрехати цифрою.
    violations.push({
      code: 'I51',
      severity: 'warn',
      message:
        `переважування ще немає — ${expensesManual.toFixed(2)} ₴ витрат поки нікуди не лягли`,
    })
  }
  if (snapshot) {
    const liveByProduct = new Map(live.map((r) => [r.product, r]))
    for (const s of snapshot) {
      const now = liveByProduct.get(s.product)
      const nowKg = now?.kgPoint ?? 0
      const nowUah = now ? now.paid : 0
      const wasUah = round2(s.kgPoint * s.avgPoint)
      if (Math.abs(nowKg - s.kgPoint) > EPS || Math.abs(nowUah - wasUah) > EPS) {
        violations.push({
          code: 'I55',
          severity: 'warn',
          message:
            `${s.product}: день змінився після зведення — було ${s.kgPoint.toFixed(2)} кг / ` +
            `${wasUah.toFixed(2)} ₴, стало ${nowKg.toFixed(2)} кг / ${nowUah.toFixed(2)} ₴`,
        })
      }
    }
    for (const r of live) {
      if (!snapshot.some((s) => s.product === r.product)) {
        violations.push({
          code: 'I55',
          severity: 'warn',
          message:
            `${r.product}: день змінився після зведення — було 0,00 кг / 0,00 ₴, стало ` +
            `${r.kgPoint.toFixed(2)} кг / ${r.paid.toFixed(2)} ₴`,
        })
      }
    }
  }

  return {
    date,
    pointId,
    rows,
    manualExpenses,
    shortfallRow:
      Math.abs(shortfallTotal) <= EPS
        ? null
        : {
            // Стабільний id: рядок синтезується щоразу заново, і плаваючий id робив би з
            // нього новий запис при кожному перемальовуванні екрана.
            id: `exp_short_${date}_${pointId}`,
            date,
            pointId,
            kind: 'shortfall',
            label: 'Недостача в ягоді',
            amount: shortfallTotal,
            createdBy: 'Система',
            createdDate: date,
            createdTime: '00:00',
            note: 'Рахує система з різниці ваг — руками не змінюється (I43)',
          },
    expensesManual,
    shortfallTotal,
    pool,
    kgPointTotal,
    kgBaseTotal,
    paidTotal,
    costTotal,
    avgFinalTotal: kgBaseTotal === 0 ? null : costTotal / kgBaseTotal,
    rate,
    upliftShortRate,
    upliftExpenseRate,
    basis,
    singleProduct,
    fromSnapshot,
    status: kgBaseTotal === 0 ? 'awaiting-reweigh' : 'summed',
    violations,
    checks: { allocEqualsPool, conservation },
  }
}

/* ------------------------- зведення по мережі (09 §3.5) ------------------------- */

export interface NetworkProductRow {
  product: string
  /** Собівартість кілограма по кожному пункті (avgFinal). Пункт без цього товару — ВІДСУТНІЙ. */
  byPoint: Map<PointId, number>
  kg: Kg
  cost: Uah
  /** НЕокруглена; null коли kg === 0 (на екрані «—», ніколи «NaN») */
  avg: number | null
}

export interface NetworkAverage {
  date: ISODate
  /** Пункти, які увійшли у зведення, у порядку довідника */
  pointIds: PointId[]
  byPoint: Map<PointId, CostOfDay>
  products: NetworkProductRow[]
  total: { kg: Kg; cost: Uah; avg: number | null }
  /**
   * `I46` на рівні мережі — ВИДИМЕ число, не assert у тесті.
   * diff = round2(costTotal − (paidTotal + expensesManual)); ok = |diff| ≤ EPS.
   */
  reconciliation: {
    costTotal: Uah
    paidTotal: Uah
    expensesManual: Uah
    diff: Uah
    ok: boolean
  }
  /** true коли жоден включений пункт того дня не зведений (UC-32 А1) */
  awaitingReweigh: boolean
}

/**
 * `M23`, дослівно за клієнтом: «сума додається, а середня ціна просто вже береться
 * формулою. Сума розділити на вагу» (`09 §3.5`).
 *
 * ```
 * kgNet[t]   = Σ_p kgBase[p][t]      ← p: усі пункти, що приймали ягоду, ВКЛЮЧНО З БАЗОЮ
 * costNet[t] = Σ_p costTotal[p][t]
 * avgNet[t]  = costNet[t] / kgNet[t]
 * ```
 *
 * Три речі, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. **Зважена середня, НІКОЛИ середнє середніх.** День із 5 кг не важить стільько ж, як
 *    день із 3 000 кг, і `total.avg` — це завжди `cost / kg`, а не середнє по `products`.
 * 2. **Порожня клітинка — це НЕ нуль.** Пункт, який того дня цього товару не приймав, у
 *    `byPoint` відсутній і в середню не входить узагалі.
 * 3. **Політика належить ПАРІ (пункт, день)** (`D-3`), тому кожному `costOfDay` своя, і
 *    жодного спільного `policy` на мережу тут немає — саме цим цей підпис відрізняється
 *    від застарілого прикладу в `docs/10` Задачі 8.
 *
 * Пункт із ручними витратами й БЕЗ квитанцій включається **навмисно**: інакше його гроші
 * тихо зникли б зі звірки. Краще видима розбіжність, ніж непомітна.
 */
export function networkAverage(input: {
  date: ISODate
  points: Point[]
  receptions: Reception[]
  berries: Berry[]
  reweighs: Reweigh[]
  expenses: DayExpense[]
  policies: ExpensePolicy[]
  shortfallWarnPct?: number
}): NetworkAverage {
  const { date, points, receptions, berries, reweighs, expenses, policies } = input

  const withReceptions = new Set(receptions.filter((r) => r.date === date).map((r) => r.pointId))
  const withExpenses = new Set(
    expenses.filter((e) => e.date === date && e.kind === 'manual').map((e) => e.pointId),
  )
  // Порядок — довідника: керівник читає колонки в тому самому порядку, що й на решті екранів
  const pointIds = points
    .filter((p) => withReceptions.has(p.id) || withExpenses.has(p.id))
    .map((p) => p.id)

  const byPoint = new Map<PointId, CostOfDay>()
  for (const p of points) {
    if (!pointIds.includes(p.id)) continue
    byPoint.set(
      p.id,
      costOfDay({
        date,
        pointId: p.id,
        receptions,
        berries,
        reweighs,
        expenses,
        // політика — ПОПУНКТНА, `D-3`: одна на мережу переписала б правило чужого пункту
        policy: policies.find((x) => x.date === date && x.pointId === p.id),
        // база важить сама себе — див. `selfWeighed` у `costOfDay()` і 98 420,00 ₴ там же
        selfWeighed: p.kind === 'base',
        shortfallWarnPct: input.shortfallWarnPct,
      }),
    )
  }

  const acc = new Map<string, NetworkProductRow>()
  for (const pointId of pointIds) {
    const day = byPoint.get(pointId)
    if (!day) continue
    for (const row of day.rows) {
      /*
       * `I50`/`I51`: товар без переважування у мережеву вагу не входить (його `kgBase = 0`)
       * і в колонці пункту його немає.
       *
       * І ТУТ ПОТРІБНА ЧЕСНІСТЬ ПРО ТЕ, ЧОГО `reconciliation` НЕ ДОВОДИТЬ. Вона доводить
       * збереження грошей У КОЖНОМУ ПУНКТІ — а НЕ повноту матриці. Гроші незваженого
       * товару в `diff` НЕ лишаються: за `I50` його недостача дорівнює 100 % нарахованого,
       * за `13 §1 П-1` вона входить у пул, і пул розкладається на ІНШІ товари ТОГО САМОГО
       * пункту, підіймаючи їхню собівартість. Тому звірка виходить `diff = 0,00`, `ok`,
       * зелена ✓ — і при цьому вага з матриці зникла.
       *
       * Зміряно на демо-даних, 22.07.2026, Гайове (`p3`): Ожина 46,90 кг / 3 470,60 ₴ не
       * зважена, пул пункту роздувся до 7 143,12 ₴ і ліг увесь на малину — її собівартість
       * там 176,3492 проти закупки 127,6240. Мережева середня того дня виходить
       * 131,2357 ₴/кг замість 128,5146, тобто на 2,1 % завищена: 46,90 кг вийшли з ваги,
       * а гроші лишилися.
       *
       * Рушій робить тут рівно те, що вимагають `I50` і `П-1` — правити його не треба.
       * Єдине, що про цей стан говорить, — попередження `I50` у `violations` пункту, і
       * саме воно (а не звірка) мусить бути видне на екрані.
       */
      if (row.kgBase <= 0 || row.avgFinal === null) continue
      const cur =
        acc.get(row.product) ??
        { product: row.product, byPoint: new Map<PointId, number>(), kg: 0, cost: 0, avg: null }
      cur.byPoint.set(pointId, row.avgFinal)
      cur.kg = round2(cur.kg + row.kgBase)
      cur.cost = round2(cur.cost + row.costTotal)
      acc.set(row.product, cur)
    }
  }

  const products = [...acc.values()]
    .map((r) => ({ ...r, avg: r.kg > 0 ? r.cost / r.kg : null }))
    .sort((a, b) => (b.kg - a.kg) || a.product.localeCompare(b.product, 'uk'))

  const kg = sum(products, (r) => r.kg)
  const cost = sum(products, (r) => r.cost)

  const days = [...byPoint.values()]
  const costTotal = sum(days, (d) => d.costTotal)
  const paidTotal = sum(days, (d) => d.paidTotal)
  const expensesManual = sum(days, (d) => d.expensesManual)
  const diff = round2(costTotal - round2(paidTotal + expensesManual))

  return {
    date,
    pointIds,
    byPoint,
    products,
    // «Разом» — завжди сума / вага, і тільки так (§3.5)
    total: { kg, cost, avg: kg > 0 ? cost / kg : null },
    reconciliation: { costTotal, paidTotal, expensesManual, diff, ok: Math.abs(diff) <= EPS },
    // Порожній день (жодного пункту) — це «нічого не приймали», а не «очікує переважування»
    awaitingReweigh: days.length > 0 && days.every((d) => d.status === 'awaiting-reweigh'),
  }
}

/* ------------------------- здавальники за вагою (09 Н11) ------------------------- */

export interface TopSupplierRow {
  supplierId: SupplierId
  /** Клієнт просила цю колонку ПЕРШОЮ: «спочатку населений пункт я би хотіла бачити». */
  village: string
  name: string
  kgTotal: Kg
  amountTotal: Uah
  /** Агрегує `Berry.product` — ТОВАР, не сорт. Тому й колонка на екрані «Основний товар». */
  topProduct: string
}

/**
 * `M26`, Н11: хто нам взагалі везе. Вага складається по **всіх пунктах** — та сама людина
 * може везти на різні точки (`UC-33 А2`). `M27` (мережевий довідник) скасовано (`13 §1 П-3`),
 * але агрегація ваги — ні: мережевим стає ЗВІТ, а не залишок. Залишок і борг лишаються
 * попунктними, і ця функція їх не торкається зовсім.
 *
 * Сортування: вага ↓ («з більшого до меншого»), тай-брейк — село, далі прізвище. Тай-брейк
 * не косметика: без нього два постачальники з однаковою вагою мінялися б місцями між
 * перемальовуваннями, і керівник читав би щоразу інший аркуш.
 *
 * Період фільтрує ВКЛЮЧНО з обома межами.
 */
export function topSuppliers(
  receptions: Reception[],
  suppliers: Supplier[],
  berries: Berry[],
  from: ISODate,
  to: ISODate,
): TopSupplierRow[] {
  const productOf = new Map(berries.map((b) => [b.id, b.product]))
  const acc = new Map<string, { kg: Kg; uah: Uah; byProduct: Map<string, Kg> }>()
  for (const r of receptions) {
    if (r.date < from || r.date > to) continue
    const cur = acc.get(r.supplierId) ?? { kg: 0, uah: 0, byProduct: new Map<string, Kg>() }
    cur.kg = round2(cur.kg + r.net)
    cur.uah = round2(cur.uah + r.amount)
    // Сорт, якого немає в довіднику, лишається окремим рядком під власним id — так само,
    // як у productDay(): вага не має зникати тільки тому, що хтось прибрав сорт із BERRIES.
    const product = productOf.get(r.berryId) ?? r.berryId
    cur.byProduct.set(product, round2((cur.byProduct.get(product) ?? 0) + r.net))
    acc.set(r.supplierId, cur)
  }
  const byId = new Map(suppliers.map((s) => [s.id, s]))
  return [...acc.entries()]
    .map(([supplierId, a]) => {
      const s = byId.get(supplierId)
      const top = [...a.byProduct.entries()].sort(
        (x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0], 'uk'),
      )[0]
      return {
        supplierId,
        village: s?.village ?? '',
        name: s?.name ?? '',
        kgTotal: a.kg,
        amountTotal: a.uah,
        topProduct: top?.[0] ?? '',
      }
    })
    .sort(
      (a, b) =>
        (b.kgTotal - a.kgTotal) ||
        a.village.localeCompare(b.village, 'uk') ||
        a.name.localeCompare(b.name, 'uk'),
    )
}
