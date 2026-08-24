import { describe, expect, it } from 'vitest'
import { costOfDay, networkAverage, round2, sum } from './calc'
import type { NetworkAverage, NetworkProductRow } from './calc'
import { buildSeed, TODAY } from './seed'
import type {
  Berry,
  DayExpense,
  ExpensePolicy,
  Point,
  Reception,
  Reweigh,
  ReweighLine,
} from './types'

/* ------------------------- фікстури ------------------------- */
/*
 * Локальні навмисно. `src/lib/test-fixtures.ts` не створюється і фікстури з `cost.test.ts`
 * не переносяться: чистий рефакторинг посеред фази нічого не доводить, а ризикує 255
 * наявними тестами.
 */

const D = '2026-08-04'

const BERRIES: Berry[] = [
  { id: 'm1', name: 'Малина 1', short: 'М1', product: 'Малина', wholesale: false, from: D, to: D, basePrice: 160 },
  { id: 'sm', name: 'Смородина', short: 'См', product: 'Смородина', wholesale: false, from: D, to: D, basePrice: 60 },
  { id: 'po', name: 'Порічка', short: 'По', product: 'Порічка', wholesale: false, from: D, to: D, basePrice: 50 },
]

const point = (id: string, kind: Point['kind'] = 'reception'): Point => ({
  id,
  name: id,
  village: `с. ${id}`,
  kind,
  isMain: false,
  active: true,
})

let seq = 0
function rec(pointId: string, berryId: string, net: number, amount: number): Reception {
  seq += 1
  return {
    id: `r${seq}`,
    code: `Ч-${seq}`,
    date: D,
    time: '09:00',
    pointId,
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
  }
}

let rwSeq = 0
function rw(fromPointId: string, lines: Array<[string, string, number]>): Reweigh {
  rwSeq += 1
  const id = `rw${rwSeq}`
  return {
    id,
    berryDate: D,
    fromPointId,
    atPointId: 'base',
    weighedDate: D,
    weighedTime: '18:00',
    status: 'posted',
    lines: lines.map(([berryId, product, netKg], i): ReweighLine => ({
      id: `${id}_${i + 1}`,
      order: i + 1,
      berryId,
      product,
      grossKg: netKg,
      palletKg: 0,
      tare: [],
      tareWeightKg: 0,
      tareUnits: 0,
      netKg,
    })),
    // знімок порожній: тоді вага й ставка пункту читаються з живих квитанцій, і фікстура
    // не мусить дублювати те, що рушій і так порахує (`D-2` тут не перевіряється)
    snapshot: [],
    operator: 'Вагар',
    synced: true,
  }
}

let expSeq = 0
function exp(pointId: string, amount: number, label = 'Касир'): DayExpense {
  expSeq += 1
  return {
    id: `e${expSeq}`,
    date: D,
    pointId,
    kind: 'manual',
    label,
    amount,
    createdBy: 'Керівник',
    createdDate: D,
    createdTime: '20:00',
  }
}

/** Усе, що не назвали в тесті, — порожнє: жодного неявного пункту, витрати чи політики. */
function net(over: {
  points: Point[]
  receptions?: Reception[]
  reweighs?: Reweigh[]
  expenses?: DayExpense[]
  policies?: ExpensePolicy[]
}): NetworkAverage {
  return networkAverage({
    date: D,
    points: over.points,
    receptions: over.receptions ?? [],
    berries: BERRIES,
    reweighs: over.reweighs ?? [],
    expenses: over.expenses ?? [],
    policies: over.policies ?? [],
  })
}

const row = (x: NetworkAverage, product: string): NetworkProductRow => {
  const r = x.products.find((p) => p.product === product)
  if (!r) throw new Error(`у зведенні немає товару «${product}»`)
  return r
}

/* ------------------------- Задача 1: пункт важить сам себе ------------------------- */

/**
 * Рішення замовника 24.08.2026: пункт, який важить сам себе, отримує `kgBase = kgPoint`.
 * База — це місце, ДЕ переважують; її власні квитанції не переважує ніхто, тому без цього
 * прапорця її обіг (98 420,00 ₴ на 04.08.2026) випадав із мережевої звірки цілком.
 */
