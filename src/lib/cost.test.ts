import { beforeEach, describe, expect, it } from 'vitest'
import {
  allocateByLargestRemainder,
  costOfDay,
  productDay,
  reweighLineValid,
  round2,
  sum,
} from './calc'
import type { CostOfDay, CostRow, ProductDayRow, Violation } from './calc'
import { useStore } from './store'
import { TODAY } from './seed'
import type { Berry, DayExpense, Reception, Reweigh, ReweighLine } from './types'

/* ------------------------- фікстури ------------------------- */

const D = '2026-08-04'
const P = 'p1'

/** Два сорти одного товару — саме те, що недостача рахує РАЗОМ (I49) */
const BERRIES: Berry[] = [
  { id: 'b_mal_v', name: 'Малина ВС', short: 'МВ', product: 'Малина', wholesale: false, from: D, to: D, basePrice: 140 },
  { id: 'b_mal_1', name: 'Малина 1', short: 'М1', product: 'Малина', wholesale: false, from: D, to: D, basePrice: 130 },
  { id: 'b_smor', name: 'Смородина', short: 'См', product: 'Смородина', wholesale: false, from: D, to: D, basePrice: 45 },
  { id: 'b_por', name: 'Порічка', short: 'По', product: 'Порічка', wholesale: false, from: D, to: D, basePrice: 50 },
]

let seq = 0
function rec(berryId: string, net: number, amount: number, over: Partial<Reception> = {}): Reception {
  seq += 1
  return {
    id: `t${seq}`,
    code: `Ч-${seq}`,
    date: D,
    time: '08:00',
    pointId: P,
    supplierId: 's1',
    berryId,
    gross: net,
    pallet: 0,
    tare: [],
    tareWeight: 0,
    net,
    price: 0,
    bonus: 0,
    amount,
    paid: amount,
    debt: 0,
    carriedIn: 0,
    operator: 'Оксана Г.',
    synced: true,
    ...over,
  }
}

let rwSeq = 0
function line(berryId: string, product: string, netKg: number, order: number): ReweighLine {
  return {
    id: `rl${rwSeq}_${order}`,
    order,
    berryId,
    product,
    grossKg: netKg,
    palletKg: 0,
    tare: [],
    tareWeightKg: 0,
    tareUnits: 0,
    netKg,
  }
}

function rw(lines: Array<[string, string, number]>, over: Partial<Reweigh> = {}): Reweigh {
  rwSeq += 1
  return {
    id: `rw${rwSeq}`,
    berryDate: D,
    fromPointId: P,
    atPointId: 'base',
    weighedDate: D,
    weighedTime: '18:00',
    status: 'posted',
    lines: lines.map(([berryId, product, netKg], i) => line(berryId, product, netKg, i + 1)),
    snapshot: [],
    operator: 'Керівник',
    synced: true,
    ...over,
  }
}

let exSeq = 0
function exp(label: string, amount: number, over: Partial<DayExpense> = {}): DayExpense {
  exSeq += 1
  return {
    id: `ex${exSeq}`,
    date: D,
    pointId: P,
    kind: 'manual',
    label,
    amount,
    createdBy: 'Керівник',
    createdDate: D,
    createdTime: '19:00',
    ...over,
  }
}

const codes = (vs: Violation[]) => vs.map((v) => v.code)
const byProduct = (rows: ProductDayRow[], product: string) =>
  rows.find((r) => r.product === product)
const row = (c: CostOfDay, product: string): CostRow => {
  const found = c.rows.find((r) => r.product === product)
  if (!found) throw new Error(`немає рядка «${product}»`)
  return found
}

/**
 * Робочий день без жодної патології: Малина 100 кг / 12 000 ₴, Смородина 10 кг / 500 ₴,
 * переважено 98 і 9,8, витрат 300 ₴. Числа підібрані так, щоб розподіл ділився націло —
 * тоді будь-яка розбіжність у тесті означає помилку, а не роздачу копійок.
 */
