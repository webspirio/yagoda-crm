import { describe, expect, it } from 'vitest'
import {
  cashStanding,
  checkBerryPayout,
  checkCrateRefund,
  owedToPoints,
  shiftDiscrepancy,
  sum,
  shiftStatusFor,
} from './calc'
// `CrateStanding` живе в calc.ts разом із `crateStanding()`, а не в types.ts: це форма
// ПРОЄКЦІЇ рушія, а не сутність моделі даних
import type { CrateStanding } from './calc'
import type { CashFloat, CrateIssue, CrateReturn, Payout, Reception, Transfer } from './types'

let seq = 0
const id = (p: string) => `${p}${(seq += 1)}`

const OPENED = '2026-07-29'

function float(over: Partial<CashFloat> = {}): CashFloat {
  return {
    id: over.id ?? id('cf'),
    pointId: 'p1',
    amount: 500_000,
    effectiveFrom: '2026-07-01',
    setBy: 'Керівник',
    setDate: '2026-07-01',
    setTime: '08:00',
    ...over,
  }
}

/** Квитанція, видана «в руки» повністю: paid = amount, боргу немає. */
function rec(date: string, paid: number, over: Partial<Reception> = {}): Reception {
  return {
    id: id('rc'),
    code: 'К-1',
    date,
    time: '10:00',
    pointId: 'p1',
    supplierId: 's1',
    berryId: 'b1',
    gross: 0,
    pallet: 0,
    tare: [],
    tareWeight: 0,
    net: 0,
    price: 0,
    bonus: 0,
    amount: paid,
    paid,
    debt: 0,
    carriedIn: 0,
    operator: 'Оксана Г.',
    synced: true,
    ...over,
  }
}

/** Виплата за давній борг — теж готівка з шухляди, але іншого дня ягода. */
function payout(date: string, amount: number, originDate: string, over: Partial<Payout> = {}): Payout {
  return {
    id: id('py'),
    code: 'В-1',
    date,
    time: '11:00',
    pointId: 'p1',
    supplierId: 's1',
    amount,
    allocations: [{ receptionId: 'старий', originDate, amount }],
    operator: 'Оксана Г.',
    synced: true,
    ...over,
  }
}

function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: over.id ?? id('tf'),
    date: '2026-08-04',
    pointId: 'p1',
    crates: 0,
    cash: 0,
    carrier: 'Перевізник',
    sentBy: 'Керівник',
    sentTime: '18:00',
    status: 'accepted',
    ...over,
  }
}

function issue(date: string, units: number, over: Partial<CrateIssue> = {}): CrateIssue {
  return {
    id: over.id ?? id('ci'),
    date,
    time: '09:00',
    pointId: 'p1',
    supplierId: 's1',
    units,
    mode: 'deposit',
    depositPerUnit: 120,
    depositTaken: units * 120,
    operatorId: 'Оксана Г.',
    ...over,
  }
}

function back(date: string, units: number, over: Partial<CrateReturn> = {}): CrateReturn {
  return {
    id: over.id ?? id('cr'),
    date,
    time: '12:00',
    pointId: 'p1',
    supplierId: 's1',
    units,
    allocations: [{ issueId: 'ci-x', units, perUnit: 120, amount: units * 120 }],
    depositRefund: units * 120,
    operatorId: 'Оксана Г.',
    ...over,
  }
}

const stand = (over: Partial<Parameters<typeof cashStanding>[0]> = {}) =>
  cashStanding({
    pointId: 'p1',
    date: '2026-08-04',
    openedOn: OPENED,
    floats: [float()],
    receptions: [],
    payouts: [],
    transfers: [],
    issues: [],
    returns: [],
    ...over,
  })

