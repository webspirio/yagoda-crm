import { describe, expect, it } from 'vitest'
import {
  allocatePayout,
  checkSurcharge,
  maskDecimalInput,
  openDebts,
  originDates,
  parseNumeric,
  reconcileDay,
  round2,
  splitPaidAcrossLines,
  sum,
  supplierBalance,
  tareWeight,
  visitMath,
  weigh,
} from './calc'
import { kg, num, uah } from './format'
import type { Payout, Reception, Settings, TareType } from './types'

/** Довідник, кол. G/H/I. Чешка стоїть у 1 701 рядку з 1 701 — інша тара тут лише для повноти. */
const TARE: TareType[] = [
  { id: 'cheshka', name: 'Чешка', weight: 1.2, price: 120 },
  { id: 'lubianka', name: 'Луб’янка', weight: 0.3, price: 50 },
  { id: 'mishok', name: 'Мішок', weight: 0.1, price: 10 },
  { id: 'yashchyk', name: 'Ящик', weight: 2, price: 20 },
]

const SETTINGS: Settings = { surchargeMin: -15, surchargeMax: 30 }

let seq = 0

/** Квитанція так, як її пише store.addVisit: debt = amount − paid. */
function rec(over: Partial<Reception> = {}): Reception {
  seq += 1
  const amount = over.amount ?? 0
  const paid = over.paid ?? 0
  const base: Reception = {
    id: `r${seq}`,
    code: `Ч-${String(seq).padStart(4, '0')}`,
    date: '2026-08-04',
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
    amount,
    paid,
    debt: round2(amount - paid),
    carriedIn: 0,
    operator: 'Приймальник',
    synced: true,
  }
  return { ...base, ...over }
}

function pay(over: Partial<Payout> = {}): Payout {
  seq += 1
  const base: Payout = {
    id: `pay${seq}`,
    code: `В-${String(seq).padStart(3, '0')}`,
    date: '2026-08-04',
    time: '18:00',
    pointId: 'p1',
    supplierId: 's1',
    amount: 0,
    allocations: [],
    operator: 'Приймальник',
    synced: true,
  }
  return { ...base, ...over }
}

/* ======================== round2 ======================== */

describe('round2', () => {
  it('прибирає float-пил', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.2 * 115)).toBe(138)
    expect(round2(3.33 * 3.33)).toBe(11.09)
  })

  it('половинка йде ВІД нуля на будь-якому порядку — і 1,005, і 8,325', () => {
    // epsilon відносний: абсолютний нахил лагодив 1,005 і губив 8,325 на грошових порядках.
    const table: [number, number][] = [
      [0.005, 0.01],
      [1.005, 1.01],
      [1.115, 1.12],
      [2.675, 2.68],
      [8.325, 8.33],
      [10.075, 10.08],
      [545.505, 545.51],
      [1019.105, 1019.11],
      [12480.005, 12480.01],
    ]
    for (const [v, expected] of table) expect(round2(v)).toBe(expected)
  })

  it('округлення симетричне: борг і переплата на тій самій половинці однакові', () => {
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(-8.325)).toBe(-8.33)
    for (const v of [0.005, 1.005, 2.675, 8.325, 1019.105, 12480.005]) {
      expect(round2(-v)).toBe(-round2(v))
    }
  })

  it('round2 не віддає мінусового нуля', () => {
    // −0 форматується як «−0,00» через num()/kg() і ламає будь-яке порівняння через Object.is.
    for (const v of [-0, -0.001, -0.004, -1.48e-12, -Number.MIN_VALUE]) {
      expect(Object.is(round2(v), 0)).toBe(true)
    }
  })

  it('нечисло — 0, а не NaN наскрізь', () => {
    expect(round2(Number.NaN)).toBe(0)
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0)
    expect(round2(Number.NEGATIVE_INFINITY)).toBe(0)
    // і тут теж не мінусовий нуль
    expect(Object.is(round2(Number.NEGATIVE_INFINITY), 0)).toBe(true)
  })
})

/* ======================== tareWeight ======================== */

describe('tareWeight', () => {
  it('115 ящиків Чешка × 1,2 кг = 138 кг, без пилу', () => {
    expect(tareWeight([{ tareId: 'cheshka', count: 115 }], TARE)).toBe(138)
  })

  it('порожній список — 0', () => {
    expect(tareWeight([], TARE)).toBe(0)
  })

  it('кілька видів тари складаються', () => {
    expect(
      tareWeight(
        [
          { tareId: 'cheshka', count: 10 },
          { tareId: 'mishok', count: 3 },
        ],
        TARE,
      ),
    ).toBe(12.3)
  })

  it('РИЗИК: невідомий id тари важить 0 і тихо роздуває чисту вагу', () => {
    // FIXME(calc.ts:20): помилка в довіднику тари не помітна — вона просто додає кілограми.
    expect(tareWeight([{ tareId: 'no-such-tare', count: 115 }], TARE)).toBe(0)
  })
})

/* ======================== weigh ======================== */

describe('weigh — колонка H: (D − G) − вага тари × F', () => {
  it('реальний максимум: 701,5 кг брутто, 115 Чешок, Піддон 18 кг → 545,5 кг', () => {
    const r = weigh(
      { gross: 701.5, pallet: 18, tare: [{ tareId: 'cheshka', count: 115 }], price: 0, bonus: 0 },
      TARE,
    )
    expect(r.gross).toBe(701.5)
    expect(r.pallet).toBe(18)
    expect(r.tareWeight).toBe(138)
    expect(r.tareUnits).toBe(115)
    expect(r.net).toBe(545.5)
  })

  it('Піддон знімається перед тарою: 701,5 − 18 − 138, а не 701,5 − 138 × щось', () => {
    const r = weigh(
      { gross: 701.5, pallet: 18, tare: [{ tareId: 'cheshka', count: 115 }], price: 0, bonus: 0 },
      TARE,
    )
    expect(r.net).toBe(round2(701.5 - r.pallet - r.tareWeight))
  })

  it('Піддон за замовчуванням 0', () => {
    const r = weigh({ gross: 100, tare: [{ tareId: 'cheshka', count: 10 }], price: 0, bonus: 0 }, TARE)
    expect(r.pallet).toBe(0)
    expect(r.net).toBe(88)
  })

  it('мінусовий Піддон не може накрутити чисту вагу', () => {
    const withNegative = weigh(
      { gross: 100, pallet: -50, tare: [{ tareId: 'cheshka', count: 10 }], price: 0, bonus: 0 },
      TARE,
    )
    const withZero = weigh(
      { gross: 100, pallet: 0, tare: [{ tareId: 'cheshka', count: 10 }], price: 0, bonus: 0 },
      TARE,
    )
    expect(withNegative.pallet).toBe(0)
    expect(withNegative.net).toBe(withZero.net)
    expect(withNegative.net).toBe(88)
  })

  it('чиста вага впирається в 0, а не йде в мінус', () => {
    const r = weigh(
      { gross: 3, pallet: 18, tare: [{ tareId: 'cheshka', count: 115 }], price: 95, bonus: 0 },
      TARE,
    )
    expect(r.net).toBe(0)
    expect(r.amount).toBe(0)
  })

  it('без float-пилу: 12,3 − 10 × 1,2 = 0,3, а не 0,30000000000000004', () => {
    const r = weigh(
      { gross: 12.3, tare: [{ tareId: 'cheshka', count: 10 }], price: 100.5, bonus: 0 },
      TARE,
    )
    expect(r.net).toBe(0.3)
    expect(r.amount).toBe(30.15)
  })

  it('сума = чиста вага × (ціна дня + Дод. ціна)', () => {
    const r = weigh(
      { gross: 701.5, pallet: 18, tare: [{ tareId: 'cheshka', count: 115 }], price: 95, bonus: 5 },
      TARE,
    )
    expect(r.effectivePrice).toBe(100)
    expect(r.amount).toBe(54550)
  })

  it('Дод. ціна буває мінусовою — «або підняти, або спустити»', () => {
    const r = weigh({ gross: 10, tare: [], price: 100, bonus: -15 }, TARE)
    expect(r.effectivePrice).toBe(85)
    expect(r.amount).toBe(850)
  })

  it('сума округлена до копійки', () => {
    const r = weigh({ gross: 3.33, tare: [], price: 3.33, bonus: 0 }, TARE)
    expect(r.net).toBe(3.33)
    expect(r.amount).toBe(11.09)
  })

  it('кілька видів тари в одному рядку: вага і к-сть складаються', () => {
    const r = weigh(
      {
        gross: 112.3,
        tare: [
          { tareId: 'cheshka', count: 10 },
          { tareId: 'mishok', count: 3 },
        ],
        price: 0,
        bonus: 0,
      },
      TARE,
    )
    expect(r.tareWeight).toBe(12.3)
    expect(r.tareUnits).toBe(13)
    expect(r.net).toBe(100)
  })

  it('нечислове брутто не доходить до квитанції: 0, а не NaN', () => {
    // gross тепер проходить round2 першим, тому вставлений NaN не стає ні вагою, ні сумою.
    const r = weigh({ gross: Number.NaN, tare: [], price: 95, bonus: 0 }, TARE)
    expect(r.gross).toBe(0)
    expect(r.net).toBe(0)
    expect(r.amount).toBe(0)
    const inf = weigh(
      { gross: Number.POSITIVE_INFINITY, tare: [{ tareId: 'cheshka', count: 10 }], price: 95, bonus: 0 },
      TARE,
    )
    expect(inf.gross).toBe(0)
    expect(inf.net).toBe(0)
    expect(inf.amount).toBe(0)
  })

  it('без тари: чиста вага = брутто − Піддон', () => {
    const r = weigh({ gross: 3, pallet: 0, tare: [], price: 40, bonus: 0 }, TARE)
    expect(r.net).toBe(3)
    expect(r.amount).toBe(120)
  })
})