function plainDay(over: Partial<Parameters<typeof costOfDay>[0]> = {}) {
  return costOfDay({
    date: D,
    pointId: P,
    receptions: [rec('b_mal_v', 60, 7_200), rec('b_mal_1', 40, 4_800), rec('b_smor', 10, 500)],
    berries: BERRIES,
    reweighs: [rw([['b_mal_v', 'Малина', 98], ['b_smor', 'Смородина', 9.8]])],
    expenses: [exp('Касир', 300)],
    ...over,
  })
}

/* ------------------------- allocateByLargestRemainder ------------------------- */

describe('allocateByLargestRemainder (09 §3.4)', () => {
  /** Ваги в грамах цілими, пул у копійках — рівно приклад зі спеки */
  const CANON = [
    { key: 'Малина', weight: 790_000 },
    { key: 'Смородина', weight: 59_000 },
    { key: 'Порічка', weight: 5_000 },
  ]

  it('канонічний день: 5 050,82 / 377,21 / 31,97 і Σ рівно 5 460,00', () => {
    const a = allocateByLargestRemainder(5_460, CANON)
    expect(a.get('Малина')).toBe(5_050.82)
    expect(a.get('Смородина')).toBe(377.21)
    expect(a.get('Порічка')).toBe(31.97)
    expect(round2([...a.values()].reduce((s, v) => s + v, 0))).toBe(5_460)
  })

  it('дефіцит роздається найбільшим залишкам, а не першому-ліпшому', () => {
    // 546 000 × 5 000 / 854 000 → q 3 196, r 616 000 — другий за величиною залишок, і
    // саме тому Порічка отримує зайву копійку, а Смородина (r 266 000) ні
    const a = allocateByLargestRemainder(5_460, CANON)
    expect(round2(a.get('Порічка')! * 100)).toBe(3_197)
    expect(round2(a.get('Смородина')! * 100)).toBe(37_721)
  })

  it('тай-брейк детермінований: за рівних залишків і ваг виграє ключ за алфавітом', () => {
    const a = allocateByLargestRemainder(0.03, [
      { key: 'Ожина', weight: 1 },
      { key: 'Бузина', weight: 1 },
    ])
    expect(a.get('Бузина')).toBe(0.02)
    expect(a.get('Ожина')).toBe(0.01)
    // і порядок аргументів на це не впливає
    const b = allocateByLargestRemainder(0.03, [
      { key: 'Бузина', weight: 1 },
      { key: 'Ожина', weight: 1 },
    ])
    expect([...b.entries()]).toEqual([...a.entries()].sort((x, y) => x[0].localeCompare(y[0], 'uk')))
  })

  it('відʼємний пул (надлишок переважив витрати) роздається симетрично', () => {
    const a = allocateByLargestRemainder(-5_460, CANON)
    expect(a.get('Малина')).toBe(-5_050.82)
    expect(a.get('Смородина')).toBe(-377.21)
    expect(a.get('Порічка')).toBe(-31.97)
    expect(round2([...a.values()].reduce((s, v) => s + v, 0))).toBe(-5_460)
  })

  it('нульова Σ ваг — усі нулі, і пул лишається нерозподіленим', () => {
    const a = allocateByLargestRemainder(1_000, [
      { key: 'Малина', weight: 0 },
      { key: 'Смородина', weight: 0 },
    ])
    expect([...a.values()]).toEqual([0, 0])
  })

  it('нульовий пул не створює копійок із нічого', () => {
    const a = allocateByLargestRemainder(0, CANON)
    expect([...a.values()]).toEqual([0, 0, 0])
  })

  it('Σ роздачі дорівнює пулу на пулах, які націло не діляться', () => {
    for (const pool of [0.01, 1, 7.77, 1_234.56, 99_999.99]) {
      const a = allocateByLargestRemainder(pool, CANON)
      expect(round2([...a.values()].reduce((s, v) => s + v, 0)), `пул ${pool}`).toBe(pool)
    }
  })
})

