import { describe, expect, it } from 'vitest'
import { crateBalance, crateIssueMode } from '@/lib/calc'
import type { CrateIssue, CrateReturn, Supplier } from '@/lib/types'
import {
  crateWord,
  emptyCrateWord,
  inFieldRows,
  modeLabel,
  personWord,
  receiptWord,
} from './helpers'

/*
 * `helpers.ts` — це .ts, не .tsx: жодного React, жодного JSX, жодного DOM. Виняток
 * «компонентних тестів не пишемо» (CLAUDE.md) на нього НЕ поширюється — він про .tsx і про
 * jsdom, якого тут не треба. А ховається в цьому файлі рівно те, що ламається тихо:
 * фільтр за точкою, фільтр за сторнуванням, фільтр «у неї ще щось є» і ДВОКЛЮЧОВЕ
 * сортування. Жоден із чотирьох не має свого числа на екрані — зникни будь-який, і
 * таблиця лишиться правдоподібною.
 *
 * Числа — з `docs/21 §8.2` (перенесений журнал клієнтки), ті самі, що в
 * `canonical-crates.test.ts`. Прізвищ тут немає: люди — односкладові вигадані псевдоніми,
 * потрібні лише для того, щоб було чим перевірити другий ключ сортування.
 */

let seq = 0

/** Ціна ящика в її журналі: `Ящики!L2 = 120` у всіх 15 рядках. */
const PRICE = 120

function supplier(id: string, name: string): Supplier {
  return { id, name, village: 'шипинки', homePointId: 'p1', kind: 'none', createdAt: '2026-06-27' }
}

function issue(over: Partial<CrateIssue> & { supplierId: string; units: number }): CrateIssue {
  const mode = over.mode ?? crateIssueMode(over.units)
  const perUnit = mode === 'deposit' ? PRICE : 0
  return {
    id: `ci${(seq += 1)}`,
    date: '2026-07-29',
    time: '09:00',
    pointId: 'p1',
    mode,
    depositPerUnit: perUnit,
    depositTaken: over.units * perUnit,
    operatorId: 'Оксана Г.',
    ...over,
  }
}

function ret(supplierId: string, units: number, over: Partial<CrateReturn> = {}): CrateReturn {
  return {
    id: `cr${(seq += 1)}`,
    date: '2026-07-31',
    time: '11:20',
    pointId: 'p1',
    supplierId,
    units,
    allocations: [{ issueId: 'ci-x', units, perUnit: PRICE, amount: units * PRICE }],
    depositRefund: units * PRICE,
    operatorId: 'Оксана Г.',
    ...over,
  }
}

/*
 * Аркуш `Ящики`, 15 рядків / 13 людей (`docs/21 §8.2`). Двоє стоять двома рядками кожен:
 * `s7` = 30 + 10 і `s9` = 15 + 5. Псевдоніми роздані НАВМИСНО не за абеткою: чотири
 * десятки (`s4`, `s6`, `s10`, `s13`) стоять у журналі Ратушна → Наконечна → Іванчук →
 * Дмитрук, тобто в ТОЧНО зворотному до абеткового порядку. Якби другий ключ сортування
 * зник, таблиця віддала б їх у порядку масиву — і саме це видно нижче.
 */
const FOLK: Supplier[] = [
  supplier('s1', 'Андрійчук'),
  supplier('s2', 'Бондарук'),
  supplier('s3', 'Панасюк'),
  supplier('s4', 'Ратушна'),
  supplier('s5', 'Захарчук'),
  supplier('s6', 'Наконечна'),
  supplier('s7', 'Ковальчук'),
  supplier('s8', 'Гнатюк'),
  supplier('s9', 'Марчук'),
  supplier('s10', 'Іванчук'),
  supplier('s11', 'Оліярник'),
  supplier('s12', 'Лисенко'),
  supplier('s13', 'Дмитрук'),
]

/** [людина, ящиків] — рядок у рядок з її аркуша. Разом 275. */
const LEDGER: [string, number][] = [
  ['s1', 30], ['s2', 50], ['s3', 3], ['s4', 10], ['s5', 80],
  ['s6', 10], ['s7', 30], ['s8', 3], ['s9', 15], ['s9', 5],
  ['s10', 10], ['s7', 10], ['s11', 8], ['s12', 1], ['s13', 10],
]