/* ======================== visitMath (M10) ======================== */

describe('visitMath — M10 «щоб воно додало, да, щоб разом»', () => {
  it('приклад із дорожньої карти: 12 480 + 1 340 = 13 820, видано 13 800 → залишок 20', () => {
    const m = visitMath({
      lineAmounts: [12480],
      balance: 1340,
      includeBalance: true,
      paidInput: 13800,
    })
    expect(m.accrued).toBe(12480)
    expect(m.carriedIn).toBe(1340)
    expect(m.total).toBe(13820)
    expect(m.paid).toBe(13800)
    expect(m.paidToday).toBe(12480)
    expect(m.paidToPast).toBe(1320)
    expect(m.debtToday).toBe(0)
    expect(m.remainder).toBe(20)
  })

  it('кілька рядків одного візиту підбиваються в одне «Разом» (M5)', () => {
    const m = visitMath({
      lineAmounts: [8320, 3160, 1000],
      balance: 1340,
      includeBalance: true,
      paidInput: 13800,
    })
    expect(m.accrued).toBe(12480)
    expect(m.total).toBe(13820)
    expect(m.remainder).toBe(20)
  })

  it('стеля видачі — «Разом», а не сьогоднішня ягода', () => {
    const m = visitMath({
      lineAmounts: [12480],
      balance: 1340,
      includeBalance: true,
      paidInput: 999999,
    })
    expect(m.payCap).toBe(13820)
    expect(m.paid).toBe(13820)
    expect(m.paidToday).toBe(12480)
    expect(m.paidToPast).toBe(1340)
    expect(m.debtToday).toBe(0)
    expect(m.remainder).toBe(0)
  })

  it('видати більше за сьогоднішню ягоду можна — надлишок іде в минулі дні', () => {
    const m = visitMath({
      lineAmounts: [12480],
      balance: 1340,
      includeBalance: true,
      paidInput: 13000,
    })
    expect(m.paid).toBe(13000)
    expect(m.paidToday).toBe(12480)
    expect(m.paidToPast).toBe(520)
    expect(m.remainder).toBe(820)
  })

  it('«Враховувати залишок» вимкнено → поводимося точно як до M10', () => {
    const off = visitMath({
      lineAmounts: [12480],
      balance: 1340,
      includeBalance: false,
      paidInput: 13800,
    })
    expect(off.carriedIn).toBe(0)
    expect(off.total).toBe(12480)
    expect(off.payCap).toBe(off.accrued)
    expect(off.paid).toBe(12480)
    expect(off.paidToday).toBe(12480)
    expect(off.paidToPast).toBe(0)
    expect(off.debtToday).toBe(0)
    expect(off.remainder).toBe(0)
  })

  it('«Враховувати залишок» вимкнено → paidToPast завжди 0, скільки б не ввели', () => {
    for (const paidInput of [0, 1, 5000, 12479.99, 12480, 12480.01, 99999]) {
      const off = visitMath({ lineAmounts: [12480], balance: 1340, includeBalance: false, paidInput })
      expect(off.carriedIn).toBe(0)
      expect(off.payCap).toBe(12480)
      expect(off.paidToPast).toBe(0)
      expect(off.paid).toBeLessThanOrEqual(12480)
      expect(off.remainder).toBe(off.debtToday)
    }
  })

  it('вимкнений перемикач: частина суми → залишок цієї квитанції', () => {
    const off = visitMath({
      lineAmounts: [12480],
      balance: 1340,
      includeBalance: false,
      paidInput: 5000,
    })
    expect(off.paidToday).toBe(5000)
    expect(off.debtToday).toBe(7480)
    expect(off.remainder).toBe(7480)
  })

  it('мінусовий залишок (переплачений постачальник) переноситься як 0, не як мінус', () => {
    const m = visitMath({
      lineAmounts: [12480],
      balance: -5000,
      includeBalance: true,
      paidInput: 13800,
    })
    expect(m.carriedIn).toBe(0)
    expect(m.total).toBe(12480)
    expect(m.payCap).toBe(12480)
    expect(m.paid).toBe(12480)
    expect(m.paidToPast).toBe(0)
    expect(m.remainder).toBe(0)
  })

  it('«Усе в залишок» — видано 0 → залишок дорівнює «Разом»', () => {
    const m = visitMath({ lineAmounts: [12480], balance: 1340, includeBalance: true, paidInput: 0 })
    expect(m.paid).toBe(0)
    expect(m.paidToday).toBe(0)
    expect(m.paidToPast).toBe(0)
    expect(m.debtToday).toBe(12480)
    expect(m.remainder).toBe(m.total)
    expect(m.remainder).toBe(13820)
  })

  it('сміття в полі видачі → 0, і жодного мінуса ніде', () => {
    for (const paidInput of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -99999]) {
      const m = visitMath({ lineAmounts: [12480], balance: 1340, includeBalance: true, paidInput })
      expect(m.paid).toBe(0)
      expect(m.paidToday).toBe(0)
      expect(m.paidToPast).toBe(0)
      expect(m.remainder).toBe(13820)
      for (const v of [m.accrued, m.carriedIn, m.total, m.payCap, m.paid, m.paidToday, m.paidToPast, m.debtToday, m.remainder]) {
        expect(v).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('копійки не пливуть: 12 480,33 + 1 340,17 = 13 820,50', () => {
    const m = visitMath({
      lineAmounts: [4160.11, 4160.11, 4160.11],
      balance: 1340.17,
      includeBalance: true,
      paidInput: 13820.5,
    })
    expect(m.accrued).toBe(12480.33)
    expect(m.carriedIn).toBe(1340.17)
    expect(m.total).toBe(13820.5)
    expect(m.paid).toBe(13820.5)
    expect(m.paidToday).toBe(12480.33)
    expect(m.paidToPast).toBe(1340.17)
    expect(m.remainder).toBe(0)
  })

  it('копійки: видано з недобором на 1 копійку', () => {
    const m = visitMath({
      lineAmounts: [12480.33],
      balance: 1340.17,
      includeBalance: true,
      paidInput: 13820.49,
    })
    expect(m.paidToPast).toBe(1340.16)
    expect(m.remainder).toBe(0.01)
  })

  it('тотожності тримаються до копійки', () => {
    const cases: { lineAmounts: number[]; balance: number; includeBalance: boolean; paidInput: number }[] = [
      { lineAmounts: [12480], balance: 1340, includeBalance: true, paidInput: 13800 },
      { lineAmounts: [12480], balance: 1340, includeBalance: false, paidInput: 13800 },
      { lineAmounts: [4160.11, 4160.11, 4160.11], balance: 1340.17, includeBalance: true, paidInput: 13820.5 },
      { lineAmounts: [0.01], balance: 0.02, includeBalance: true, paidInput: 0.02 },
      { lineAmounts: [3, 3.7, 81525], balance: 0, includeBalance: true, paidInput: 81531.7 },
      { lineAmounts: [], balance: 1340, includeBalance: true, paidInput: 1000 },
      { lineAmounts: [1000], balance: 129278, includeBalance: true, paidInput: 130278 },
      { lineAmounts: [2824.5], balance: 855676, includeBalance: true, paidInput: 0 },
      { lineAmounts: [12480], balance: 1340, includeBalance: true, paidInput: Number.NaN },
    ]
    for (const c of cases) {
      const m = visitMath(c)
      expect(m.total).toBe(round2(m.accrued + m.carriedIn))
      expect(m.payCap).toBe(m.total)
      expect(m.paid).toBeLessThanOrEqual(m.payCap)
      expect(round2(m.paidToday + m.paidToPast)).toBe(m.paid)
      expect(m.debtToday).toBe(round2(m.accrued - m.paidToday))
      expect(m.remainder).toBe(round2(m.total - m.paid))
      expect(round2(m.debtToday + m.carriedIn - m.paidToPast)).toBe(m.remainder)
    }
  })

  it('візит без ягоди — людина прийшла лише за грошима', () => {
    const m = visitMath({ lineAmounts: [], balance: 1340, includeBalance: true, paidInput: 1340 })
    expect(m.accrued).toBe(0)
    expect(m.total).toBe(1340)
    expect(m.paidToday).toBe(0)
    expect(m.paidToPast).toBe(1340)
    expect(m.remainder).toBe(0)
  })

  it('порожній візит без залишку — усі нулі', () => {
    const m = visitMath({ lineAmounts: [], balance: 0, includeBalance: true, paidInput: 500 })
    expect(m.total).toBe(0)
    expect(m.payCap).toBe(0)
    expect(m.paid).toBe(0)
    expect(m.remainder).toBe(0)
  })
})

/* ======================== splitPaidAcrossLines ======================== */

describe('splitPaidAcrossLines', () => {
  it('перші рядки повні, недобір падає на останні (5 рядків — реальний максимум)', () => {
    const lines = [1000, 2000, 3000, 4000, 5000]
    expect(splitPaidAcrossLines(lines, 6500)).toEqual([1000, 2000, 3000, 500, 0])
  })

  it('Σ розподілу = видано за сьогоднішню ягоду', () => {
    const lines = [1000, 2000, 3000, 4000, 5000]
    for (const paidToday of [0, 1, 999, 1000, 6500, 14999.99, 15000]) {
      const parts = splitPaidAcrossLines(lines, paidToday)
      expect(sum(parts, (v) => v)).toBe(paidToday)
    }
  })

  it('один рядок', () => {
    expect(splitPaidAcrossLines([12480], 12480)).toEqual([12480])
    expect(splitPaidAcrossLines([12480], 5000)).toEqual([5000])
  })

  it('видано 0 — усі рядки в залишок', () => {
    expect(splitPaidAcrossLines([1000, 2000], 0)).toEqual([0, 0])
  })

  it('видано рівно Σ рядків — кожен рядок закритий повністю', () => {
    const lines = [8320, 3160, 1000]
    expect(splitPaidAcrossLines(lines, 12480)).toEqual(lines)
  })

  it('рядок на 0 ₴ не з’їдає гроші', () => {
    expect(splitPaidAcrossLines([0, 500], 300)).toEqual([0, 300])
    expect(splitPaidAcrossLines([500, 0], 300)).toEqual([300, 0])
    expect(splitPaidAcrossLines([0, 0], 0)).toEqual([0, 0])
  })

  it('копійки: 3 × 4 160,11 = 12 480,33', () => {
    const parts = splitPaidAcrossLines([4160.11, 4160.11, 4160.11], 12480.33)
    expect(parts).toEqual([4160.11, 4160.11, 4160.11])
    expect(sum(parts, (v) => v)).toBe(12480.33)
  })

  it('float-пил не тече в рядки', () => {
    const parts = splitPaidAcrossLines([0.1, 0.2], 0.3)
    expect(parts).toEqual([0.1, 0.2])
    // сира сума дає 0,30000000000000004 — тому store і рахує кожен рядок окремо
    expect(sum(parts, (v) => v)).toBe(0.3)
  })

  it('порожній візит — порожній розподіл', () => {
    expect(splitPaidAcrossLines([], 500)).toEqual([])
  })

  it('РИЗИК: видано більше за Σ рядків — надлишок зникає без сигналу', () => {
    // FIXME(calc.ts:266): у store такого не буває (paidToday = min(paid, accrued)),
    // але сама функція тихо губить різницю замість того, щоб про неї сказати.
    const parts = splitPaidAcrossLines([100, 200], 1000)
    expect(parts).toEqual([100, 200])
    expect(sum(parts, (v) => v)).toBe(300)
  })
})

/* ======================== maskDecimalInput (M7) ======================== */

describe('maskDecimalInput — «поставили кому там що хотіли»', () => {
  it('кома і точка — той самий розділювач', () => {
    expect(maskDecimalInput('10,05')).toBe('10.05')
    expect(maskDecimalInput('10.05')).toBe('10.05')
  })

  it('10,0 лишається 10,0 і не перетворюється в 100', () => {
    expect(maskDecimalInput('10,0')).toBe('10.0')
    expect(parseNumeric(maskDecimalInput('10,0'))).toBe(10)
  })

  it('не більше двох знаків після коми — решта відрізається', () => {
    expect(maskDecimalInput('10,057')).toBe('10.05')
    expect(maskDecimalInput('701,5555')).toBe('701.55')
  })

  it('літери, пробіли й знаки відкидаються', () => {
    expect(maskDecimalInput('10,0 кг')).toBe('10.0')
    expect(maskDecimalInput('abc')).toBe('')
    expect(maskDecimalInput('12 480,00')).toBe('12480.00')
    expect(maskDecimalInput('95 ₴/кг')).toBe('95')
  })

  it('другий розділювач не створює нового числа: 1,2,3 → 1.23', () => {
    expect(maskDecimalInput('1,2,3')).toBe('1.23')
    expect(parseNumeric(maskDecimalInput('1,2,3'))).toBe(1.23)
    expect(maskDecimalInput('0,,5')).toBe('0.5')
  })

  it('незакінчений ввід не ламається', () => {
    expect(maskDecimalInput('')).toBe('')
    expect(maskDecimalInput('10,')).toBe('10.')
    expect(parseNumeric(maskDecimalInput('10,'))).toBe(10)
    expect(maskDecimalInput(',5')).toBe('.5')
    expect(parseNumeric(maskDecimalInput(',5'))).toBe(0.5)
  })

  it('allowNegative — Дод. ціна реально ходить від −15 до +30', () => {
    expect(maskDecimalInput('-15', 2, true)).toBe('-15')
    expect(maskDecimalInput('-0,5', 2, true)).toBe('-0.5')
    expect(maskDecimalInput('30', 2, true)).toBe('30')
    expect(parseNumeric(maskDecimalInput('-15', 2, true))).toBe(-15)
  })

  it('одинокий мінус читається як 0, а не як NaN', () => {
    expect(maskDecimalInput('-', 2, true)).toBe('-')
    expect(parseNumeric(maskDecimalInput('-', 2, true))).toBe(0)
  })

  it('без allowNegative мінус відкидається, а цифри лишаються: −15 стає 15', () => {
    // FIXME(calc.ts:284): для ваги це 30 ₴/кг різниці, якби поле дозволяло знак.
    // Поле ваги знака не має, тому наслідків немає — але маска не відмовляє, вона перекручує.
    expect(maskDecimalInput('-15')).toBe('15')
  })

  it('мінус усередині числа просто зникає', () => {
    expect(maskDecimalInput('1-5')).toBe('15')
    expect(maskDecimalInput('--15', 2, true)).toBe('-15')
  })

  it('maxDecimals = 0 не лишає хвостового розділювача', () => {
    expect(maskDecimalInput('10,7', 0)).toBe('10')
    expect(maskDecimalInput('10.', 0)).toBe('10')
    expect(maskDecimalInput('10,75', 0)).toBe('10')
    expect(parseNumeric(maskDecimalInput('10,7', 0))).toBe(10)
  })

  it('мінус, який друкує uah() (U+2212), не перетворює −15 у +15', () => {
    // Дод. ціна −15, зчитана з екрана й набрана назад у поле, лишається −15:
    // інакше це 30 ₴/кг різниці на єдиному полі, яке законно буває відʼємним.
    expect(uah(-15)).toBe('−15 ₴')
    expect(maskDecimalInput(uah(-15), 2, true)).toBe('-15')
    expect(parseNumeric(uah(-15))).toBe(-15)
    expect(parseNumeric('−15,5')).toBe(-15.5)
    // без allowNegative знак і далі не приймається — вага відʼємною не буває
    expect(maskDecimalInput(uah(-15), 2)).toBe('15')
  })

  it('ГОЛОВНЕ ОБМЕЖЕННЯ: маска не бачить пропущеної коми — 100 замість 10,0', () => {
    // M7 просить і маску, І перевірку порядку величини. Другої в calc.ts немає.
    expect(maskDecimalInput('100')).toBe('100')
    expect(parseNumeric('100')).toBe(100)
  })
})

/* ======================== parseNumeric ======================== */

describe('parseNumeric', () => {
  it('кома з клавіатури', () => {
    expect(parseNumeric('10,05')).toBe(10.05)
    expect(parseNumeric('10.05')).toBe(10.05)
    expect(parseNumeric('701,5')).toBe(701.5)
  })

  it('сміття — 0', () => {
    expect(parseNumeric('abc')).toBe(0)
    expect(parseNumeric('-')).toBe(0)
    expect(parseNumeric('₴')).toBe(0)
  })

  it('порожньо — 0', () => {
    expect(parseNumeric('')).toBe(0)
    expect(parseNumeric('   ')).toBe(0)
  })

  it('мінус читається', () => {
    expect(parseNumeric('-15')).toBe(-15)
    expect(parseNumeric('-0,5')).toBe(-0.5)
  })

  it('неоднозначне число відмовлено, а не вгадано: «1,2,3» → 0', () => {
    // усі коми стають точками, тому '1.2.3' — не число: 0 тут означає відмову, не здогад
    expect(parseNumeric('1,2,3')).toBe(0)
    expect(parseNumeric('1.2.3')).toBe(0)
    // маска — інша річ: вона зводить те саме до 1,23, поки людина ще друкує
    expect(parseNumeric(maskDecimalInput('1,2,3'))).toBe(1.23)
  })

  it('сума з екрана назад у поле: нерозривний пробіл знімається', () => {
    // uah()/num() групують нерозривним пробілом (U+00A0), вузький нерозривний — U+202F
    expect(parseNumeric('12\u00A0480,00')).toBe(12480)
    expect(parseNumeric('12\u202F480,00')).toBe(12480)
    expect(parseNumeric('12\u00A0480\u00A0000,55')).toBe(12480000.55)
    // саме те, що друкує форматер, а не наша здогадка про його пробіл
    expect(parseNumeric(num(12480, 2))).toBe(12480)
    expect(parseNumeric(num(1012883))).toBe(1012883)
    // ₴ теж знімається: цифру з екрана виділяють разом із гривнею
    expect(parseNumeric(uah(12480, { decimals: 2 }))).toBe(12480)
    expect(parseNumeric(kg(701.5))).toBe(701.5)
    expect(parseNumeric(maskDecimalInput(uah(12480, { decimals: 2 })))).toBe(12480)
  })

  it('те саме зі звичайним пробілом і табуляцією', () => {
    expect(parseNumeric('12 480,00')).toBe(12480)
    expect(parseNumeric('\t701,5\n')).toBe(701.5)
    expect(parseNumeric(' 95 ')).toBe(95)
  })
})

/* ======================== checkSurcharge (M7) ======================== */

describe('checkSurcharge — «не більше 20… чи не більше 30»', () => {
  it('+30 всередині межі — межа включна', () => {
    expect(checkSurcharge(30, SETTINGS)).toEqual({ ok: true, over: false, under: false, clamped: 30 })
  })

  it('+31 — понад межу, на підтвердження керівнику', () => {
    const r = checkSurcharge(31, SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.over).toBe(true)
    expect(r.under).toBe(false)
    expect(r.clamped).toBe(30)
  })

  it('−16 — під межею', () => {
    const r = checkSurcharge(-16, SETTINGS)
    expect(r.ok).toBe(false)
    expect(r.under).toBe(true)
    expect(r.over).toBe(false)
    expect(r.clamped).toBe(-15)
  })

  it('−15 всередині межі — межа включна з двох боків', () => {
    expect(checkSurcharge(-15, SETTINGS).ok).toBe(true)
    expect(checkSurcharge(-14.99, SETTINGS).ok).toBe(true)
    expect(checkSurcharge(0, SETTINGS).ok).toBe(true)
    expect(checkSurcharge(29.99, SETTINGS).ok).toBe(true)
  })

  it('130 з M7 — рівно те, що не повинно пройти', () => {
    expect(checkSurcharge(130, SETTINGS).over).toBe(true)
    expect(checkSurcharge(130, SETTINGS).clamped).toBe(30)
  })

  it('нескінченність відхиляється, і видно, яку саме межу зламано', () => {
    expect(checkSurcharge(Number.POSITIVE_INFINITY, SETTINGS)).toEqual({
      ok: false,
      over: true,
      under: false,
      clamped: 30,
    })
    expect(checkSurcharge(Number.NEGATIVE_INFINITY, SETTINGS)).toEqual({
      ok: false,
      over: false,
      under: true,
      clamped: -15,
    })
  })

  it('NaN — не «ok»: жодної межі не зламано, але й числа немає', () => {
    // NaN > max і NaN < min обидва false, тому перевірка мусить відмовити окремо.
    expect(checkSurcharge(Number.NaN, SETTINGS)).toEqual({
      ok: false,
      over: false,
      under: false,
      clamped: 0,
    })
  })
})

/* ======================== двигун: борги, виплати, FIFO ======================== */

describe('supplierBalance', () => {
  it('Σ боргів − Σ виплат', () => {
    const receptions = [
      rec({ date: '2026-07-28', amount: 1000, paid: 500 }),
      rec({ date: '2026-07-31', amount: 1840, paid: 1000 }),
    ]
    const payouts = [pay({ amount: 1320 })]
    expect(supplierBalance('s1', receptions, payouts)).toBe(20)
  })

  it('чужий постачальник не впливає', () => {
    const receptions = [
      rec({ amount: 1000, paid: 0 }),
      rec({ supplierId: 's2', amount: 9999, paid: 0 }),
    ]
    const payouts = [pay({ supplierId: 's2', amount: 5000 })]
    expect(supplierBalance('s1', receptions, payouts)).toBe(1000)
  })

  it('переплата дає мінусовий баланс', () => {
    const receptions = [rec({ amount: 1000, paid: 1000 })]
    const payouts = [pay({ amount: 200 })]
    expect(supplierBalance('s1', receptions, payouts)).toBe(-200)
  })

  it('без записів — 0', () => {
    expect(supplierBalance('s1', [], [])).toBe(0)
  })
})

describe('openDebts', () => {
  it('сортує за датою, потім за часом', () => {
    const receptions = [
      rec({ id: 'c', date: '2026-07-31', time: '15:00', amount: 300, paid: 0 }),
      rec({ id: 'a', date: '2026-07-28', time: '09:00', amount: 100, paid: 0 }),
      rec({ id: 'b', date: '2026-07-31', time: '08:30', amount: 200, paid: 0 }),
    ]
    expect(openDebts('s1', receptions, []).map((x) => x.reception.id)).toEqual(['a', 'b', 'c'])
  })

  it('закриті й повністю виплачені квитанції не показуються', () => {
    const r1 = rec({ id: 'r_open', date: '2026-07-28', amount: 1000, paid: 500 })
    const r2 = rec({ id: 'r_closed', date: '2026-07-29', amount: 1000, paid: 1000 })
    const payouts = [
      pay({ amount: 500, allocations: [{ receptionId: 'r_open', originDate: '2026-07-28', amount: 500 }] }),
    ]
    expect(openDebts('s1', [r1, r2], payouts)).toEqual([])
  })

  it('часткова виплата лишає залишок відкритим', () => {
    const r1 = rec({ id: 'r_open', date: '2026-07-28', amount: 1000, paid: 500 })
    const payouts = [
      pay({ amount: 300, allocations: [{ receptionId: 'r_open', originDate: '2026-07-28', amount: 300 }] }),
    ]
    const open = openDebts('s1', [r1], payouts)
    expect(open).toHaveLength(1)
    expect(open[0].open).toBe(200)
  })

  it('мінусовий борг (переплачений рядок) не потрапляє в перелік', () => {
    const receptions = [rec({ amount: 1000, paid: 1200, debt: -200 })]
    expect(openDebts('s1', receptions, [])).toEqual([])
  })

  it('1 копійка — найменший борг, який ще видно', () => {
    const receptions = [rec({ date: '2026-07-28', amount: 0.01, paid: 0 })]
    expect(openDebts('s1', receptions, [])[0].open).toBe(0.01)
  })

  it('РИЗИК: борг менший за копійку округлюється ВГОРУ і Σ переліку більша за баланс', () => {
    // Через store такого не буває — і debt, і open проходять round2. Але якщо піваркопійки
    // колись з’являться (старий persist-стан, ручна правка), openDebts покаже по 0,01,
    // а supplierBalance — 0,02 на три такі борги. Дві цифри одного боргу розійдуться.
    const receptions = [
      rec({ date: '2026-07-28', amount: 0.005, paid: 0, debt: 0.005 }),
      rec({ date: '2026-07-29', amount: 0.005, paid: 0, debt: 0.005 }),
      rec({ date: '2026-07-30', amount: 0.005, paid: 0, debt: 0.005 }),
    ]
    const open = openDebts('s1', receptions, [])
    expect(open.map((o) => o.open)).toEqual([0.01, 0.01, 0.01])
    expect(supplierBalance('s1', receptions, [])).toBe(0.02)
  })

  it('виплати іншого постачальника не закривають ці борги', () => {
    const r1 = rec({ id: 'r_open', amount: 1000, paid: 0 })
    const payouts = [
      pay({
        supplierId: 's2',
        amount: 1000,
        allocations: [{ receptionId: 'r_open', originDate: '2026-07-28', amount: 1000 }],
      }),
    ]
    expect(openDebts('s1', [r1], payouts)[0].open).toBe(1000)
  })
})

describe('allocatePayout — FIFO, дати походження', () => {
  const receptions = [
    rec({ id: 'r_28', date: '2026-07-28', time: '09:00', amount: 1000, paid: 500 }),
    rec({ id: 'r_31', date: '2026-07-31', time: '11:00', amount: 1840, paid: 1000 }),
  ]

  it('спершу найстаріший борг, дата походження збережена', () => {
    const allocations = allocatePayout(1320, openDebts('s1', receptions, []))
    expect(allocations).toEqual([
      { receptionId: 'r_28', originDate: '2026-07-28', amount: 500 },
      { receptionId: 'r_31', originDate: '2026-07-31', amount: 820 },
    ])
  })

  it('не видає більше, ніж відкрито — надлишок нікуди не йде', () => {
    // FIXME(calc.ts:118): різниця (5000 − 1340) зникає без жодного сигналу назовні.
    const open = openDebts('s1', receptions, [])
    const allocations = allocatePayout(5000, open)
    expect(sum(allocations, (a) => a.amount)).toBe(1340)
    expect(sum(open, (o) => o.open)).toBe(1340)
  })

  it('часткова виплата закриває лише перший борг', () => {
    const allocations = allocatePayout(300, openDebts('s1', receptions, []))
    expect(allocations).toEqual([{ receptionId: 'r_28', originDate: '2026-07-28', amount: 300 }])
  })

  it('після часткової виплати залишок того самого борга ще відкритий', () => {
    const first = allocatePayout(300, openDebts('s1', receptions, []))
    const payouts = [pay({ amount: 300, allocations: first })]
    const open = openDebts('s1', receptions, payouts)
    expect(open.map((o) => [o.reception.id, o.open])).toEqual([
      ['r_28', 200],
      ['r_31', 840],
    ])
  })

  it('нуль не створює порожніх алокацій', () => {
    expect(allocatePayout(0, openDebts('s1', receptions, []))).toEqual([])
    expect(allocatePayout(0.004, openDebts('s1', receptions, []))).toEqual([])
  })

  it('РИЗИК: пів копійки округлюється ВГОРУ і закриває більше, ніж видано', () => {
    // FIXME(calc.ts:116): left = round2(amount) до розподілу, тому 0,005 ₴ на руки
    // списують 0,01 ₴ боргу. Пів копійки — але напрямок помилки на користь каси.
    expect(allocatePayout(0.005, openDebts('s1', receptions, []))).toEqual([
      { receptionId: 'r_28', originDate: '2026-07-28', amount: 0.01 },
    ])
  })

  it('немає відкритих боргів — немає алокацій', () => {
    expect(allocatePayout(1000, [])).toEqual([])
  })

  it('копійки в алокаціях не пливуть', () => {
    const kopeck = [
      rec({ id: 'k1', date: '2026-07-28', amount: 0.1, paid: 0 }),
      rec({ id: 'k2', date: '2026-07-29', amount: 0.2, paid: 0 }),
    ]
    const allocations = allocatePayout(0.3, openDebts('s1', kopeck, []))
    expect(allocations.map((a) => a.amount)).toEqual([0.1, 0.2])
    expect(sum(allocations, (a) => a.amount)).toBe(0.3)
  })

  it('РИЗИК: сама функція не сортує — порядок FIFO забезпечує openDebts()', () => {
    // FIXME(calc.ts:112): якщо колись викликати з несортованим переліком, «найстаріший»
    // перестане бути найстарішим і ніхто цього не помітить.
    const unsorted = [
      { reception: receptions[1], open: 840 },
      { reception: receptions[0], open: 500 },
    ]
    expect(allocatePayout(100, unsorted)[0].originDate).toBe('2026-07-31')
  })
})

describe('originDates', () => {
  it('унікальні дати, від старішої', () => {
    expect(
      originDates([
        { receptionId: 'a', originDate: '2026-07-31', amount: 1 },
        { receptionId: 'b', originDate: '2026-07-28', amount: 1 },
        { receptionId: 'c', originDate: '2026-07-31', amount: 1 },
      ]),
    ).toEqual(['2026-07-28', '2026-07-31'])
  })

  it('порожньо', () => {
    expect(originDates([])).toEqual([])
  })
})

describe('sum', () => {
  it('округлює до копійки', () => {
    expect(sum([{ v: 0.1 }, { v: 0.2 }], (x) => x.v)).toBe(0.3)
    expect(sum([], (x: { v: number }) => x.v)).toBe(0)
  })
})

/* ======================== reconcileDay ======================== */

describe('reconcileDay — «видача більша за ягоду»', () => {
  const TODAY = '2026-08-04'

  it('розділяє гроші за сьогоднішню ягоду і за минулі дні, drift 0', () => {
    const receptions = [
      rec({ date: '2026-07-28', amount: 1000, paid: 500 }),
      rec({ date: TODAY, time: '10:00', amount: 8320, paid: 8320, net: 83.2 }),
      rec({ date: TODAY, time: '10:05', amount: 4160, paid: 4160, net: 41.6 }),
    ]
    const payouts = [
      pay({
        date: TODAY,
        amount: 500,
        allocations: [{ receptionId: receptions[0].id, originDate: '2026-07-28', amount: 500 }],
      }),
    ]
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.accrued).toBe(12480)
    expect(d.netKg).toBe(124.8)
    expect(d.receptionCount).toBe(2)
    expect(d.paidToday).toBe(12480)
    expect(d.paidForPastDays).toBe(500)
    expect(d.settledSameDay).toBe(0)
    expect(d.cashOut).toBe(12980)
    expect(d.newDebt).toBe(0)
    expect(d.drift).toBe(0)
    expect(d.pastByOriginDate).toEqual([{ date: '2026-07-28', amount: 500 }])
  })

  it('H9: каса віддала більше, ніж коштує сьогоднішня ягода — drift лишається 0', () => {
    const receptions = [
      rec({ date: '2026-07-28', amount: 400000, paid: 0 }),
      rec({ date: TODAY, amount: 1012883, paid: 1012883 }),
    ]
    const payouts = [
      pay({
        date: TODAY,
        amount: 300275,
        allocations: [{ receptionId: receptions[0].id, originDate: '2026-07-28', amount: 300275 }],
      }),
    ]
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.accrued).toBe(1012883)
    expect(d.paidToday).toBe(1012883)
    expect(d.paidForPastDays).toBe(300275)
    expect(d.cashOut).toBe(1313158)
    expect(d.cashOut - d.accrued).toBe(300275)
    expect(d.newDebt).toBe(0)
    expect(d.drift).toBe(0)
  })

  it('частина суми лишилася в залишку — drift усе одно 0', () => {
    const receptions = [rec({ date: TODAY, amount: 12480, paid: 5000 })]
    const d = reconcileDay(TODAY, receptions, [])
    expect(d.paidToday).toBe(5000)
    expect(d.newDebt).toBe(7480)
    expect(d.drift).toBe(0)
  })

  it('pastByOriginDate розкладає виплату по датах походження, від старішої', () => {
    const receptions = [
      rec({ id: 'r_28', date: '2026-07-28', amount: 1000, paid: 500 }),
      rec({ id: 'r_31', date: '2026-07-31', amount: 1840, paid: 1000 }),
      rec({ date: TODAY, amount: 12480, paid: 12480 }),
    ]
    const payouts = [
      pay({
        date: TODAY,
        amount: 1320,
        allocations: [
          { receptionId: 'r_31', originDate: '2026-07-31', amount: 820 },
          { receptionId: 'r_28', originDate: '2026-07-28', amount: 500 },
        ],
      }),
    ]
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.pastByOriginDate).toEqual([
      { date: '2026-07-28', amount: 500 },
      { date: '2026-07-31', amount: 820 },
    ])
    expect(sum(d.pastByOriginDate, (x) => x.amount)).toBe(d.paidForPastDays)
    expect(d.settledSameDay).toBe(0)
  })

  it('виплата за справжній попередній день лишається попереднім днем: settledSameDay = 0', () => {
    // те, для чого весь двигун і існує: гроші, видані сьогодні за ягоду 28.07,
    // названі датою 28.07, а не сьогоднішньою.
    const old = rec({ id: 'r_28', date: '2026-07-28', time: '09:12', amount: 1000, paid: 500 })
    const allocations = allocatePayout(500, openDebts('s1', [old], []))
    expect(allocations).toEqual([{ receptionId: 'r_28', originDate: '2026-07-28', amount: 500 }])
    const payouts = [pay({ date: TODAY, amount: sum(allocations, (a) => a.amount), allocations })]
    const d = reconcileDay(TODAY, [old], payouts)
    expect(d.settledSameDay).toBe(0)
    expect(d.paidForPastDays).toBe(500)
    expect(d.pastByOriginDate).toEqual([{ date: '2026-07-28', amount: 500 }])
    expect(d.accrued).toBe(0)
    expect(d.paidToday).toBe(0)
    expect(d.newDebt).toBe(0)
    expect(d.cashOut).toBe(500)
    expect(d.drift).toBe(0)
    expect(supplierBalance('s1', [old], payouts)).toBe(0)
  })

  it('дві виплати за один день складаються по датах', () => {
    const receptions = [rec({ id: 'r_28', date: '2026-07-28', amount: 1000, paid: 0 })]
    const payouts = [
      pay({ date: TODAY, amount: 400, allocations: [{ receptionId: 'r_28', originDate: '2026-07-28', amount: 400 }] }),
      pay({ date: TODAY, amount: 600, allocations: [{ receptionId: 'r_28', originDate: '2026-07-28', amount: 600 }] }),
    ]
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.paidForPastDays).toBe(1000)
    expect(d.pastByOriginDate).toEqual([{ date: '2026-07-28', amount: 1000 }])
  })

  it('день без нічого', () => {
    const d = reconcileDay(TODAY, [], [])
    expect(d).toEqual({
      date: TODAY,
      accrued: 0,
      netKg: 0,
      receptionCount: 0,
      paidToday: 0,
      paidForPastDays: 0,
      settledSameDay: 0,
      closedHere: 0,
      cashOut: 0,
      newDebt: 0,
      pastByOriginDate: [],
      drift: 0,
    })
    // жоден нуль порожнього дня не мінусовий — інакше екран дня скаже «−0,00 ₴»
    for (const v of [d.accrued, d.netKg, d.paidToday, d.paidForPastDays, d.settledSameDay, d.cashOut, d.newDebt, d.drift]) {
      expect(Object.is(v, 0)).toBe(true)
    }
  })

  it('чужий день не потрапляє в підсумок', () => {
    const receptions = [rec({ date: '2026-08-03', amount: 999, paid: 999 })]
    const payouts = [pay({ date: '2026-08-03', amount: 100 })]
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.accrued).toBe(0)
    expect(d.cashOut).toBe(0)
  })

  it('та сама людина двічі за день — борг, закритий того ж дня, не потрапляє в попередні дні', () => {
    // Візит 1, 09:00: ягода 1 000, видано 500 → борг 500 сьогоднішньою датою.
    // Візит 2, 17:00: ягода 1 000, видано 1 500 → надлишок 500 закриває борг візиту 1.
    // Людина йде додому без залишку — і звіт дня мусить казати те саме.
    const r1 = rec({ id: 'v1', date: TODAY, time: '09:00', amount: 1000, paid: 500 })
    const r2 = rec({ id: 'v2', date: TODAY, time: '17:00', amount: 1000, paid: 1000 })
    const payouts = [
      pay({
        date: TODAY,
        time: '17:00',
        amount: 500,
        allocations: [{ receptionId: 'v1', originDate: TODAY, amount: 500 }],
      }),
    ]
    const d = reconcileDay(TODAY, [r1, r2], payouts)
    expect(supplierBalance('s1', [r1, r2], payouts)).toBe(0)
    expect(d.newDebt).toBe(0)
    expect(d.settledSameDay).toBe(500)
    expect(d.paidForPastDays).toBe(0)
    expect(d.pastByOriginDate).toEqual([])
    expect(d.cashOut).toBe(2000)
    expect(d.drift).toBe(0)
    // каса: 2 000 ₴ на руки за 2 000 ₴ ягоди, і нічого «за попередні дні»
    expect(d.accrued).toBe(2000)
    expect(d.paidToday).toBe(1500)
    expect(round2(d.paidToday + d.settledSameDay + d.newDebt)).toBe(d.accrued)
  })

  it('той самий день, але видачу порахував двигун: FIFO сам ставить сьогоднішню дату', () => {
    // те саме, що вище, тільки алокація не вписана руками, а вийшла з visitMath + openDebts
    const morning = rec({ id: 'v1', date: TODAY, time: '09:00', amount: 1000, paid: 500 })
    const balance = supplierBalance('s1', [morning], [])
    expect(balance).toBe(500)
    const m = visitMath({ lineAmounts: [1000], balance, includeBalance: true, paidInput: 1500 })
    expect(m.total).toBe(1500)
    expect(m.paidToday).toBe(1000)
    expect(m.paidToPast).toBe(500)
    expect(m.remainder).toBe(0)
    const evening = rec({ id: 'v2', date: TODAY, time: '17:00', amount: 1000, paid: m.paidToday })
    const allocations = allocatePayout(m.paidToPast, openDebts('s1', [morning, evening], []))
    expect(allocations).toEqual([{ receptionId: 'v1', originDate: TODAY, amount: 500 }])
    const payouts = [
      pay({ date: TODAY, time: '17:00', amount: sum(allocations, (a) => a.amount), allocations }),
    ]
    const d = reconcileDay(TODAY, [morning, evening], payouts)
    expect(d.settledSameDay).toBe(500)
    expect(d.newDebt).toBe(0)
    expect(d.paidForPastDays).toBe(0)
    expect(d.pastByOriginDate).toEqual([])
    expect(d.cashOut).toBe(2000)
    expect(d.drift).toBe(0)
    expect(supplierBalance('s1', [morning, evening], payouts)).toBe(0)
  })

  it('в один день і закриття сьогоднішнього боргу, і виплата за 28.07 — рахуються окремо', () => {
    const old = rec({ id: 'r_28', date: '2026-07-28', amount: 1000, paid: 0 })
    const r1 = rec({ id: 'v1', date: TODAY, time: '09:00', amount: 1000, paid: 500 })
    const r2 = rec({ id: 'v2', date: TODAY, time: '17:00', amount: 1000, paid: 1000 })
    const payouts = [
      pay({
        date: TODAY,
        time: '17:00',
        amount: 1500,
        allocations: [
          { receptionId: 'r_28', originDate: '2026-07-28', amount: 1000 },
          { receptionId: 'v1', originDate: TODAY, amount: 500 },
        ],
      }),
    ]
    const d = reconcileDay(TODAY, [old, r1, r2], payouts)
    expect(d.settledSameDay).toBe(500)
    expect(d.paidForPastDays).toBe(1000)
    expect(d.pastByOriginDate).toEqual([{ date: '2026-07-28', amount: 1000 }])
    expect(sum(d.pastByOriginDate, (x) => x.amount)).toBe(d.paidForPastDays)
    expect(d.newDebt).toBe(0)
    expect(d.cashOut).toBe(3000)
    expect(d.drift).toBe(0)
    expect(supplierBalance('s1', [old, r1, r2], payouts)).toBe(0)
  })

  it('той самий день, але борг закритий лише частково — у newDebt лишається саме залишок', () => {
    // ягода 1 000, видано 300 → борг 700; ввечері ягода 1 000, видано 1 200 → 200 у борг ранку.
    const r1 = rec({ id: 'v1', date: TODAY, time: '09:00', amount: 1000, paid: 300 })
    const r2 = rec({ id: 'v2', date: TODAY, time: '17:00', amount: 1000, paid: 1000 })
    const payouts = [
      pay({
        date: TODAY,
        time: '17:00',
        amount: 200,
        allocations: [{ receptionId: 'v1', originDate: TODAY, amount: 200 }],
      }),
    ]
    const d = reconcileDay(TODAY, [r1, r2], payouts)
    expect(d.settledSameDay).toBe(200)
    expect(d.newDebt).toBe(500)
    expect(d.newDebt).toBe(supplierBalance('s1', [r1, r2], payouts))
    expect(d.paidForPastDays).toBe(0)
    expect(d.cashOut).toBe(1500)
    expect(d.drift).toBe(0)
  })

  it('борг з іншої точки, закритий сьогодні, не робить newDebt мінусовим', () => {
    // reconcileDay кличуть по точці, і алокація може вказувати на рядок іншого пункту
    // (керівник у режимі «Усі точки» гасить залишок мережі). Звіт пункту має це витримати.
    // Звіт p2 має показати рух готівки, але не відняти чужий борг зі своїх нових боргів.
    const atP2 = rec({ id: 'v_p2', date: TODAY, pointId: 'p2', amount: 1000, paid: 1000 })
    const payoutAtP2 = pay({
      date: TODAY,
      pointId: 'p2',
      amount: 500,
      allocations: [{ receptionId: 'v_p1', originDate: TODAY, amount: 500 }],
    })
    const d = reconcileDay(TODAY, [atP2], [payoutAtP2])
    expect(d.settledSameDay).toBe(500)
    expect(d.newDebt).toBe(0)
    expect(Object.is(d.newDebt, 0)).toBe(true)
    expect(d.paidForPastDays).toBe(0)
    expect(d.pastByOriginDate).toEqual([])
    expect(d.cashOut).toBe(1500)
    expect(d.drift).toBe(0)
  })

  it('«Розходження» ловить рядок, який не сходиться сам із собою (PART C 3)', () => {
    // 20 з 60 перебитих руками клітинок «Залишок» не збігаються з власним рядком.
    // Тут це не тавтологія, а перевірка: Разом − Виплачено − Залишок по кожному рядку.
    const honest = rec({ id: 'ok', date: TODAY, amount: 1000, paid: 600, debt: 400 })
    const typedOver = rec({ id: 'bad', date: TODAY, amount: 9535.5, paid: 8000, debt: 1536 })
    expect(reconcileDay(TODAY, [honest], []).drift).toBe(0)
    expect(reconcileDay(TODAY, [honest, typedOver], []).drift).toBe(-0.5)
  })

  it('«Розходження 0» — саме 0, а не мінусовий нуль', () => {
    // Одна квитанція: нараховано 10 973,55, видано 9 954,45, борг 1 019,10.
    // Сира різниця 10973.55 − 9954.45 − 1019.1 = −1,48e−12 — на екрані дня це
    // головний індикатор довіри, і він не має права показати «−0,00».
    const receptions = [rec({ date: TODAY, amount: 10973.55, paid: 9954.45 })]
    const d = reconcileDay(TODAY, receptions, [])
    expect(d.newDebt).toBe(1019.1)
    expect(d.drift).toBe(0)
    expect(Object.is(d.drift, 0)).toBe(true)
    expect(num(d.drift, 2)).toBe('0,00')
  })

  it('баланс постачальника, закритий до копійки, — теж не мінусовий нуль', () => {
    // Два відкриті борги 229,63 + 1 132,76 = 1 362,39 і виплата рівно на цю суму —
    // «людина прийшла і забрала весь залишок». Баланс має бути 0, і не −0.
    const receptions = [
      rec({ id: 'r_a', date: '2026-07-28', amount: 229.63, paid: 0 }),
      rec({ id: 'r_b', date: '2026-07-31', amount: 1132.76, paid: 0 }),
    ]
    const allocations = allocatePayout(1362.39, openDebts('s1', receptions, []))
    const payouts = [pay({ amount: sum(allocations, (a) => a.amount), allocations })]
    expect(payouts[0].amount).toBe(1362.39)
    expect(Object.is(supplierBalance('s1', receptions, payouts), 0)).toBe(true)
    expect(openDebts('s1', receptions, payouts)).toEqual([])
  })

  it('тотожності звіту дня тримаються разом із settledSameDay', () => {
    const cases: { receptions: Reception[]; payouts: Payout[] }[] = [
      // усе за сьогодні й повністю виплачено
      { receptions: [rec({ date: TODAY, amount: 12480, paid: 12480 })], payouts: [] },
      // частина лишилася в залишку
      { receptions: [rec({ date: TODAY, amount: 12480, paid: 5000 })], payouts: [] },
      // копійки, на яких drift раніше давав −0
      { receptions: [rec({ date: TODAY, amount: 10973.55, paid: 9954.45 })], payouts: [] },
      // закрито борг 28.07
      {
        receptions: [rec({ id: 'p_28', date: '2026-07-28', amount: 1000, paid: 0 })],
        payouts: [
          pay({
            date: TODAY,
            amount: 1000,
            allocations: [{ receptionId: 'p_28', originDate: '2026-07-28', amount: 1000 }],
          }),
        ],
      },
      // двічі за день: борг ранку закритий увечері
      {
        receptions: [
          rec({ id: 's_1', date: TODAY, time: '09:00', amount: 1000, paid: 500 }),
          rec({ id: 's_2', date: TODAY, time: '17:00', amount: 1000, paid: 1000 }),
        ],
        payouts: [
          pay({
            date: TODAY,
            amount: 500,
            allocations: [{ receptionId: 's_1', originDate: TODAY, amount: 500 }],
          }),
        ],
      },
      // і сьогоднішній борг, і 31.07 — в одній виплаті
      {
        receptions: [
          rec({ id: 'm_31', date: '2026-07-31', amount: 840, paid: 0 }),
          rec({ id: 'm_1', date: TODAY, time: '09:00', amount: 1000, paid: 300 }),
          rec({ id: 'm_2', date: TODAY, time: '17:00', amount: 1000, paid: 1000 }),
        ],
        payouts: [
          pay({
            date: TODAY,
            amount: 1540,
            allocations: [
              { receptionId: 'm_31', originDate: '2026-07-31', amount: 840 },
              { receptionId: 'm_1', originDate: TODAY, amount: 700 },
            ],
          }),
        ],
      },
    ]
    for (const c of cases) {
      const d = reconcileDay(TODAY, c.receptions, c.payouts)
      // нарахована ягода = видано за неї сьогодні + закрито того ж дня + лишилося в боргу
      expect(round2(d.paidToday + d.settledSameDay + d.newDebt)).toBe(d.accrued)
      // каса = сьогоднішня ягода + попередні дні + закрите того ж дня
      expect(round2(d.paidToday + d.paidForPastDays + d.settledSameDay)).toBe(d.cashOut)
      expect(sum(d.pastByOriginDate, (x) => x.amount)).toBe(d.paidForPastDays)
      // сьогоднішня дата ніколи не буває серед «попередніх днів»
      expect(d.pastByOriginDate.every((x) => x.date !== TODAY)).toBe(true)
      expect(d.drift).toBe(0)
      expect(Object.is(d.drift, 0)).toBe(true)
      // newDebt = те, що людина реально ще не отримала на кінець дня
      expect(d.newDebt).toBe(supplierBalance('s1', c.receptions, c.payouts))
    }
  })
})