describe('cashStanding — каса це згортка подій, а не клітинка з фільтром (I56)', () => {
  it('без жодної події каса дорівнює наділу: 500 000,00, не хватає 0,00', () => {
    const s = stand()
    expect(s.berryCash).toBe(500_000)
    expect(s.expectedCash).toBe(500_000)
    expect(s.floatShortfall).toBe(0)
  })

  it('видали 445 253,92 за ягоду — у касі 54 746,08', () => {
    const s = stand({ receptions: [rec('2026-08-04', 445_253.92)] })
    expect(s.berryOut).toBe(445_253.92)
    expect(s.berryCash).toBe(54_746.08)
    expect(s.floatShortfall).toBe(445_253.92)
  })

  it('видача за ягоду ІНШИХ днів теж виходить із шухляди: 131 900 + 313 353,92', () => {
    const s = stand({
      receptions: [rec('2026-08-04', 131_900)],
      payouts: [payout('2026-08-04', 313_353.92, '2026-07-20')],
    })
    expect(s.paidToday).toBe(131_900)
    expect(s.paidForPastDays).toBe(313_353.92)
    expect(s.berryOut).toBe(445_253.92)
    expect(s.berryCash).toBe(54_746.08)
  })

  it('порядок подій не міняє результату: перевернутий масив дає ті самі 54 746,08', () => {
    const receptions = [rec('2026-07-31', 100_000), rec('2026-08-04', 345_253.92)]
    expect(stand({ receptions }).berryCash).toBe(54_746.08)
    expect(stand({ receptions: [...receptions].reverse() }).berryCash).toBe(54_746.08)
  })

  it('прийнятий переказ поповнює касу: 54 746,08 + 150 000 = 204 746,08', () => {
    const s = stand({
      receptions: [rec('2026-08-04', 445_253.92)],
      transfers: [transfer({ cash: 150_000, status: 'accepted' })],
    })
    expect(s.cashIn).toBe(150_000)
    expect(s.cashInToday).toBe(150_000)
    expect(s.berryCash).toBe(204_746.08)
    expect(s.floatShortfall).toBe(295_253.92)
  })

  it('НЕпідтверджений переказ каси не рухає — ні sent, ні disputed (I68)', () => {
    const receptions = [rec('2026-08-04', 445_253.92)]
    expect(stand({ receptions, transfers: [transfer({ cash: 150_000, status: 'sent' })] }).berryCash).toBe(54_746.08)
    expect(
      stand({ receptions, transfers: [transfer({ cash: 150_000, status: 'disputed', reportedCash: 140_000 })] })
        .berryCash,
    ).toBe(54_746.08)
    expect(stand({ receptions, transfers: [transfer({ cash: 150_000, status: 'void' })] }).berryCash).toBe(54_746.08)
  })

  it('I69: сума, яку назвала точка, у формулу не входить — 150 000, а не 140 000', () => {
    const s = stand({ transfers: [transfer({ cash: 150_000, reportedCash: 140_000, status: 'accepted' })] })
    expect(s.cashIn).toBe(150_000)
  })

  it('події до відкриття книги не читаються: 29.07 рахується, 28.07 ні', () => {
    const s = stand({ receptions: [rec('2026-07-28', 999_999), rec('2026-07-29', 40_820.83)] })
    expect(s.berryOut).toBe(40_820.83)
    expect(s.berryCash).toBe(459_179.17)
  })

  it('події після обраного дня не читаються: 05.08 не зменшує сьогоднішню касу', () => {
    const s = stand({ receptions: [rec('2026-08-04', 100_000), rec('2026-08-05', 400_000)] })
    expect(s.berryOut).toBe(100_000)
    expect(s.berryCash).toBe(400_000)
  })

  it('чужа точка не підмішується: 300 000 на p3 не чіпають p1', () => {
    const s = stand({
      receptions: [rec('2026-08-04', 300_000, { pointId: 'p3' })],
      transfers: [transfer({ pointId: 'p3', cash: 99_000 })],
    })
    expect(s.berryOut).toBe(0)
    expect(s.cashIn).toBe(0)
    expect(s.berryCash).toBe(500_000)
  })

  it('без наділу: наділ null, не хватає null, а каса рахується від нуля', () => {
    const s = stand({ floats: [], receptions: [rec('2026-08-04', 1_000)] })
    expect(s.float).toBeNull()
    expect(s.floatShortfall).toBeNull()
    expect(s.berryCash).toBe(-1_000)
  })

  it('наділ змінили посеред сезону: відкриття від 145 453, а «не хватає» від 500 000', () => {
    const s = stand({
      floats: [
        float({ id: 'f1', amount: 145_453, effectiveFrom: '2026-06-27' }),
        float({ id: 'f2', amount: 500_000, effectiveFrom: '2026-08-01' }),
      ],
    })
    expect(s.openingBalance).toBe(145_453)
    expect(s.float).toBe(500_000)
    expect(s.berryCash).toBe(145_453)
    expect(s.floatShortfall).toBe(354_547)
  })
})