/* ------------------------- productDay ------------------------- */

describe('productDay', () => {
  const rows = productDay(
    D,
    P,
    [
      rec('b_mal_v', 60, 7_200),
      rec('b_mal_1', 40, 4_800),
      rec('b_smor', 10, 500),
      // чужий пункт і чужий день у розрахунок не входять
      rec('b_smor', 999, 99_999, { pointId: 'p2' }),
      rec('b_smor', 999, 99_999, { date: '2026-08-03' }),
    ],
    BERRIES,
  )

  it('два сорти одного товару зводяться в один рядок', () => {
    expect(rows.map((r) => r.product)).toEqual(['Малина', 'Смородина'])
    const malyna = byProduct(rows, 'Малина')!
    expect(malyna.kgPoint).toBe(100)
    expect(malyna.paid).toBe(12_000)
    expect(malyna.lineCount).toBe(2)
  })

  it('ставка НЕокруглена — округлена ламала б I42 на kgPoint × похибку', () => {
    const odd = productDay(D, P, [rec('b_smor', 3, 100)], BERRIES)
    expect(odd[0].avgPoint).toBeCloseTo(33.333333333, 9)
    expect(odd[0].avgPoint).not.toBe(33.33)
  })

  it('сортування за вагою спадно', () => {
    expect(rows[0].kgPoint).toBeGreaterThan(rows[1].kgPoint)
  })

  it('нульова вага не дає ділення на нуль', () => {
    const zero = productDay(D, P, [rec('b_smor', 0, 0)], BERRIES)
    expect(zero[0].avgPoint).toBe(0)
  })
})

/* ------------------------- costOfDay: звичайний день ------------------------- */

describe('costOfDay — день без патологій', () => {
  const c = plainDay()

  it('пул = ручні витрати + недостача, і недостача ДОДАТНА (I43)', () => {
    expect(c.expensesManual).toBe(300)
    expect(c.shortfallTotal).toBe(250)
    expect(c.pool).toBe(550)
    expect(c.shortfallRow?.kind).toBe('shortfall')
    expect(c.shortfallRow?.amount).toBe(250)
    expect(c.shortfallRow?.label).toBe('Недостача в ягоді')
    expect(c.shortfallRow?.id).toBe(`exp_short_${D}_${P}`)
  })

  it('baseSum тотожний нарахованому з недостачею (I42), порушень немає', () => {
    for (const r of c.rows) expect(r.baseSum, r.product).toBe(round2(r.paid + r.shortUah))
    expect(codes(c.violations)).not.toContain('I42')
  })

  it('розподіл сходиться з пулом до копійки (I45)', () => {
    expect(row(c, 'Малина').alloc).toBe(500)
    expect(row(c, 'Смородина').alloc).toBe(50)
    expect(sum(c.rows, (r) => r.alloc)).toBe(c.pool)
    expect(c.checks.allocEqualsPool).toBe(true)
  })

  it('збереження грошей: Σ собівартості = Σ нараховано + ручні витрати (I46)', () => {
    expect(c.costTotal).toBe(round2(c.paidTotal + c.expensesManual))
    expect(c.costTotal).toBe(12_800)
    expect(c.checks.conservation).toBe(true)
    // і це НЕ тавтологія Σ baseSum + пул: недостача 250 сидить в обох частинах
    expect(round2(sum(c.rows, (r) => r.baseSum) + c.pool)).toBe(c.costTotal)
  })

  it('надбавка однакова для всіх товарів і розкладається без остачі (I48)', () => {
    const malyna = row(c, 'Малина')
    const smorodyna = row(c, 'Смородина')
    expect(malyna.uplift).toBeCloseTo(smorodyna.uplift!, 10)
    expect(malyna.uplift).toBeCloseTo(c.rate, 10)
    expect(c.upliftShortRate + c.upliftExpenseRate).toBeCloseTo(c.rate, 10)
  })

  it('avgFinal НЕокруглена і рахується один раз від costTotal / kgBase', () => {
    const malyna = row(c, 'Малина')
    expect(malyna.avgFinal).toBeCloseTo(12_260 / 98, 10)
    expect(c.avgFinalTotal).toBeCloseTo(12_800 / 107.8, 10)
  })

  it('день зведений, знімка немає — рахувалось із живих квитанцій', () => {
    expect(c.status).toBe('summed')
    expect(c.fromSnapshot).toBe(false)
    expect(c.basis).toBe('byWeight')
    expect(c.violations).toEqual([])
  })
})

