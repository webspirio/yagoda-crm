import type { Allocation, ISODate, Payout, Reception, Supplier, TareLine, TareType } from './types'

export const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

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
  tare: TareLine[]
  price: number
  bonus: number
}

export interface WeighResult {
  gross: number
  tareWeight: number
  tareUnits: number
  net: number
  effectivePrice: number
  amount: number
}

/** The whole Excel formula column, in one place. */
export function weigh(input: WeighInput, tareTypes: TareType[]): WeighResult {
  const tw = tareWeight(input.tare, tareTypes)
  const net = round2(Math.max(0, input.gross - tw))
  const effectivePrice = round2(input.price + input.bonus)
  return {
    gross: round2(input.gross),
    tareWeight: tw,
    tareUnits: input.tare.reduce((s, l) => s + l.count, 0),
    net,
    effectivePrice,
    amount: round2(net * effectivePrice),
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

/** Per-reception outstanding remainder after allocations, oldest first. */
export function openDebts(supplierId: string, receptions: Reception[], payouts: Payout[]) {
  const settledByReception = new Map<string, number>()
  for (const p of payouts) {
    if (p.supplierId !== supplierId) continue
    for (const a of p.allocations) {
      settledByReception.set(a.receptionId, (settledByReception.get(a.receptionId) ?? 0) + a.amount)
    }
  }
  return receptions
    .filter((r) => r.supplierId === supplierId && r.debt > 0)
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
}

/** FIFO: spend `amount` on the oldest open remainders first. */
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
  /** total cash that left the till today */
  cashOut: number
  /** balances created today */
  newDebt: number
  /** breakdown of past-day settlements by the date the berry was accepted */
  pastByOriginDate: { date: ISODate; amount: number }[]
  /** accrued − paidToday − newDebt, always 0 in a consistent ledger */
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
  const newDebt = round2(dayReceptions.reduce((s, r) => s + r.debt, 0))
  const paidForPastDays = round2(dayPayouts.reduce((s, p) => s + p.amount, 0))

  const byOrigin = new Map<ISODate, number>()
  for (const p of dayPayouts) {
    for (const a of p.allocations) {
      byOrigin.set(a.originDate, round2((byOrigin.get(a.originDate) ?? 0) + a.amount))
    }
  }

  return {
    date,
    accrued,
    netKg: round2(dayReceptions.reduce((s, r) => s + r.net, 0)),
    receptionCount: dayReceptions.length,
    paidToday,
    paidForPastDays,
    cashOut: round2(paidToday + paidForPastDays),
    newDebt,
    pastByOriginDate: [...byOrigin.entries()]
      .map(([d, amount]) => ({ date: d, amount }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    drift: round2(accrued - paidToday - newDebt),
  }
}

export function effectivePriceFor(supplier: Supplier | undefined, dayPrice: number) {
  return round2(dayPrice + (supplier?.bonus ?? 0))
}

/** Unique reception dates a payout closed, oldest first. */
export function originDates(allocations: Allocation[]) {
  return [...new Set(allocations.map((a) => a.originDate))].sort()
}

export function sum<T>(items: T[], pick: (t: T) => number) {
  return round2(items.reduce((s, i) => s + pick(i), 0))
}
