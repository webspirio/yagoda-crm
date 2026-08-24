import { describe, expect, it } from 'vitest'
import { costOfDay } from './calc'
import { buildSeed, TODAY } from './seed'
import { useStore } from './store'

/**
 * ПРИЙМАЛЬНИЙ тест фази 2 — і єдиний, який має право називатися критерієм приймання
 * (`09 §8.1`: «критерієм приймання „звірити екран зі спекою рядок у рядок" є тільки цей день»).
 *
 * Чому він лежить окремо від `cost.test.ts`. Той файл писав автор рушія, і тест, написаний
 * автором реалізації, найчастіше повторює саму реалізацію: він зелений, бо код робить те,
 * що робить, а не те, що обіцяно. Тут числа переписані РУКАМИ з таблиці `09 §3.3` —
 * жодне з них не взяте з виводу коду. Якщо рушій колись почне рахувати інакше, впаде саме
 * цей файл, і впаде він проти документа, а не проти себе вчорашнього.
 *
 * Шипинки (`p1`) за 04.08.2026. Пул = 3 800 ручних + 1 660 недостачі = 5 460 ₴ (`13 §1 П-1`).
 */
describe('канонічний день 04.08.2026 · Шипинки — звірка зі спекою 09 §3.3', () => {
  const seed = buildSeed()
  const day = costOfDay({
    date: TODAY,
    pointId: 'p1',
    receptions: seed.receptions,
    berries: seed.berries,
    reweighs: seed.reweighs,
    expenses: seed.expenses,
  })
  const row = (product: string) => {
    const r = day.rows.find((x) => x.product === product)
    if (!r) throw new Error(`у зведенні немає товару «${product}»`)
    return r
  }

  /* Таблиця `09 §3.3`, стовпець за стовпцем. Числа — зі спеки, не з коду. */
  const SPEC = [
    // товар,       kgPoint, paid,    avgPoint, kgBase, shortKg, shortUah, baseSum,    share%,  alloc,   costTotal,  avgFinal
    ['Малина', 800, 128_000, 160, 790, -10, -1_600, 126_400, 92.5059, 5_050.82, 131_450.82, 166.3934],
    ['Смородина', 60, 3_600, 60, 59, -1, -60, 3_540, 6.9087, 377.21, 3_917.21, 66.3934],
    ['Порічка', 5, 300, 60, 5, 0, 0, 300, 0.5855, 31.97, 331.97, 66.394],
  ] as const

  for (const [
    product,
    kgPoint,
    paid,
    avgPoint,
    kgBase,
    shortKg,
    shortUah,
    baseSum,
    sharePct,
    alloc,
    costTotal,
    avgFinal,
  ] of SPEC) {
    it(`${product}: усі дванадцять клітинок рядка`, () => {
      const r = row(product)
      expect(r.kgPoint, 'кг пункту').toBe(kgPoint)
      expect(r.paid, 'нараховано').toBe(paid)
      expect(r.avgPoint, 'середня ціна').toBeCloseTo(avgPoint, 6)
      expect(r.kgBase, 'кг база').toBe(kgBase)
      expect(r.shortKg, 'Δкг').toBe(shortKg)
      expect(r.shortUah, 'Δ₴').toBe(shortUah)
      expect(r.baseSum, 'база kg×avg').toBe(baseSum)
      expect(r.share * 100, 'частка, %').toBeCloseTo(sharePct, 4)
      expect(r.alloc, 'із пулу').toBe(alloc)
      expect(r.costTotal, 'разом').toBe(costTotal)
      expect(r.avgFinal, 'собівартість ₴/кг').toBeCloseTo(avgFinal, 4)
      expect(r.reweighed).toBe(true)
      expect(r.foreign).toBe(false)
    })
  }

  it('рядок «Разом» таблиці §3.3', () => {
    expect(day.rows).toHaveLength(3)
    expect(day.kgPointTotal, 'кг пункту').toBe(865)
    expect(day.paidTotal, 'нараховано').toBe(131_900)
    expect(day.kgBaseTotal, 'кг база').toBe(854)
    expect(day.costTotal, 'собівартість разом').toBe(135_700)
    expect(day.avgFinalTotal, 'середня по дню').toBeCloseTo(158.8993, 4)
  })

  it('пул = ручні витрати 3 800 + недостача 1 660 = 5 460 (13 §1 П-1)', () => {
    expect(day.expensesManual).toBe(3_800)
    // недостача входить у пул ДОДАТНОЮ величиною — інакше пул став би 2 140 (I43, §3.2)
    expect(day.shortfallTotal).toBe(1_660)
    expect(day.pool).toBe(5_460)
    expect(day.manualExpenses.map((e) => e.amount).sort((a, b) => a - b)).toEqual([
      500, 1_000, 1_000, 1_300,
    ])
  })

  it('ставка 5 460 / 854 = 6,39344 ₴/кг', () => {
    expect(day.rate).toBeCloseTo(6.393442622950819, 9)
  })

  /**
   * `I48` і головна новина правила `П-1`: надбавка однакова для ВСІХ товарів, бо і
   * недостача, і витрати діляться по одній і тій самій вазі. Компоненти — неокруглені.
   */
  it('розклад надбавки: 1,9438 недостачі + 4,4496 витрат = 6,3934 (I48)', () => {
    expect(day.upliftShortRate).toBeCloseTo(1.9438, 4)
    expect(day.upliftExpenseRate).toBeCloseTo(4.4496, 4)
    expect(day.upliftShortRate + day.upliftExpenseRate).toBeCloseTo(day.rate, 9)
    // до ДРУГОГО знака надбавка однакова на будь-яку ягоду — це те одне речення для клієнта
    for (const r of day.rows) expect(r.uplift).toBeCloseTo(6.39, 2)
  })

  /** Дві звірки, які стоять унизу екрана Н8 — `I45` і `I46`, показані людині. */
  it('Σ із пулу = пул 5 460 (I45), Σ разом = нараховано + витрати (I46)', () => {
    expect(day.rows.reduce((s, r) => s + r.alloc, 0)).toBeCloseTo(5_460, 9)
    // саме 131 900 + 3 800, а не Σ baseSum + пул: друге — тавтологія, зелена завжди
    expect(day.costTotal).toBe(131_900 + 3_800)
    expect(day.checks).toEqual({ allocEqualsPool: true, conservation: true })
  })

  it('день зведений, без жодного порушення', () => {
    expect(day.violations).toEqual([])
    expect(day.status).toBe('summed')
    // `D-2`/`I41`: середня ціна за 4 серпня взята зі ЗНІМКА, а не з живої вибірки квитанцій
    expect(day.fromSnapshot).toBe(true)
    expect(day.basis).toBe('byWeight')
    expect(day.singleProduct).toBe(null)
  })

  it('рядок недостачі — синтезований, нередагований, і в СТАНІ його немає (I43)', () => {
    expect(day.shortfallRow?.kind).toBe('shortfall')
    expect(day.shortfallRow?.amount).toBe(1_660)
    expect(day.shortfallRow?.label).toBe('Недостача в ягоді')
    // два джерела однієї цифри — це два різні числа через тиждень
    expect(seed.expenses.some((e) => e.kind === 'shortfall')).toBe(false)
    expect(useStore.getState().expenses.some((e) => e.kind === 'shortfall')).toBe(false)
    expect(
      useStore.getState().addExpense({
        date: TODAY,
        pointId: 'p1',
        label: 'Недостача в ягоді',
        amount: 1_660,
        createdBy: 'Керівник',
        kind: 'shortfall',
      }),
    ).toBeUndefined()
  })

  /**
   * Третій рядок таблиці «три числа для однієї малини» (`09 §3.3`): аварійний режим
   * `R-09`, весь пул на один товар. Він доступний керівникові перемикачем, і саме він
   * пояснює її 166,8 — не помилка, а інший режим того самого розрахунку.
   */
  it('режим «усе на малину» дає 166,9114, а решті — чисту закупку', () => {
    const single = costOfDay({
      date: TODAY,
      pointId: 'p1',
      receptions: seed.receptions,
      berries: seed.berries,
      reweighs: seed.reweighs,
      expenses: seed.expenses,
      policy: { date: TODAY, pointId: 'p1', basis: 'byWeight', singleProduct: 'Малина' },
    })
    expect(single.singleProduct).toBe('Малина')
    expect(single.rows.find((r) => r.product === 'Малина')!.alloc).toBe(5_460)
    expect(single.rows.find((r) => r.product === 'Малина')!.avgFinal).toBeCloseTo(166.9114, 4)
    expect(single.rows.find((r) => r.product === 'Смородина')!.avgFinal).toBeCloseTo(60, 6)
    expect(single.rows.find((r) => r.product === 'Порічка')!.avgFinal).toBeCloseTo(60, 6)
    // збереження грошей тримається й тут: пул лише перерозподілений, не змінений
    expect(single.costTotal).toBe(135_700)
    expect(single.checks).toEqual({ allocEqualsPool: true, conservation: true })
  })
})