/* ------------------------- знімок: D-2 / I41 / I55 ------------------------- */

describe('costOfDay — знімок проведеного переважування (D-2, I41, I55)', () => {
  const reweighed = rw([['b_mal_v', 'Малина', 98]], {
    snapshot: [{ product: 'Малина', kgPoint: 100, avgPoint: 120 }],
  })
  /** Пізня квитанція заднім числом: +20 кг / +2 400 ₴ уже ПІСЛЯ проведення */
  const late = [rec('b_mal_v', 60, 7_200), rec('b_mal_1', 40, 4_800), rec('b_mal_1', 20, 2_400)]

  const c = costOfDay({
    date: D,
    pointId: P,
    receptions: late,
    berries: BERRIES,
    reweighs: [reweighed],
    expenses: [],
  })

  it('kgPoint і avgPoint беруться зі знімка, а не з живих квитанцій (I41)', () => {
    expect(c.fromSnapshot).toBe(true)
    expect(row(c, 'Малина').kgPoint).toBe(100)
    expect(row(c, 'Малина').avgPoint).toBe(120)
    expect(row(c, 'Малина').paid).toBe(12_000)
    // живі квитанції кажуть інше — і саме тому знімок і існує
    expect(productDay(D, P, late, BERRIES)[0].kgPoint).toBe(120)
  })

  it('розбіжність зі знімком показана вголос як попередження, а не мовчки (I55)', () => {
    const i55 = c.violations.filter((v) => v.code === 'I55')
    expect(i55).toHaveLength(1)
    expect(i55[0].severity).toBe('warn')
    expect(i55[0].message).toContain('день змінився після зведення')
    expect(i55[0].message).toContain('100.00')
    expect(i55[0].message).toContain('120.00')
  })

  it('сторноване переважування повертає день до живих квитанцій (I54)', () => {
    const voided = costOfDay({
      date: D,
      pointId: P,
      receptions: late,
      berries: BERRIES,
      reweighs: [{ ...reweighed, status: 'voided' }],
      expenses: [],
    })
    expect(voided.fromSnapshot).toBe(false)
    // рядки сторнованого документа не входять у kgBase — це просто фільтр, не порушення
    expect(voided.kgBaseTotal).toBe(0)
    expect(voided.status).toBe('awaiting-reweigh')
    expect(row(voided, 'Малина').kgPoint).toBe(120)
  })
})

/* ------------------------- патології ------------------------- */