describe('costOfDay — selfWeighed: пункт важить сам себе', () => {
  it('база без жодного переважування зводиться: недостачі нуль, пул — самі ручні витрати', () => {
    const day = costOfDay({
      date: D,
      pointId: 'base',
      receptions: [rec('base', 'm1', 200, 40_000), rec('base', 'sm', 50, 2_500)],
      berries: BERRIES,
      reweighs: [],
      expenses: [exp('base', 900, 'Холодильник')],
      selfWeighed: true,
    })
    expect(day.shortfallTotal).toBe(0)
    expect(day.status).toBe('summed')
    expect(day.kgBaseTotal).toBe(day.kgPointTotal)
    expect(day.kgBaseTotal).toBe(250)
    expect(day.pool).toBe(day.expensesManual)
    expect(day.pool).toBe(900)
    expect(day.violations.map((v) => v.code)).not.toContain('I51')
    // гроші дня зійшлися: 42 500 нараховано + 900 витрат
    expect(day.costTotal).toBe(43_400)
    expect(day.checks).toEqual({ allocEqualsPool: true, conservation: true })
  })

  it('без прапорця той самий день лишається «очікує переважування» — дефолт false', () => {
    const same = {
      date: D,
      pointId: 'base',
      receptions: [rec('base', 'm1', 200, 40_000)],
      berries: BERRIES,
      reweighs: [],
      expenses: [exp('base', 900, 'Холодильник')],
    }
    const off = costOfDay(same)
    expect(off.status).toBe('awaiting-reweigh')
    expect(off.kgBaseTotal).toBe(0)
    expect(off.violations.map((v) => v.code)).toContain('I51')
    // і той самий виклик із прапорцем — зведений: різницю робить рівно прапорець
    expect(costOfDay({ ...same, selfWeighed: true }).status).toBe('summed')
  })

  /**
   * I-5(a). Перше правило, яке задача 1 веліла написати коментарем: документи переважування
   * з `fromPointId === <цей пункт>` у `kgBase` НЕ беруться — вага пункту і є наша вага.
   * У сіді база має нуль переважувань, тому ця гілка не виконувалася ніде, і мутація
   * «`selfWeighed` додає ще й рядки переважування» лишала всі тести зеленими.
   */
  it('selfWeighed із власним документом переважування: kgBase = kgPoint, не подвоюється', () => {
    const day = costOfDay({
      date: D,
      pointId: 'base',
      receptions: [rec('base', 'm1', 200, 40_000)],
      berries: BERRIES,
      // документ на той самий товар того самого пункту — його вага в kgBase НЕ додається
      reweighs: [rw('base', [['m1', 'Малина', 200]])],
      expenses: [],
      selfWeighed: true,
    })
    expect(day.kgBaseTotal).toBe(200)
    expect(day.kgBaseTotal).not.toBe(400)
    const m = day.rows.find((r) => r.product === 'Малина')
    expect(m?.kgBase).toBe(200)
    expect(m?.kgPoint).toBe(200)
    expect(m?.shortKg).toBe(0)
    expect(m?.shortUah).toBe(0)
    expect(day.shortfallTotal).toBe(0)
    expect(day.status).toBe('summed')
    expect(day.costTotal).toBe(40_000)
    expect(day.checks).toEqual({ allocEqualsPool: true, conservation: true })
  })

  /**
   * I-5(b). Друге правило: знімок (`D-2`, `I41`) лишається в силі й для пункту, що важить
   * сам себе — `kgBase` дорівнює `kgPoint` ЗІ ЗНІМКА, не живим квитанціям. У сіді база не
   * має жодного знімка, тому мутація «`selfWeighed` бере `live` замість `pointRows`»
   * (тобто ігнорує знімок) лишала всі тести зеленими.
   *
   * Фікстура: живі квитанції дають 100 кг / 16 000 ₴, а знімок — 90 кг по 160 ₴/кг.
   * Правильна відповідь: `kgBase = 90`, недостача нуль, `summed`, і `I55` на розбіжності
   * зі живими квитанціями. Мутація дала б `kgBase = 100` при `kgPoint = 90`, тобто
   * НАДЛИШОК 10 кг і 1 600 ₴ там, де його немає.
   */
  it('selfWeighed зі знімком: kgBase = kgPoint зі ЗНІМКА (90), а не з живих квитанцій', () => {
    const day = costOfDay({
      date: D,
      pointId: 'base',
      receptions: [rec('base', 'm1', 100, 16_000)],
      berries: BERRIES,
      reweighs: [
        {
          ...rw('base', [['m1', 'Малина', 50]]),
          snapshot: [{ product: 'Малина', kgPoint: 90, avgPoint: 160 }],
        },
      ],
      expenses: [],
      selfWeighed: true,
    })
    expect(day.fromSnapshot).toBe(true)
    const m = day.rows.find((r) => r.product === 'Малина')
    expect(m?.kgPoint).toBe(90)
    expect(m?.kgBase).toBe(90)
    expect(m?.kgBase).not.toBe(100)
    expect(m?.paid).toBe(14_400)
    expect(m?.shortKg).toBe(0)
    expect(m?.shortUah).toBe(0)
    expect(day.shortfallTotal).toBe(0)
    expect(day.status).toBe('summed')
    expect(day.costTotal).toBe(14_400)
    // день змінився після зведення: 90 кг у знімку проти 100 кг у квитанціях
    expect(day.violations.map((v) => v.code)).toContain('I55')
    expect(day.checks).toEqual({ allocEqualsPool: true, conservation: true })
  })

  it('на демо-даних за 04.08 по ВСІХ пунктах Σ собівартість = Σ нараховано + Σ ручні', () => {
    const seed = buildSeed()
    const days = seed.points.map((p) =>
      costOfDay({
        date: TODAY,
        pointId: p.id,
        receptions: seed.receptions,
        berries: seed.berries,
        reweighs: seed.reweighs,
        expenses: seed.expenses,
        policy: seed.policies.find((x) => x.date === TODAY && x.pointId === p.id),
        selfWeighed: p.kind === 'base',
      }),
    )
    const costTotal = sum(days, (d) => d.costTotal)
    const paidTotal = sum(days, (d) => d.paidTotal)
    const manual = sum(days, (d) => d.expensesManual)
    expect(costTotal).toBe(round2(paidTotal + manual))
    // розбіжність РІВНО 0,00 — і саме сюди раніше провалювалися 98 420,00 ₴ складу
    expect(round2(costTotal - round2(paidTotal + manual))).toBe(0)
    expect(paidTotal).toBe(383_471.55)
    expect(manual).toBe(23_530)
    expect(costTotal).toBe(407_001.55)
  })
})