describe('дві книги в одній шухляді (I57, ряд. 1104)', () => {
  it('завдатки лежать окремо: ягода 500 000, ящики 13 800, у шухляді 513 800', () => {
    const s = stand({ issues: [issue('2026-07-30', 115)] })
    expect(s.crateCash).toBe(13_800)
    expect(s.berryCash).toBe(500_000)
    expect(s.expectedCash).toBe(513_800)
  })

  it('повернення завдатку зменшує ТІЛЬКИ касу за ящики', () => {
    const s = stand({ issues: [issue('2026-07-30', 195)], returns: [back('2026-08-01', 80)] })
    expect(s.crateCash).toBe(13_800)
    expect(s.berryCash).toBe(500_000)
  })

  it('шухляда завжди дорівнює сумі двох книг', () => {
    const s = stand({
      receptions: [rec('2026-08-04', 445_253.92)],
      issues: [issue('2026-07-30', 115)],
    })
    expect(s.expectedCash).toBe(s.berryCash + s.crateCash)
    expect(s.expectedCash).toBe(68_546.08)
  })

  it('сторновані видача й повернення в касу за ящики не входять', () => {
    const s = stand({
      issues: [issue('2026-07-30', 115), issue('2026-07-31', 50, { voidedDate: '2026-07-31' })],
      returns: [back('2026-08-01', 10, { voidedDate: '2026-08-01' })],
    })
    expect(s.crateCash).toBe(13_800)
  })

  it('завдатки чужої точки не потрапляють у нашу шухляду', () => {
    const s = stand({ issues: [issue('2026-07-30', 115, { pointId: 'p3' })] })
    expect(s.crateCash).toBe(0)
  })
})

describe('G12 і I59 — заборони, у яких і живе розділення кас', () => {
  it('G12: у касі 12 400,00 — 42 500,00 видати не можна', () => {
    expect(checkBerryPayout(42_500, 12_400)).toEqual({ ok: false, max: 12_400 })
  })

  it('G12: рівно стільки, скільки є, видати можна', () => {
    expect(checkBerryPayout(12_400, 12_400).ok).toBe(true)
  })

  it('G12: порожня каса не видає нічого, і максимум 0, а не відʼємний', () => {
    expect(checkBerryPayout(1, -5_000)).toEqual({ ok: false, max: 0 })
  })

  it('I59: повернути завдаток 840,00 можна, коли каса за ЯГОДУ порожня', () => {
    expect(checkCrateRefund(840, 13_800).ok).toBe(true)
  })

  it('I59: але не можна, коли порожня каса за ЯЩИКИ', () => {
    expect(checkCrateRefund(840, 300)).toEqual({ ok: false, max: 300 })
  })

  it('повернення на 0,00 (уся видача була за розписку) дозволене', () => {
    expect(checkCrateRefund(0, 0).ok).toBe(true)
  })
})

describe('зміна: розбіжність і хто її закриває', () => {
  it('зійшлося: розбіжність 0,00, закриває приймальник', () => {
    expect(shiftDiscrepancy(15_416.1, 15_416.1)).toBe(0)
    expect(shiftStatusFor(0)).toBe('closed')
  })

  it('недостача 10 000,00 — відʼємна, і зміну закриває керівник', () => {
    expect(shiftDiscrepancy(5_416.1, 15_416.1)).toBe(-10_000)
    expect(shiftStatusFor(-10_000)).toBe('awaiting_explanation')
  })

  it('надлишок теж іде до керівника: 0,50 ₴ це вже не «зійшлося»', () => {
    expect(shiftDiscrepancy(15_416.6, 15_416.1)).toBe(0.5)
    expect(shiftStatusFor(0.5)).toBe('awaiting_explanation')
  })

  it('копійка розбіжності не тоне в округленні: 15 416,11 проти 15 416,10', () => {
    expect(shiftDiscrepancy(15_416.11, 15_416.1)).toBe(0.01)
    expect(shiftStatusFor(0.01)).toBe('awaiting_explanation')
  })
})

describe('owedToPoints — заборгованість перед точками (1187)', () => {
  const crates = (shortfall: number): CrateStanding => ({
    allotment: 800,
    inField: 0,
    atBase: shortfall,
    onHand: 800 - shortfall,
    shortfall,
    shipped: shortfall,
    returnedToPoint: 0,
  })

  it('дві точки: разом винні 505 043,49', () => {
    const rows = owedToPoints([{ id: 'p1' }, { id: 'p3' }], (pid) => ({
      cash:
        pid === 'p1'
          ? stand({ receptions: [rec('2026-08-04', 498_383.9)] })
          : stand({
              pointId: 'p3',
              floats: [float({ pointId: 'p3', amount: 50_000 })],
              receptions: [rec('2026-08-04', 6_659.59, { pointId: 'p3' })],
            }),
      crates: crates(pid === 'p1' ? 459 : 36),
    }))
    expect(rows.map((r) => r.owed)).toEqual([498_383.9, 6_659.59])
    expect(rows.map((r) => r.crateShortfall)).toEqual([459, 36])
    // Через sum(), а не через `+`: звичайне додавання дає тут 505043.49000000005 —
    // саме той клас похибки, від якого в цьому рушії існує round2.
    expect(sum(rows, (r) => r.owed ?? 0)).toBe(505_043.49)
  })
})