describe('costOfDay — I42', () => {
  it('рядок із сумою на нульовій вазі валить тотожність і дає block', () => {
    // kgPoint = 0 → avgPoint = 0 → baseSum = 0, а нараховано 500 ₴ нікуди не поділось
    const c = costOfDay({
      date: D,
      pointId: P,
      receptions: [rec('b_mal_v', 100, 12_000), rec('b_smor', 0, 500)],
      berries: BERRIES,
      reweighs: [rw([['b_mal_v', 'Малина', 98]])],
      expenses: [],
    })
    const i42 = c.violations.filter((v) => v.code === 'I42')
    expect(i42).toHaveLength(1)
    expect(i42[0].severity).toBe('block')
    expect(i42[0].message).toContain('Смородина')
  })

  it('тотожність тримається і на ставці, що не ділиться націло', () => {
    const c = costOfDay({
      date: D,
      pointId: P,
      receptions: [rec('b_mal_v', 3, 1_000.01), rec('b_smor', 7, 333.33)],
      berries: BERRIES,
      reweighs: [rw([['b_mal_v', 'Малина', 2.9], ['b_smor', 'Смородина', 6.87]])],
      expenses: [exp('Пальне', 700)],
    })
    expect(codes(c.violations)).not.toContain('I42')
    expect(c.checks.conservation).toBe(true)
    expect(c.checks.allocEqualsPool).toBe(true)
  })
})

describe('costOfDay — I50: товар прийняли, а зважити забули', () => {
  const c = costOfDay({
    date: D,
    pointId: P,
    receptions: [rec('b_mal_v', 100, 12_000), rec('b_por', 5, 300)],
    berries: BERRIES,
    reweighs: [rw([['b_mal_v', 'Малина', 98]])],
    expenses: [exp('Касир', 1_000)],
  })

  it('рядок без переважування не бере участі в розподілі', () => {
    const por = row(c, 'Порічка')
    expect(por.reweighed).toBe(false)
    expect(por.share).toBe(0)
    expect(por.alloc).toBe(0)
    expect(por.avgFinal).toBeNull()
    expect(por.uplift).toBeNull()
    const i50 = c.violations.filter((v) => v.code === 'I50')
    expect(i50).toHaveLength(1)
    expect(i50[0].severity).toBe('warn')
  })

  it('його недостача рахується ЗАГАЛЬНОЮ формулою, інакше I46 не зійшовся б', () => {
    const por = row(c, 'Порічка')
    expect(por.shortKg).toBe(-5)
    expect(por.shortUah).toBe(-300)
    // N скорочується: Σ baseSum = Σ paid − N, Σ alloc = E_manual + N
    expect(round2(sum(c.rows, (r) => r.baseSum))).toBe(round2(c.paidTotal - c.shortfallTotal))
    expect(sum(c.rows, (r) => r.alloc)).toBe(round2(c.expensesManual + c.shortfallTotal))
    expect(c.costTotal).toBe(round2(c.paidTotal + c.expensesManual))
    expect(c.checks.conservation).toBe(true)
  })
})

describe('costOfDay — I51: переважування немає взагалі', () => {
  const c = costOfDay({
    date: D,
    pointId: P,
    receptions: [rec('b_mal_v', 100, 12_000)],
    berries: BERRIES,
    reweighs: [],
    expenses: [exp('Касир', 1_000), exp('Пальне', 800)],
  })

  it('день не вважається зведеним, а пул стоїть нерозподіленим', () => {
    expect(c.status).toBe('awaiting-reweigh')
    expect(c.kgBaseTotal).toBe(0)
    expect(c.rows.every((r) => r.alloc === 0)).toBe(true)
    // без переважування ВСЯ вага дня читається загальною формулою як недостача, тому пул
    // роздутий на ціну ягоди: 1 800 ₴ витрат + 12 000 ₴ «недостачі». Саме тому день і не
    // зведений — і саме тому в тексті I51 стоять ручні витрати, а не пул
    expect(c.expensesManual).toBe(1_800)
    expect(c.shortfallTotal).toBe(12_000)
    expect(c.pool).toBe(13_800)
    const i51 = c.violations.filter((v) => v.code === 'I51')
    expect(i51).toHaveLength(1)
    expect(i51[0].message).toContain('1800.00')
  })

  it('нерозподілений пул видно як block, а не як зелену звірку на нулі (I45, I46)', () => {
    expect(c.checks.allocEqualsPool).toBe(false)
    expect(c.checks.conservation).toBe(false)
    const blocking = c.violations.filter((v) => v.severity === 'block').map((v) => v.code)
    expect(blocking).toContain('I45')
    expect(blocking).toContain('I46')
  })
})