/* ======================== наскрізний сценарій ======================== */

describe('наскрізно: два старі борги + сьогоднішня ягода на 12 480, видано 13 800', () => {
  const TODAY = '2026-08-04'

  // два відкриті борги: 28.07 → 500 ₴, 31.07 → 840 ₴, разом 1 340 ₴
  const old1 = rec({ id: 'r_28', date: '2026-07-28', time: '09:12', amount: 1000, paid: 500 })
  const old2 = rec({ id: 'r_31', date: '2026-07-31', time: '16:40', amount: 1840, paid: 1000 })

  const balance = supplierBalance('s1', [old1, old2], [])

  const lines = [
    { amount: 8320, net: 83.2 },
    { amount: 4160, net: 41.6 },
  ]
  const math = visitMath({
    lineAmounts: lines.map((l) => l.amount),
    balance,
    includeBalance: true,
    paidInput: 13800,
  })
  const perLine = splitPaidAcrossLines(lines.map((l) => l.amount), math.paidToday)

  // так, як це робить store.addVisit
  const today = lines.map((l, i) =>
    rec({
      id: `r_today_${i}`,
      date: TODAY,
      time: '11:20',
      amount: l.amount,
      net: l.net,
      paid: perLine[i],
      carriedIn: i === 0 ? math.carriedIn : 0,
      visitId: 'v_1',
    }),
  )

  const receptions = [old1, old2, ...today]
  const allocations = allocatePayout(math.paidToPast, openDebts('s1', receptions, []))
  const payouts = [pay({ date: TODAY, time: '11:20', amount: sum(allocations, (a) => a.amount), allocations })]

  it('попередній залишок узятий із книги, а не з поля', () => {
    expect(balance).toBe(1340)
    expect(math.carriedIn).toBe(1340)
    expect(math.total).toBe(13820)
    expect(math.paidToday).toBe(12480)
    expect(math.paidToPast).toBe(1320)
    expect(perLine).toEqual([8320, 4160])
  })

  it('обидва рядки візиту закриті повністю, залишок візиту — 0', () => {
    expect(today.map((r) => r.debt)).toEqual([0, 0])
    expect(today[0].carriedIn).toBe(1340)
    expect(today[1].carriedIn).toBe(0)
    expect(today.every((r) => r.visitId === 'v_1')).toBe(true)
  })

  it('виплата назвала 28.07 і 31.07 їхніми власними датами, від старішої', () => {
    expect(allocations).toEqual([
      { receptionId: 'r_28', originDate: '2026-07-28', amount: 500 },
      { receptionId: 'r_31', originDate: '2026-07-31', amount: 820 },
    ])
    expect(originDates(allocations)).toEqual(['2026-07-28', '2026-07-31'])
    expect(payouts[0].amount).toBe(1320)
  })

  it('загальний залишок після візиту — 20 ₴', () => {
    expect(supplierBalance('s1', receptions, payouts)).toBe(20)
    expect(supplierBalance('s1', receptions, payouts)).toBe(math.remainder)
  })

  it('відкритим лишився один борг 31.07 на 20 ₴', () => {
    const open = openDebts('s1', receptions, payouts)
    expect(open.map((o) => [o.reception.date, o.open])).toEqual([['2026-07-31', 20]])
  })

  it('звіт дня: нараховано 12 480, за сьогодні 12 480, за минулі 1 320, каса 13 800, drift 0', () => {
    const d = reconcileDay(TODAY, receptions, payouts)
    expect(d.accrued).toBe(12480)
    expect(d.netKg).toBe(124.8)
    expect(d.receptionCount).toBe(2)
    expect(d.paidToday).toBe(12480)
    expect(d.paidForPastDays).toBe(1320)
    expect(d.settledSameDay).toBe(0)
    expect(d.cashOut).toBe(13800)
    expect(d.newDebt).toBe(0)
    expect(d.drift).toBe(0)
    expect(d.pastByOriginDate).toEqual([
      { date: '2026-07-28', amount: 500 },
      { date: '2026-07-31', amount: 820 },
    ])
  })

  it('чек: Нараховано + Попередній = РАЗОМ, Видано + Залишок = РАЗОМ', () => {
    expect(round2(math.accrued + math.carriedIn)).toBe(math.total)
    expect(round2(math.paid + math.remainder)).toBe(math.total)
    expect(round2(math.paidToday + math.paidToPast)).toBe(math.paid)
  })
})