/**
 * Виправлення після рецензії хвилі 2: дві книги згортаються з РІЗНИМИ вікнами, і це не
 * описка. Ягода — від дня відкриття книги, бо на той день у неї вже є підсумок (наділ).
 * Завдатки такого підсумку не мають: гроші, взяті до відкриття книги, фізично лежать у
 * шухляді, поки ящики не повернули.
 */
describe('вікна двох книг — різні навмисно', () => {
  it('завдаток за 10.07 у книзі від 29.07 усе одно в шухляді: 13 800,00', () => {
    const s = stand({ issues: [issue('2026-07-10', 115)] })
    expect(s.crateCash).toBe(13_800)
    expect(s.expectedCash).toBe(513_800)
  })

  it('а видача за ягоду 28.07 у книгу від 29.07 не входить: каса лишається 500 000,00', () => {
    const s = stand({ receptions: [rec('2026-07-28', 999_999)] })
    expect(s.berryOut).toBe(0)
    expect(s.berryCash).toBe(500_000)
  })

  it('повернення до відкриття книги теж рахується: 23 400 − 9 600 = 13 800,00', () => {
    const s = stand({ issues: [issue('2026-07-10', 195)], returns: [back('2026-07-20', 80)] })
    expect(s.crateCash).toBe(13_800)
  })

  it('завдаток ЗАВТРАШНЬОГО дня у сьогоднішню шухляду не потрапляє', () => {
    const s = stand({ issues: [issue('2026-08-05', 100)] })
    expect(s.crateCash).toBe(0)
  })
})

/** Прогалини, знайдені мутаційною рецензією рушія каси. */
describe('прогалини мутаційної рецензії (каса)', () => {
  it('«не хватає» рахується від каси за ЯГОДУ: 445 253,92, а не 431 453,92', () => {
    const s = stand({
      receptions: [rec('2026-08-04', 445_253.92)],
      issues: [issue('2026-07-30', 115)],
    })
    expect(s.crateCash).toBe(13_800)
    expect(s.berryCash).toBe(54_746.08)
    // Наділ — це гроші на ягоду. Завдатки за ящики чужі, і зменшувати ними борг бази
    // перед точкою означало б розрахуватися з точкою її ж заставними грошима.
    expect(s.floatShortfall).toBe(445_253.92)
    expect(s.floatShortfall).not.toBe(431_453.92)
  })

  it('розклад дня — саме обраного: день без квитанцій дає 0,00, а не вчорашні 100 000', () => {
    const s = stand({
      date: '2026-08-04',
      receptions: [rec('2026-08-01', 100_000)],
      payouts: [payout('2026-08-01', 25_000, '2026-07-20')],
    })
    expect(s.berryOut).toBe(125_000)
    expect(s.paidToday).toBe(0)
    expect(s.paidForPastDays).toBe(0)
  })

  it('розклад дня не бере пізніший день: 04.08 показує свої 131 900, не 05.08', () => {
    const s = stand({
      date: '2026-08-04',
      receptions: [rec('2026-08-04', 131_900), rec('2026-08-05', 999_999)],
    })
    expect(s.paidToday).toBe(131_900)
  })
})

/**
 * Прогалини, знайдені другою мутаційною рецензією (хвиля 2). Кожна з них — правило, яке
 * до цього тримав лише той факт, що ніхто його не порушив.
 */