describe('costOfDay — I49: товар не з цього пункту', () => {
  const c = costOfDay({
    date: D,
    pointId: P,
    receptions: [rec('b_mal_v', 100, 12_000)],
    berries: BERRIES,
    reweighs: [rw([['b_mal_v', 'Малина', 98], ['b_por', 'Порічка', 7]])],
    expenses: [],
  })

  it('вага чужого рядка НЕ зникає — вона стоїть окремим рядком і в підсумку', () => {
    const por = row(c, 'Порічка')
    expect(por.foreign).toBe(true)
    expect(por.kgBase).toBe(7)
    expect(c.kgBaseTotal).toBe(105)
    const i49 = c.violations.filter((v) => v.code === 'I49')
    expect(i49).toHaveLength(1)
    expect(i49[0].severity).toBe('block')
  })

  it('reweighLineValid ловить це ще на вводі', () => {
    const dayProducts = productDay(D, P, [rec('b_mal_v', 100, 12_000)], BERRIES).map(
      (r) => r.product,
    )
    expect(reweighLineValid('Малина', dayProducts)).toBe(true)
    expect(reweighLineValid('Порічка', dayProducts)).toBe(false)
  })
})

describe('costOfDay — I47: надлишок робить собівартість нижчою за закупку', () => {
  it('відʼємний пул дає попередження, а не тишу', () => {
    const c = costOfDay({
      date: D,
      pointId: P,
      receptions: [rec('b_mal_v', 100, 12_000)],
      berries: BERRIES,
      // переважили БІЛЬШЕ: 105 кг проти 100 — надлишок 600 ₴ проти 100 ₴ витрат
      reweighs: [rw([['b_mal_v', 'Малина', 105]])],
      expenses: [exp('Касир', 100)],
    })
    expect(c.shortfallTotal).toBe(-600)
    expect(c.pool).toBe(-500)
    const malyna = row(c, 'Малина')
    expect(malyna.avgFinal).toBeLessThan(malyna.avgPoint)
    const i47 = c.violations.filter((v) => v.code === 'I47')
    expect(i47).toHaveLength(1)
    expect(i47[0].severity).toBe('warn')
    expect(i47[0].message).toContain('Собівартість нижча за закупку')
    // гроші при цьому все одно сходяться
    expect(c.checks.conservation).toBe(true)
    expect(c.checks.allocEqualsPool).toBe(true)
  })
})

describe('costOfDay — поріг недостачі', () => {
  const big = (pct?: number) =>
    costOfDay({
      date: D,
      pointId: P,
      receptions: [rec('b_mal_v', 100, 12_000)],
      berries: BERRIES,
      reweighs: [rw([['b_mal_v', 'Малина', 90]])],
      expenses: [],
      shortfallWarnPct: pct,
    })

  it('10 % при дефолтних 3 % — попередження зі словами клієнта', () => {
    const v = big().violations.filter((x) => x.code === 'shortfall-threshold')
    expect(v).toHaveLength(1)
    expect(v[0].severity).toBe('warn')
    expect(v[0].message).toContain('перевірте вагу й тару')
  })

  it('поріг налаштовується: при 15 % той самий день мовчить', () => {
    expect(codes(big(15).violations)).not.toContain('shortfall-threshold')
  })

  it('поріг ніколи не блокує — велика недостача це подія, а не заборона', () => {
    expect(big().violations.every((v) => v.severity === 'warn')).toBe(true)
  })
})

/* ------------------------- правило розподілу (D-3, R-09) ------------------------- */