/* ------------------------- Задача 2: зведення по мережі ------------------------- */

describe('networkAverage — зведення по мережі (M23, 09 §3.5)', () => {
  it('середня по мережі ЗВАЖЕНА: сума розділити на вагу, а не середнє середніх', () => {
    const x = net({
      points: [point('A'), point('B')],
      receptions: [rec('A', 'm1', 100, 16_000), rec('B', 'm1', 900, 180_000)],
      reweighs: [rw('A', [['m1', 'Малина', 100]]), rw('B', [['m1', 'Малина', 900]])],
    })
    const m = row(x, 'Малина')
    expect(m.kg).toBe(1_000)
    expect(m.cost).toBe(196_000)
    expect(m.avg).toBe(196)
    // середнє середніх дало б (160 + 200) / 2 = 180 — день із 100 кг важив би стільько ж,
    // скільки день із 900 кг
    expect(m.avg).not.toBe(180)
    expect(x.total.avg).toBe(196)
  })

  it('порожня клітинка — це НЕ нуль: пункт без цього товару в середню не входить', () => {
    const x = net({
      points: [point('A'), point('B')],
      receptions: [rec('A', 'sm', 50, 3_000), rec('B', 'm1', 100, 16_000)],
      reweighs: [rw('A', [['sm', 'Смородина', 50]]), rw('B', [['m1', 'Малина', 100]])],
    })
    const s = row(x, 'Смородина')
    expect(s.byPoint.get('B')).toBe(undefined)
    expect(s.byPoint.get('A')).toBe(60)
    expect(s.kg).toBe(50)
    expect(s.avg).toBe(60)
    // нуль від B не з'їв би середню лише тому, що B того дня смородини не бачив
    expect(x.pointIds).toEqual(['A', 'B'])
  })

  it('пункт без переважування у вагу не входить, але його I51 видно і звірка НЕ зеленіє', () => {
    const x = net({
      points: [point('A'), point('B')],
      receptions: [rec('A', 'm1', 100, 16_000), rec('B', 'm1', 100, 16_000)],
      reweighs: [rw('A', [['m1', 'Малина', 100]])],
      expenses: [exp('B', 500)],
    })
    const m = row(x, 'Малина')
    expect(m.kg).toBe(100)
    expect(m.byPoint.get('B')).toBe(undefined)
    const b = x.byPoint.get('B')
    expect(b?.status).toBe('awaiting-reweigh')
    expect(b?.violations.map((v) => v.code)).toContain('I51')
    expect(x.awaitingReweigh).toBe(false)
    // 16 000 нарахованого і 500 витрат B лежать у розбіжності, а не зникли
    expect(x.reconciliation.diff).toBe(-16_500)
    expect(x.reconciliation.ok).toBe(false)
  })

  it('база важить сама себе, і її вага стоїть у мережевій вазі', () => {
    const x = net({
      points: [point('A'), point('base', 'base')],
      receptions: [rec('A', 'm1', 100, 16_000), rec('base', 'm1', 200, 40_000)],
      reweighs: [rw('A', [['m1', 'Малина', 100]])],
    })
    const m = row(x, 'Малина')
    expect(m.kg).toBe(300)
    expect(m.byPoint.get('base')).toBe(200)
    expect(x.byPoint.get('base')?.status).toBe('summed')
    expect(x.reconciliation.diff).toBe(0)
    expect(x.reconciliation.ok).toBe(true)
  })

  /**
   * Ваги тут РІЗНІ навмисно (300 і 100). З 100/100, як було, зважена середня і середнє
   * середніх дають те саме число, і тест не розрізняв би головну вимогу `M23` на рівні
   * «Разом» — тобто був би зелений і при неправильній реалізації.
   */
  it('один пункт: «Разом» зважений — 135 ₴/кг, а не 110 як середнє середніх', () => {
    const x = net({
      points: [point('A'), point('B')],
      receptions: [rec('A', 'm1', 300, 48_000), rec('A', 'sm', 100, 6_000)],
      reweighs: [rw('A', [['m1', 'Малина', 300], ['sm', 'Смородина', 100]])],
    })
    expect(x.pointIds).toEqual(['A'])
    expect(x.total.kg).toBe(400)
    expect(x.total.cost).toBe(54_000)
    // 54 000 / 400 = 135, порахувано руками. Середнє середніх дало б (160 + 60) / 2 = 110
    expect(x.total.avg).toBe(135)
    expect(x.total.avg).not.toBe(110)
    expect(row(x, 'Малина').avg).toBe(160)
    expect(row(x, 'Смородина').avg).toBe(60)
  })

  /**
   * Порядок `products` — вага ↓, далі назва. Ваги РІЗНІ і підібрані так, що всі три
   * можливі порядки дають різні відповіді: за вагою ↓ це Смородина·Малина·Порічка, за
   * вагою ↑ — Порічка·Малина·Смородина, за алфавітом — Малина·Порічка·Смородина. Тому
   * мутація напрямку сортування цей тест валить, а не проходить на тай-брейку за назвою.
   */
  it('порядок products — за вагою вниз, і це не алфавіт і не вага вгору', () => {
    const x = net({
      points: [point('A')],
      receptions: [
        rec('A', 'm1', 200, 32_000),
        rec('A', 'sm', 300, 18_000),
        rec('A', 'po', 100, 5_000),
      ],
      reweighs: [
        rw('A', [
          ['m1', 'Малина', 200],
          ['sm', 'Смородина', 300],
          ['po', 'Порічка', 100],
        ]),
      ],
    })
    expect(x.products.map((r) => r.product)).toEqual(['Смородина', 'Малина', 'Порічка'])
    expect(x.products.map((r) => r.kg)).toEqual([300, 200, 100])
  })

  it('нуль пунктів: порожньо, «—» замість середньої, без винятків і без NaN', () => {
    const x = net({ points: [point('A'), point('B')] })
    expect(x.pointIds).toEqual([])
    expect(x.products).toEqual([])
    expect(x.total.kg).toBe(0)
    expect(x.total.cost).toBe(0)
    expect(x.total.avg).toBe(null)
    // «Ніде не має бути NaN» — на числах, які СПРАВДІ числа: `Number.isNaN(null)` завжди
    // false, тому попередня форма цієї перевірки не могла впасти ніколи
    const nums = [
      x.total.kg,
      x.total.cost,
      x.reconciliation.costTotal,
      x.reconciliation.paidTotal,
      x.reconciliation.expensesManual,
      x.reconciliation.diff,
    ]
    expect(nums.every((v) => Number.isFinite(v))).toBe(true)
    expect(x.byPoint.size).toBe(0)
    expect(x.awaitingReweigh).toBe(false)
    expect(x.reconciliation).toEqual({
      costTotal: 0,
      paidTotal: 0,
      expensesManual: 0,
      diff: 0,
      ok: true,
    })
  })

  it('жоден пункт не переважений — «Очікує переважування» (UC-32 А1)', () => {
    const x = net({
      points: [point('A'), point('B')],
      receptions: [rec('A', 'm1', 100, 16_000), rec('B', 'm1', 100, 16_000)],
      expenses: [exp('A', 500), exp('B', 500)],
    })
    expect(x.awaitingReweigh).toBe(true)
    expect(x.products).toEqual([])
    expect(x.total.avg).toBe(null)
  })

  /**
   * I-1. Абзац брифа «пункт із витратами й без квитанцій включається НАВМИСНО — краще
   * видима розбіжність, ніж непомітна» досі тримався тільки на коментарі: у жодній
   * фікстурі такого пункту не було, і мутація «прибрати `|| withExpenses.has(p.id)`»
   * лишала всі тести зеленими, а 700 ₴ зникали тихо.
   */
  it('пункт із ручною витратою і БЕЗ жодної квитанції входить у звірку, а не зникає', () => {
    const x = net({
      points: [point('A'), point('C')],
      receptions: [rec('A', 'm1', 100, 16_000)],
      reweighs: [rw('A', [['m1', 'Малина', 100]])],
      expenses: [exp('C', 700, 'Пальне')],
    })
    // C стоїть у зведенні, хоча ягоди того дня не бачив
    expect(x.pointIds).toEqual(['A', 'C'])
    const c = x.byPoint.get('C')
    expect(c?.expensesManual).toBe(700)
    expect(c?.paidTotal).toBe(0)
    expect(c?.costTotal).toBe(0)
    // класти витрату нікуди: `I45` (пул не розподілений) і `I46` (гроші не зійшлися)
    expect(c?.violations.map((v) => v.code).sort()).toEqual(['I45', 'I46'])
    // і головне: 700 ₴ видні як розбіжність, а не як зелена галочка
    expect(x.reconciliation.expensesManual).toBe(700)
    expect(x.reconciliation.diff).toBe(-700)
    expect(x.reconciliation.ok).toBe(false)
    // у матрицю товарів C не додає жодної колонки
    expect(row(x, 'Малина').byPoint.has('C')).toBe(false)
  })

  /**
   * I-1b / M-4. `withExpenses` фільтрує `kind === 'manual'`. Рядок `shortfall` синтезує
   * `costOfDay()` при кожному виводі, і `I43` забороняє йому існувати У СТАНІ — тобто
   * сьогодні цей фільтр недосяжний. Тест усе одно є, і він дешевий: без фільтра пункт із
   * одним лише синтетичним рядком отримав би у матриці ПРИЗРАЧНУ колонку з нулями, а
   * недосяжна гілка — це та, яку найлегше зламати непомітно.
   */
  it('рядок недостачі НЕ втягує пункт у зведення — у withExpenses лише manual', () => {
    const x = net({
      points: [point('A'), point('C')],
      receptions: [rec('A', 'm1', 100, 16_000)],
      reweighs: [rw('A', [['m1', 'Малина', 100]])],
      expenses: [{ ...exp('C', 700, 'Недостача в ягоді'), kind: 'shortfall' }],
    })
    expect(x.pointIds).toEqual(['A'])
    expect(x.byPoint.has('C')).toBe(false)
    expect(x.reconciliation.expensesManual).toBe(0)
    expect(x.reconciliation.diff).toBe(0)
  })

  /**
   * I-2. Політика належить ПАРІ (пункт, день) — `D-3`. Це ЄДИНЕ, чим цей підпис
   * відрізняється від скасованого прикладу `docs/10` Задачі 8 («один `policy` на всю
   * мережу»), і до цього тесту його не перевіряв ніхто: хелпер завжди передавав
   * `policies: []`, а в сіді `policies` порожній за побудовою.
   *
   * Числа порахувані руками. Пункт A і пункт B мають ІДЕНТИЧНІ квитанції, переважування
   * і витрати (100 кг малини по 160 + 100 кг смородини по 60, пул 2 200 ₴) — різниця
   * РІВНО в політиці:
   *   A `byValue`: ваги 16 000 і 6 000 із 22 000 → 1 600 і 600 → 176,00 і 66,00 ₴/кг
   *   B `byWeight`: ваги 100 і 100 → 1 100 кожному     → 171,00 і 71,00 ₴/кг
   * Мутація «одна політика на мережу» дала б B ті самі 176/66, і цей тест її валить.
   */
  it('політика пункту A не тече на пункт B: byValue дає 176/66, byWeight — 171/71 (D-3)', () => {
    const both = (id: string) => [rec(id, 'm1', 100, 16_000), rec(id, 'sm', 100, 6_000)]
    const x = net({
      points: [point('A'), point('B')],
      receptions: [...both('A'), ...both('B')],
      reweighs: [
        rw('A', [['m1', 'Малина', 100], ['sm', 'Смородина', 100]]),
        rw('B', [['m1', 'Малина', 100], ['sm', 'Смородина', 100]]),
      ],
      expenses: [exp('A', 2_200, 'Пальне'), exp('B', 2_200, 'Пальне')],
      policies: [{ date: D, pointId: 'A', basis: 'byValue', singleProduct: null }],
    })
    const a = x.byPoint.get('A')
    const b = x.byPoint.get('B')
    expect(a?.basis).toBe('byValue')
    expect(b?.basis).toBe('byWeight')
    expect(row(x, 'Малина').byPoint.get('A')).toBe(176)
    expect(row(x, 'Смородина').byPoint.get('A')).toBe(66)
    expect(row(x, 'Малина').byPoint.get('B')).toBe(171)
    expect(row(x, 'Смородина').byPoint.get('B')).toBe(71)
    // пул однаковий, розкладений по-різному: гроші від правила не змінюються
    expect(a?.pool).toBe(2_200)
    expect(b?.pool).toBe(2_200)
    expect(x.reconciliation.diff).toBe(0)
  })

  /* --- приймальні тести на демо-даних --- */

  it('на демо-даних за 04.08 мережева звірка сходиться РІВНО в нуль', () => {
    const seed = buildSeed()
    const x = networkAverage({
      date: TODAY,
      points: seed.points,
      receptions: seed.receptions,
      berries: seed.berries,
      reweighs: seed.reweighs,
      expenses: seed.expenses,
      policies: seed.policies,
    })
    expect(x.reconciliation.diff).toBe(0)
    expect(x.reconciliation.ok).toBe(true)
    expect(x.reconciliation.paidTotal).toBe(383_471.55)
    expect(x.reconciliation.expensesManual).toBe(23_530)
    expect(x.reconciliation.costTotal).toBe(407_001.55)
    // склад стоїть окремою колонкою, як звичайний пункт прийому (13 §4 S-22)
    expect(x.pointIds).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'base'])
    /*
     * «Разом» — НАЗВАНИМИ числами, не формулою. `expect(avg).toBe(cost / kg)` було
     * повторенням реалізації: воно зелене за будь-якої реалізації, яка ділить те саме на
     * те саме. Тут стоять зміряні 3 192,20 кг і 407 001,55 ₴, і 127,4988 ₴/кг, порахувані
     * з них. Середнє середніх по шести товарах цього дня дало б 83,16 — тобто мутація
     * «avg = середнє по products» валить саме цей рядок.
     */
    expect(x.total.kg).toBe(3_192.2)
    expect(x.total.cost).toBe(407_001.55)
    expect(x.total.avg).toBeCloseTo(127.4988, 4)
    const meanOfMeans =
      x.products.reduce((acc, r) => acc + (r.avg ?? 0), 0) / x.products.length
    expect(meanOfMeans).toBeCloseTo(83.1616, 4)
    expect(x.total.avg).not.toBeCloseTo(meanOfMeans, 2)
  })

  /**
   * Єдиний рядок ескіза Н10, який має право бути прибитим (`09 §5`): колонка Шипинок.
   * Решта чисел того ескіза демонстраційні, і звіряти з ними код НЕ МОЖНА.
   */
  it('колонка Шипинок за 04.08: 166,3934 · 66,3934 · 66,3940', () => {
    const seed = buildSeed()
    const x = networkAverage({
      date: TODAY,
      points: seed.points,
      receptions: seed.receptions,
      berries: seed.berries,
      reweighs: seed.reweighs,
      expenses: seed.expenses,
      policies: seed.policies,
    })
    expect(row(x, 'Малина').byPoint.get('p1')).toBeCloseTo(166.3934, 4)
    expect(row(x, 'Смородина').byPoint.get('p1')).toBeCloseTo(66.3934, 4)
    expect(row(x, 'Порічка').byPoint.get('p1')).toBeCloseTo(66.394, 4)
  })
})