describe('прогалини другої рецензії (каса)', () => {
  it('СТОРНОВАНИЙ переказ забирає гроші назад, навіть якщо його встигли прийняти', () => {
    const withCash = stand({
      transfers: [transfer({ cash: 150_000, status: 'accepted', acceptedTime: '09:10' })],
    })
    expect(withCash.cashIn).toBe(150_000)
    const voided = stand({
      transfers: [
        transfer({
          cash: 150_000,
          status: 'void',
          acceptedTime: '09:10',
          voidedDate: '2026-08-04',
          voidedBy: 'Керівник',
        }),
      ],
    })
    expect(voided.cashIn).toBe(0)
    expect(voided.berryCash).toBe(500_000)
  })

  it('переказ ДО відкриття книги не поповнює її: 28.07 не рахується', () => {
    const s = stand({ transfers: [transfer({ date: '2026-07-28', cash: 99_000 })] })
    expect(s.cashIn).toBe(0)
  })

  it('«прийнято сьогодні» — саме сьогодні: 40 000, а не 190 000 за всю книгу', () => {
    const s = stand({
      transfers: [
        transfer({ date: '2026-07-31', cash: 150_000 }),
        transfer({ date: '2026-08-04', cash: 40_000 }),
      ],
    })
    expect(s.cashIn).toBe(190_000)
    expect(s.cashInToday).toBe(40_000)
  })

  it('погашення боргу ТОГО САМОГО дня теж виходить із шухляди: 25 000 не зникають', () => {
    // reconcileDay розділяє «за сьогоднішню ягоду» і «за ягоду інших днів», але з каси
    // виходить і третє — виплата, що гасить борг, створений сьогодні ж уранці (H9).
    const s = stand({
      receptions: [rec('2026-08-04', 10_000, { amount: 35_000, debt: 25_000 })],
      payouts: [payout('2026-08-04', 25_000, '2026-08-04')],
    })
    expect(s.paidToday).toBe(10_000)
    expect(s.paidForPastDays).toBe(0)
    expect(s.berryOut).toBe(35_000)
    expect(s.berryCash).toBe(465_000)
  })

  it('день, у якому були САМІ виплати, з каси не зникає: 313 353,92 віднято', () => {
    const s = stand({ payouts: [payout('2026-08-02', 313_353.92, '2026-07-20')] })
    expect(s.berryOut).toBe(313_353.92)
    expect(s.berryCash).toBe(186_646.08)
  })

  it('точка почала працювати пізніше — книга відкривається її наділом, а не нулем', () => {
    // Виправлено після ручного обходу зібраного артефакту: спільна дата відкриття на всю
    // мережу давала Конищеву «у касі −51 130,18 ₴». Книга точки не може починатися раніше
    // за її ж наділ — інакше згортка бере видатки, а підсумку, від якого їх віднімати, ще
    // немає.
    const s = stand({
      floats: [float({ amount: 500_000, effectiveFrom: '2026-08-01' })],
      receptions: [rec('2026-08-04', 1_000)],
    })
    expect(s.openedOn).toBe('2026-08-01')
    expect(s.openingBalance).toBe(500_000)
    expect(s.berryCash).toBe(499_000)
    expect(s.floatShortfall).toBe(1_000)
  })

  it('видатки ДО появи наділу точки в її книгу не входять: 01.08 читається, 31.07 ні', () => {
    const s = stand({
      floats: [float({ amount: 500_000, effectiveFrom: '2026-08-01' })],
      receptions: [rec('2026-07-31', 999_999), rec('2026-08-01', 1_000)],
    })
    expect(s.openedOn).toBe('2026-08-01')
    expect(s.berryOut).toBe(1_000)
    expect(s.berryCash).toBe(499_000)
  })

  it('наділ зʼявився РАНІШЕ за книгу — виграє дата книги, а не наділу', () => {
    const s = stand({ floats: [float({ amount: 500_000, effectiveFrom: '2026-06-27' })] })
    expect(s.openedOn).toBe(OPENED)
  })

  it('точка без наділу взагалі: книга від спільної дати, наділ і «не хватає» — «—»', () => {
    const s = stand({ floats: [], receptions: [rec('2026-08-04', 1_000)] })
    expect(s.openedOn).toBe(OPENED)
    expect(s.float).toBeNull()
    expect(s.floatShortfall).toBeNull()
    expect(s.berryCash).toBe(-1_000)
  })
})

describe('прогалини критика (каса)', () => {
  it('борг перед точкою НЕ гаситься її ж завдатками: 445 253,92, а не 431 453,92', () => {
    const rows = owedToPoints([{ id: 'p1' }], () => ({
      cash: stand({ receptions: [rec('2026-08-04', 445_253.92)], issues: [issue('2026-07-30', 115)] }),
      crates: {
        allotment: 800, inField: 195, atBase: 264, onHand: 341, shortfall: 459,
        shipped: 264, returnedToPoint: 0,
      },
    }))
    expect(rows[0].owed).toBe(445_253.92)
    expect(rows[0].berryCash).toBe(54_746.08)
  })

  it('каса за ящики бере ФАКТИЧНО внесене (depositTaken), а не перерахунок 20 × 120', () => {
    // Розділення джерел істини: `depositHeld` (скільки ми ВИННІ) рахується зі знімка ціни,
    // а `crateCash` (скільки ФІЗИЧНО зайшло в шухляду) — з поля документа. Коли вони
    // розходяться, шухляда мусить показувати те, що в неї справді поклали.
    const odd = issue('2026-07-30', 20, { depositPerUnit: 120, depositTaken: 2_000 })
    expect(stand({ issues: [odd] }).crateCash).toBe(2_000)
  })
})