describe('costOfDay — правило розподілу', () => {
  const base = {
    date: D,
    pointId: P,
    receptions: [rec('b_mal_v', 100, 12_000), rec('b_smor', 10, 500)],
    berries: BERRIES,
    reweighs: [rw([['b_mal_v', 'Малина', 98], ['b_smor', 'Смородина', 9.8]])],
    expenses: [exp('Касир', 300)],
  }

  it('«усе на один товар» кладе ВЕСЬ пул на нього', () => {
    const c = costOfDay({
      ...base,
      policy: { date: D, pointId: P, basis: 'byWeight', singleProduct: 'Малина' },
    })
    expect(row(c, 'Малина').alloc).toBe(c.pool)
    expect(row(c, 'Смородина').alloc).toBe(0)
    expect(row(c, 'Смородина').avgFinal).toBeCloseTo(row(c, 'Смородина').avgPoint, 10)
    expect(c.singleProduct).toBe('Малина')
    expect(c.checks.conservation).toBe(true)
  })

  it('«по сумі» ділить по грошах, а не по кілограмах', () => {
    const c = costOfDay({
      ...base,
      policy: { date: D, pointId: P, basis: 'byValue', singleProduct: null },
    })
    expect(c.basis).toBe('byValue')
    const malyna = row(c, 'Малина')
    const smorodyna = row(c, 'Смородина')
    expect(malyna.share).toBeCloseTo(malyna.baseSum / (malyna.baseSum + smorodyna.baseSum), 10)
    expect(sum(c.rows, (r) => r.alloc)).toBe(c.pool)
    // при поділі по сумі надбавка на кілограм у товарів РІЗНА — на відміну від «по вазі»
    expect(malyna.uplift).not.toBeCloseTo(smorodyna.uplift!, 4)
  })

  it('обраний товар того дня не переважено — відкат на «по вазі» ВГОЛОС', () => {
    const c = costOfDay({
      ...base,
      receptions: [...base.receptions, rec('b_por', 5, 300)],
      policy: { date: D, pointId: P, basis: 'byWeight', singleProduct: 'Порічка' },
    })
    const fallback = c.violations.filter((v) => v.code === 'policy-fallback')
    expect(fallback).toHaveLength(1)
    expect(fallback[0].severity).toBe('warn')
    expect(fallback[0].message).toContain('розподіл по вазі')
    // тихо віддати нуль не можна: пул розданий, а не загублений
    expect(c.basis).toBe('byWeight')
    expect(c.singleProduct).toBeNull()
    expect(sum(c.rows, (r) => r.alloc)).toBe(c.pool)
    expect(c.checks.allocEqualsPool).toBe(true)
  })
})

/* ------------------------- команди стору ------------------------- */