const ISSUES = LEDGER.map(([supplierId, units]) => issue({ supplierId, units }))
/** Повернули рівно двоє, обидва повністю: 30 і 50 (`H1`). */
const RETURNS = [ret('s1', 30), ret('s2', 50)]

const rows = () => inFieldRows('p1', FOLK, ISSUES, RETURNS)

describe('inFieldRows — хто зараз тримає ящики цієї точки (docs/21 §8.2)', () => {
  it('у таблиці 11 осіб, а не 13: двоє повернули все, і нульових рядків не показуємо', () => {
    // 13 людей в аркуші, але `s1` і `s2` віддали 30 і 50 повністю. Рядок «0 ящиків» —
    // це не інформація, а привід шукати помилку там, де її немає.
    expect(new Set(LEDGER.map(([s]) => s)).size).toBe(13)
    expect(rows()).toHaveLength(11)
    expect(rows().map((r) => r.supplier.id)).not.toContain('s1')
    expect(rows().map((r) => r.supplier.id)).not.toContain('s2')
  })

  it('перший рядок — 80 ящиків: найбільший борг угорі', () => {
    expect(rows()[0].supplier.name).toBe('Захарчук')
    expect(rows()[0].balance.units).toBe(80)
  })

  it('людина з ДВОХ рядків журналу стоїть одним рядком на 40: 30 + 10', () => {
    const row = rows().find((r) => r.supplier.id === 's7')!
    expect(row.balance.units).toBe(40)
    expect(row.balance.taken).toBe(40)
    // друга така сама пара — 15 + 5
    expect(rows().find((r) => r.supplier.id === 's9')!.balance.units).toBe(20)
  })

  it('порядок — спершу за ящиками спадно, а на рівних за прізвищем по-українськи', () => {
    // Чотири десятки в масиві лежать Ратушна → Наконечна → Іванчук → Дмитрук, а виходять
    // навпаки; двійка трійок (Панасюк, Гнатюк) — так само. Без другого ключа сортування
    // цей рядок віддав би порядок масиву.
    expect(rows().map((r) => `${r.supplier.name} ${r.balance.units}`)).toEqual([
      'Захарчук 80',
      'Ковальчук 40',
      'Марчук 20',
      'Дмитрук 10',
      'Іванчук 10',
      'Наконечна 10',
      'Ратушна 10',
      'Оліярник 8',
      'Гнатюк 3',
      'Панасюк 3',
      'Лисенко 1',
    ])
  })

  it('разом по людях — ті самі 195 ящиків у полі, що й у складі наділу', () => {
    expect(rows().reduce((n, r) => n + r.balance.units, 0)).toBe(195)
  })

  it('людина, яка брала на p1, у списку p3 не зʼявляється — і навпаки', () => {
    const folk = [...FOLK, supplier('s14', 'Шевчук')]
    const issues = [...ISSUES, issue({ supplierId: 's14', units: 25, pointId: 'p3' })]
    const here = inFieldRows('p1', folk, issues, RETURNS)
    const there = inFieldRows('p3', folk, issues, RETURNS)
    expect(here.map((r) => r.supplier.id)).not.toContain('s14')
    expect(here).toHaveLength(11)
    expect(there.map((r) => r.supplier.id)).toEqual(['s14'])
    expect(there[0].balance.units).toBe(25)
  })

  it('СТОРНОВАНА видача людину в список не заводить, хоч ящики в неї є', () => {
    // Взяла 25 на p3 (живий документ) і 10 на p1 (сторнований). На p1 їй бути нема з чого:
    // документа, який її сюди привів, більше немає. Без фільтра за `voidedDate` вона
    // стояла б у таблиці Шипинок із мережевим балансом 25.
    const folk = [...FOLK, supplier('s14', 'Шевчук')]
    const issues = [
      ...ISSUES,
      issue({ supplierId: 's14', units: 25, pointId: 'p3' }),
      issue({ supplierId: 's14', units: 10, pointId: 'p1', voidedDate: '2026-07-30' }),
    ]
    expect(inFieldRows('p1', folk, issues, RETURNS).map((r) => r.supplier.id)).not.toContain('s14')
    expect(inFieldRows('p3', folk, issues, RETURNS)[0].balance.units).toBe(25)
  })

  it('відбір — по точці, а БАЛАНС мережевий: узяла 20 тут і 20 там — у рядку 40', () => {
    // Рішення з коментаря `inFieldRows`, пришпилене числом: таблиця не рахує власного,
    // точкового балансу, бо вікно повернення читає той самий `crateBalance()`. Розійтись
    // ці двоє не мають права — а розійшлися б мовчки.
    const folk = [supplier('s20', 'Ткачук')]
    const issues = [
      issue({ supplierId: 's20', units: 20, pointId: 'p1' }),
      issue({ supplierId: 's20', units: 20, pointId: 'p3' }),
    ]
    expect(inFieldRows('p1', folk, issues, [])[0].balance.units).toBe(40)
  })

  it('постачальник, якого немає в довіднику, рядка не отримує', () => {
    expect(inFieldRows('p1', [], ISSUES, RETURNS)).toEqual([])
  })
})

