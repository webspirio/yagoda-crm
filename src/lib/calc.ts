import type { Allocation, ISODate, Payout, Reception, Settings, TareLine, TareType } from './types'

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