describe('стор: витрати дня і переважування', () => {
  beforeEach(() => {
    useStore.getState().resetDemo()
    // Витрати дня набирає керівник (`09 §7`), переважує теж він (`13 §4 S-20`). Підпис під
    // обома документами тепер виводить стор із сесії, тому без входу тут не пишеться нічого.
    const res = useStore.getState().signIn({ login: 'owner', secret: '1111' })
    if (!res.ok) throw new Error(`тест не зміг увійти керівником: ${res.reason}`)
  })

  it('addExpense відхиляє kind:"shortfall" — рядка недостачі в стані не буває (I43)', () => {
    const before = useStore.getState().expenses.length
    const rejected = useStore.getState().addExpense({
      date: TODAY,
      pointId: 'p1',
      label: 'Недостача в ягоді',
      amount: 1_660,
      kind: 'shortfall',
    })
    expect(rejected).toBeUndefined()
    expect(useStore.getState().expenses).toHaveLength(before)
    expect(useStore.getState().expenses.some((e) => e.kind !== 'manual')).toBe(false)
  })

  it('addExpense без kind пише звичайний ручний рядок', () => {
    const created = useStore.getState().addExpense({
      date: TODAY,
      pointId: 'p1',
      label: 'Вантажник ×2',
      amount: 2_600,
    })
    expect(created?.kind).toBe('manual')
    expect(created?.amount).toBe(2_600)
    expect(useStore.getState().expenses.at(-1)?.id).toBe(created?.id)
  })

  it('removeExpense прибирає рядок — одруківка керівника зворотна', () => {
    const created = useStore.getState().addExpense({
      date: TODAY,
      pointId: 'p1',
      label: 'Пальне',
      amount: 13_000,
    })!
    const before = useStore.getState().expenses.length
    useStore.getState().removeExpense(created.id)
    expect(useStore.getState().expenses).toHaveLength(before - 1)
    expect(useStore.getState().expenses.some((e) => e.id === created.id)).toBe(false)
  })

  it('addReweigh кладе знімок одразу і документ народжується проведеним (D-2, D-5)', () => {
    const st = useStore.getState()
    const expected = productDay(TODAY, 'p1', st.receptions, st.berries)
    const created = st.addReweigh({
      berryDate: TODAY,
      fromPointId: 'p1',
      atPointId: 'base',
      lines: [
        {
          berryId: 'v_mal_v',
          product: 'Малина',
          grossKg: 790,
          palletKg: 0,
          tare: [],
          tareWeightKg: 0,
          tareUnits: 0,
          netKg: 790,
        },
      ],
    })
    // `addReweigh` тепер може відмовити (переважує лише керівник), тому результат
    // спершу перевіряється на існування — інакше решта тверджень мовчки не виконалася б.
    expect(created).toBeDefined()
    expect(created!.status).toBe('posted')
    expect(created!.snapshot).toEqual(
      expected.map((r) => ({ product: r.product, kgPoint: r.kgPoint, avgPoint: r.avgPoint })),
    )
    expect(created!.lines[0].order).toBe(1)
    expect(useStore.getState().reweighs.at(-1)?.id).toBe(created!.id)
  })

  it('voidReweigh лишає документ і додає слід, а порожня причина нічого не робить', () => {
    const st = useStore.getState()
    const target = st.reweighs[0]
    const count = st.reweighs.length

    expect(st.voidReweigh(target.id, '   ')).toBeUndefined()
    expect(useStore.getState().reweighs.find((r) => r.id === target.id)?.status).toBe(
      target.status,
    )

    expect(useStore.getState().voidReweigh(target.id, 'помилилися пунктом')).toBeDefined()
    const after = useStore.getState().reweighs
    expect(after).toHaveLength(count)
    const voided = after.find((r) => r.id === target.id)!
    expect(voided.status).toBe('voided')
    expect(voided.voidReason).toBe('помилилися пунктом')
    expect(voided.voidedBy).toBe('Керівник')
    expect(voided.voidedDate).toBe(TODAY)
    // рядки лишились на місці: сторноване не рахується, але й не пропадає (I54)
    expect(voided.lines).toEqual(target.lines)
  })

  it('setExpensePolicy — upsert по парі (день, пункт), правило належить дню (D-3)', () => {
    const set = useStore.getState().setExpensePolicy
    set({ date: TODAY, pointId: 'p1', basis: 'byValue', singleProduct: null })
    set({ date: TODAY, pointId: 'p1', basis: 'byWeight', singleProduct: 'Малина' })
    set({ date: TODAY, pointId: 'p3', basis: 'byValue', singleProduct: null })
    const list = useStore.getState().policies
    expect(list.filter((p) => p.date === TODAY && p.pointId === 'p1')).toHaveLength(1)
    expect(list.find((p) => p.pointId === 'p1')?.singleProduct).toBe('Малина')
    expect(list.find((p) => p.pointId === 'p3')?.basis).toBe('byValue')
  })

  it('витрати дня НЕ рухають касу: жодної виплати й жодного руху готівки', () => {
    const before = useStore.getState().payouts.length
    useStore.getState().addExpense({
      date: TODAY,
      pointId: 'p1',
      label: 'Касир',
      amount: 1_000,
    })
    expect(useStore.getState().payouts).toHaveLength(before)
  })
})
