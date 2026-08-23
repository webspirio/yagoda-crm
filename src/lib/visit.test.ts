import { beforeEach, describe, expect, it } from 'vitest'
import {
  openDebts,
  reconcileDay,
  round2,
  supplierBalance,
  supplierBalanceAt,
  visitMath,
} from './calc'
import { scopedReceptions, useStore } from './store'
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

  /**
   * Е2 · залишок попунктний — «він цей борг з іншої точки забрати не може» (дзвінок №4, ряд. 902).
   *
   * Вкладено сюди свідомо: `balanceAt()` (:10) — рівно та книга, з якої читає `SupplierPicker`,
   * і пункт «пікер = картка = чек» порівнює екрани саме з нею.
   *
   * Код із `docs/15` З5 крок 1 тут НЕ відтворено дослівно, бо він неправильний: там звужені
   * квитанції, але ПОВНИЙ масив виплат, а `supplierBalance()` віднімає кожну виплату людини
   * незалежно від пункту. На сіді дослівний варіант дає 1 288 розбіжностей із пікером і
   * 1 237 відʼємних «залишків», тобто `expect(…p4…).toBe(0)` із плану впав би мінусом.
   * Але звузити ОБА масиви — теж неправильно, і це показала перевірка коду: `payout.pointId`
   * це каса, з якої вийшла готівка, а не пункт погашеної ягоди. Екрани (`SuppliersPage`,
   * `SupplierPage`, `ReceiptDialog`) рахують книгу пункту через `supplierBalanceAt()` — по
   * прив'язках, як і решта сімох через `openDebts()`. Тест фіксує цей контракт.
   */
  describe('Е2 · залишок попунктний', () => {
    /** книга пункту так, як її рахують екрани: по прив'язках виплат, не по їхньому штампу */
    const cardBalance = (supplierId: string, pointId: string) => {
      const st = useStore.getState()
      return supplierBalanceAt(supplierId, st.receptions, st.payouts, pointId)
    }

    /** точки, на які людина справді возила ягоду */
    const pointsWithBerry = (supplierId: string) => {
      const st = useStore.getState()
      return new Set(st.receptions.filter((r) => r.supplierId === supplierId).map((r) => r.pointId))
    }

    it('борг однієї точки не видно з іншої: на чужій точці рівно 0, а не мінус', () => {
      const st = useStore.getState()
      const pointIds = st.points.map((p) => p.id)
      // людина, закріплена за p1 і з реальним боргом на p1: без боргу перевірка «на чужій
      // точці нуль» нічого не варта — нуль там був би і так
      const home = st.suppliers.find(
        (s) => s.homePointId === 'p1' && cardBalance(s.id, 'p1') > 0.009,
      )!
      const away = pointIds.find((p) => !pointsWithBerry(home.id).has(p))!

      expect(cardBalance(home.id, 'p1')).toBeGreaterThan(0)
      expect(cardBalance(home.id, away)).toBe(0)

      // і так для КОЖНОЇ пари людина×точка без квитанцій — інакше «рівно 0» тримався б на
      // одному щасливому прикладі. Мінус тут означав би, що книга пункту гасить чужі гроші:
      // саме це й давав повний масив виплат.
      let checked = 0
      for (const s of st.suppliers) {
        const own = pointsWithBerry(s.id)
        for (const p of pointIds) {
          if (own.has(p)) continue
          checked++
          expect(cardBalance(s.id, p)).toBe(0)
        }
      }
      expect(checked).toBeGreaterThan(1500)
    })

    it('те, що бачить пікер, дорівнює тому, що покажуть картка й чек', () => {
      const st = useStore.getState()
      const pointIds = st.points.map((p) => p.id)
      let pairs = 0
      for (const s of st.suppliers) {
        for (const p of pointIds) {
          pairs++
          // пікер друкує Σ відкритих решток (тому ніколи не мінус), картка й чек — баланс
          // книги, який на переплаченому рядку вміє бути відʼємним. `max(0, …)` — і є контракт
          expect(balanceAt(s.id, p)).toBe(round2(Math.max(0, cardBalance(s.id, p))))
        }
      }
      expect(pairs).toBe(st.suppliers.length * pointIds.length)
    })

    it('справжній випадок, а не тавтологія: у людини з двома точками книга точки менша за мережу', () => {
      const st = useStore.getState()
      const spread = st.suppliers
        .map((s) => ({ id: s.id, pts: [...pointsWithBerry(s.id)] }))
        .filter((x) => x.pts.length >= 2)
      // 101 такий постачальник на сіді. Якби їх було нуль, два тести вище проходили б
      // тавтологічно — «нуль дорівнює нулю» на людині, що возила в одну точку
      expect(spread.length).toBeGreaterThan(50)

      // саме дві точки й на кожній непорожня книга — інакше «own < all» трималося б на
      // точці, де людина возила, але вже все забрала
      const two = spread.find(
        (x) => x.pts.length === 2 && x.pts.every((p) => cardBalance(x.id, p) > 0.009),
      )!
      const network = supplierBalance(two.id, st.receptions, st.payouts)
      for (const p of two.pts) {
        expect(cardBalance(two.id, p)).toBeGreaterThan(0)
        expect(cardBalance(two.id, p)).toBeLessThan(network)
      }
      expect(round2(two.pts.reduce((a, p) => a + cardBalance(two.id, p), 0))).toBe(network)

      // і це не поодинокий випадок: у 97 із 101 кожна окрема книга строго менша за мережеву
      let strict = 0
      for (const x of spread) {
        const net = supplierBalance(x.id, st.receptions, st.payouts)
        if (net > 0.009 && x.pts.every((p) => cardBalance(x.id, p) < net - 0.009)) strict++
      }
      expect(strict).toBeGreaterThan(50)
    })

    /**
     * Регресія. Видача в режимі «Усі точки» (`SettleDialog` без `scopePointId`) гасить
     * прийомки КІЛЬКОХ пунктів однією виплатою, а `pointId` штампує пунктом найстарішого
     * залишку. Поки книга пункту рахувалася як `supplierBalance()` над виплатами,
     * звуженими за цим штампом, ця одна дія розводила дві формули: пункт-штамп показував
     * −7 975,30 ₴ (і саме це друкувалося на чеку, який людина забирає з собою), сусідній —
     * +7 975,30 ₴ при ПОРОЖНЬОМУ списку решток, хоча мережевий борг дорівнював нулю.
     * Жоден тест цього не ловив: у сіді немає виплати, чиї прив'язки перетинають пункт
     * (`seed.test.ts` це навіть стверджує), тому дірка була досяжна лише через стор.
     */
    it('видача в режимі «Усі точки» не розводить книгу пункту зі списком її ж решток', () => {
      const st = useStore.getState()
      // людина з відкритим залишком на ДВОХ пунктах — інакше перетину прив'язок не буде
      const pointIds = st.points.map((p) => p.id)
      const target = st.suppliers
        .map((s) => ({ id: s.id, pts: pointIds.filter((p) => cardBalance(s.id, p) > 0.009) }))
        .find((x) => x.pts.length >= 2)!
      expect(target).toBeDefined()

      const openAll = openDebts(target.id, st.receptions, st.payouts)
      const total = round2(openAll.reduce((a, o) => a + o.open, 0))
      // рівно те, що робить SettleDialog у режимі «Усі точки»: без scopePointId,
      // а pointId — пункт найстарішого відкритого залишку
      useStore.getState().addPayout({
        date: TODAY,
        pointId: openAll[0].reception.pointId,
        supplierId: target.id,
        amount: total,
        operator: 'Каса',
      })

      const after = useStore.getState()
      expect(supplierBalance(target.id, after.receptions, after.payouts)).toBe(0)
      for (const p of target.pts) {
        const book = cardBalance(target.id, p)
        const remainders = round2(
          openDebts(target.id, scopedReceptions(after.receptions, p), after.payouts).reduce(
            (a, o) => a + o.open,
            0,
          ),
        )
        // книга пункту і сума її ж решток — одне число. Мінус тут = мінус на чеку
        expect(book).toBe(remainders)
        expect(book).toBeGreaterThanOrEqual(0)
      }
      // і розклад «Де саме лежить» усе одно сходиться з мережею
      expect(round2(pointIds.reduce((a, p) => a + cardBalance(target.id, p), 0))).toBe(0)
    })

    it('Σ попунктних залишків дорівнює мережевому — на цьому тримається розклад на картці', () => {
      const st = useStore.getState()
      const pointIds = st.points.map((p) => p.id)
      for (const s of st.suppliers) {
        const network = supplierBalance(s.id, st.receptions, st.payouts)
        expect(round2(pointIds.reduce((a, p) => a + cardBalance(s.id, p), 0))).toBe(network)
      }
      // розклад не має права загубити гроші на пункті, якого немає в довіднику
      expect(st.receptions.every((r) => pointIds.includes(r.pointId))).toBe(true)
      expect(st.payouts.every((p) => pointIds.includes(p.pointId))).toBe(true)
    })
  })
})
