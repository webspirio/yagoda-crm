import { beforeEach, describe, expect, it } from 'vitest'
import { openDebts, reconcileDay, round2, supplierBalance, visitMath } from './calc'
import { useStore } from './store'
import { TODAY } from './seed'

/** Два візити однієї людини в один день: чек першого не має показувати гроші другого. */
describe('прив’язка виплати до візиту', () => {
  beforeEach(() => useStore.getState().resetDemo())

  /** баланс так, як його бачить пункт: книга кожного пункту своя */
  const balanceAt = (supplierId: string, pointId = 'p1') => {
    const st = useStore.getState()
    return round2(
      openDebts(
        supplierId,
        st.receptions.filter((r) => r.pointId === pointId),
        st.payouts,
      ).reduce((a, o) => a + o.open, 0),
    )
  }

  const pick = () => {
    const st = useStore.getState()
    return st.suppliers.map((s) => ({ id: s.id, b: balanceAt(s.id) })).find((x) => x.b > 500)!
  }

  const visit = (supplierId: string, amount: number, paid: number) =>
    useStore.getState().addVisit({
      date: TODAY, pointId: 'p1', supplierId, operator: 'Оксана Г.',
      carriedIn: balanceAt(supplierId),
      paid,
      lines: [{ berryId: 'v_mal_v', gross: amount / 140 + 1.2, pallet: 0, tare: [{ tareId: 'tr_cheshka', count: 1 }], tareWeight: 1.2, net: round2(amount / 140), price: 140, bonus: 0, amount }],
    })

  const receiptOf = (visitId: string) => {
    const st = useStore.getState()
    const lines = st.receptions.filter((r) => r.visitId === visitId)
    const accrued = round2(lines.reduce((s, l) => s + l.amount, 0))
    const carriedIn = round2(lines.reduce((s, l) => s + l.carriedIn, 0))
    const p = st.payouts.find((x) => x.visitId === visitId)
    const paidCash = round2(lines.reduce((s, l) => s + l.paid, 0) + (p?.amount ?? 0))
    return { total: round2(accrued + carriedIn), paidCash, remainder: round2(accrued + carriedIn - paidCash), payout: p }
  }

  it('візит, на якому старих грошей не видавали, не бере виплату іншого візиту', () => {
    const { id, b } = pick()
    const a = visit(id, 1000, 1000)          // 09:15 — платимо тільки сьогоднішню ягоду
    expect(a.payout).toBeUndefined()
    const bb = visit(id, 500, round2(500 + b)) // пізніше — забирає й старий залишок
    expect(bb.payout).toBeDefined()

    const recA = receiptOf(a.receptions[0].visitId!)
    expect(recA.paidCash).toBe(1000)          // рівно те, що видали на цьому чеку
    expect(recA.payout).toBeUndefined()
    expect(recA.remainder).toBe(b)
  })

  it('погашення зі сторінки «Залишки» не потрапляє в чек прийомки', () => {
    const { id } = pick()
    const a = visit(id, 1000, 1000)
    const st = useStore.getState()
    const open = openDebts(id, st.receptions, st.payouts)
    st.addPayout({ date: TODAY, pointId: 'p1', supplierId: id, amount: round2(open.reduce((s, o) => s + o.open, 0)), operator: 'Каса' })
    const recA = receiptOf(a.receptions[0].visitId!)
    expect(recA.paidCash).toBe(1000)
    expect(recA.payout).toBeUndefined()
  })

  it('засіяні виплати теж прив’язані до візиту, тому передрук історичного чека сходиться', () => {
    const st = useStore.getState()
    const withCarried = st.receptions.filter((r) => r.carriedIn > 0.009)
    expect(withCarried.length).toBeGreaterThan(50)
    let linked = 0
    for (const r of withCarried) {
      const p = st.payouts.find((x) => x.visitId === r.visitId)
      if (!p) continue
      linked++
      const lines = st.receptions.filter((x) => x.visitId === r.visitId)
      const accrued = round2(lines.reduce((s, l) => s + l.amount, 0))
      const paidCash = round2(lines.reduce((s, l) => s + l.paid, 0) + p.amount)
      // чек не має обіцяти від'ємного залишку
      expect(round2(accrued + r.carriedIn - paidCash)).toBeGreaterThanOrEqual(-0.01)
    }
    expect(linked).toBeGreaterThan(50)
  })

  it('кожна виплата з visitId посилається на наявний візит, і не більше однієї на візит', () => {
    const st = useStore.getState()
    const ids = st.payouts.filter((p) => p.visitId).map((p) => p.visitId!)
    expect(new Set(ids).size).toBe(ids.length)
    const visits = new Set(st.receptions.map((r) => r.visitId))
    for (const id of ids) expect(visits.has(id)).toBe(true)
  })

  it('Σ відкритих решток завжди дорівнює балансу, навіть із переплаченим рядком', () => {
    const st = useStore.getState()
    // сід навмисно містить кілька переплачених рядків ✓ H7 (у файлі їх 257)
    const overpaid = st.receptions.filter((r) => r.debt < -0.009)
    expect(overpaid.length).toBeGreaterThan(0)

    for (const s of st.suppliers) {
      const open = openDebts(s.id, st.receptions, st.payouts)
      const openTotal = round2(open.reduce((a, o) => a + o.open, 0))
      const balance = supplierBalance(s.id, st.receptions, st.payouts)
      // інакше картка постачальника перелічує рештки, що не сходяться з її ж балансом,
      // а «Видати все» видає гроші, яких не винні
      expect(openTotal).toBe(round2(Math.max(0, balance)))
    }
  })

  it('видача «все» нікого не заганяє в мінус', () => {
    const st = useStore.getState()
    const owed = st.suppliers
      .map((s) => ({ id: s.id, b: supplierBalance(s.id, st.receptions, st.payouts) }))
      .filter((x) => x.b > 0.009)
      .slice(0, 40)
    for (const o of owed) {
      useStore
        .getState()
        .addPayout({ date: TODAY, pointId: 'p1', supplierId: o.id, amount: o.b, operator: 'Каса' })
      const after = supplierBalance(
        o.id,
        useStore.getState().receptions,
        useStore.getState().payouts,
      )
      expect(after).toBeGreaterThanOrEqual(0)
    }
  })

  it('видача без ягоди гасить лише прийомки свого пункту', () => {
    const st = useStore.getState()
    // постачальник із боргом на двох пунктах: гроші з каси p1 не мають чіпати ягоду p5
    const two = st.suppliers
      .map((s) => ({
        id: s.id,
        p1: balanceAt(s.id, 'p1'),
        other: ['p2', 'p3', 'p4', 'p5']
          .map((p) => ({ p, v: balanceAt(s.id, p) }))
          .find((x) => x.v > 0.009),
      }))
      .find((x) => x.p1 > 100 && x.other)!
    expect(two).toBeDefined()

    const before = balanceAt(two.id, two.other!.p)
    useStore.getState().addPayout({
      date: TODAY,
      pointId: 'p1',
      supplierId: two.id,
      amount: two.p1,
      operator: 'Каса',
      scopePointId: 'p1',
    })
    const st2 = useStore.getState()
    const p = st2.payouts[st2.payouts.length - 1]
    // кожна алокація — на прийомку p1, і чужий пункт не зачеплений
    for (const a of p.allocations) {
      expect(st2.receptions.find((r) => r.id === a.receptionId)!.pointId).toBe('p1')
    }
    expect(balanceAt(two.id, two.other!.p)).toBe(before)
    expect(balanceAt(two.id, 'p1')).toBeLessThan(0.01)
  })

  it('звірка дня пункту сходиться після виплати, і колонка теж', () => {
    const st = useStore.getState()
    const withB = st.suppliers.map((s) => ({ id: s.id, b: balanceAt(s.id) })).find((x) => x.b > 500)!
    visit(withB.id, 2000, round2(2000 + withB.b))
    for (const pointId of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      const s2 = useStore.getState()
      const d = reconcileDay(
        TODAY,
        s2.receptions.filter((r) => r.pointId === pointId),
        s2.payouts.filter((p) => p.pointId === pointId),
      )
      // рядок «Розходження» — це арифметика кожного рядка
      expect(Object.is(d.drift, 0)).toBe(true)
      // а стовпчик «Звірка каси» має сходитися на closedHere, не на settledSameDay
      expect(round2(d.paidToday + d.closedHere + d.newDebt)).toBe(d.accrued)
      expect(d.newDebt).toBeGreaterThanOrEqual(0)
      expect(round2(d.paidToday + d.paidForPastDays + d.settledSameDay)).toBe(d.cashOut)
    }
  })

  it('visitMath і збережений візит дають ті самі гроші до копійки', () => {
    const { id, b } = pick()
    const m = visitMath({ lineAmounts: [1234.56], balance: b, includeBalance: true, paidInput: round2(1234.56 + b) })
    const v = visit(id, 1234.56, m.paid)
    const st = useStore.getState()
    const handed = round2(v.receptions.reduce((s, r) => s + r.paid, 0) + (v.payout?.amount ?? 0))
    expect(handed).toBe(m.paid)
    expect(balanceAt(id)).toBe(m.remainder)
    expect(st.receptions.length).toBeGreaterThan(0)
  })
})