describe('modeLabel — «за кошти» і «розписка», словами клієнтки (1081)', () => {
  const balance = (units: number[], modes: ('deposit' | 'receipt')[]) =>
    crateBalance(
      's30',
      units.map((u, i) => issue({ supplierId: 's30', units: u, mode: modes[i], time: `0${i + 8}:00` })),
      [],
    )

  it('усе за кошти — «за кошти», без жодного числа', () => {
    expect(modeLabel(balance([20], ['deposit']))).toBe('за кошти')
  })

  it('усе за розписку — «розписка»: 80 ящиків із рядка 5 її аркуша', () => {
    const b = balance([80], ['receipt'])
    expect(b.receipt).toBe(80)
    expect(b.depositHeld).toBe(0)
    expect(modeLabel(b)).toBe('розписка')
  })

  it('ЗМІШАНИЙ випадок показує ОБИДВА числа, а не більше з них: 20 за кошти + 70 за розписку', () => {
    // Саме на цьому рядку видно, що завдаток лежить не за всі її ящики: ящиків 90,
    // а грошей у нас — за 20 із них.
    const b = balance([20, 70], ['deposit', 'receipt'])
    expect(b.units).toBe(90)
    expect(b.deposit).toBe(20)
    expect(b.receipt).toBe(70)
    expect(modeLabel(b)).toBe('за кошти 20 · розписка 70')
    expect(modeLabel(b)).not.toBe('розписка')
  })
})

describe('слова, які відмінюються разом із числом', () => {
  it('ящик · ящики · ящиків', () => {
    expect(crateWord(1)).toBe('ящик')
    expect(crateWord(3)).toBe('ящики')
    expect(crateWord(11)).toBe('ящиків')
    expect(crateWord(275)).toBe('ящиків')
  })

  it('прикметник відмінюється теж: «341 порожній ящик»', () => {
    expect(emptyCrateWord(341)).toBe('порожній ящик')
    expect(emptyCrateWord(2)).toBe('порожні ящики')
    expect(emptyCrateWord(0)).toBe('порожніх ящиків')
  })

  it('пустих буває МЕНШЕ НУЛЯ, і слово там теж мусить бути правильне', () => {
    // Наділ 600, а видали 907 — `CrateStandingBar` малює −307 червоним. Без Math.abs
    // `plural` брав би n % 10 = −7 і завжди віддавав останню форму: «−1 порожніх ящиків».
    expect(emptyCrateWord(-1)).toBe('порожній ящик')
    expect(emptyCrateWord(-307)).toBe('порожніх ящиків')
    expect(emptyCrateWord(-2)).toBe('порожні ящики')
  })

  it('«11 осіб» у шапці таблиці — саме та цифра, що її віддає inFieldRows', () => {
    expect(personWord(rows().length)).toBe('осіб')
    expect(personWord(1)).toBe('особа')
    expect(personWord(2)).toBe('особи')
  })

  it('«з 3 квитанцій» — після «з» завжди родовий, у всіх формах', () => {
    expect(receiptWord(1)).toBe('квитанції')
    expect(receiptWord(3)).toBe('квитанцій')
    expect(receiptWord(27)).toBe('квитанцій')
  })
})
