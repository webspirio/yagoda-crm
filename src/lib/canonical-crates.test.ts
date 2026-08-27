import { describe, expect, it } from 'vitest'
import { allocateCrateReturn, crateBalance, crateIssueMode, crateRefund, openCrateIssues } from './calc'
import type { CrateIssue, CrateReturn } from './types'

/**
 * ПРИЙМАЛЬНИЙ тест фази 5 (`21 §8.2`).
 *
 * Чому він лежить окремо від `crates.test.ts` — та сама причина, що й у
 * `canonical-day.test.ts`: тест, написаний автором реалізації, найчастіше повторює саму
 * реалізацію. Тут числа переписані РУКАМИ з аркуша `Ящики` файла клієнтки (`Table_1`,
 * 15 рядків, 13 людей) і зі спеки, а не взяті з виводу коду.
 *
 * Що цей день доводить: **одна таблиця на 15 рядків дає ТРИ різні числа**, і жодне з них
 * не видно з самої таблиці.
 *
 *   33 000 ₴ — що стверджує її аркуш (`E3`): 275 × 120, бо повернення ніколи не
 *              віднімаються — у двох рядках у грошову клітинку набрано назву села, і
 *              SUBTOTAL текст просто пропускає (`H1`);
 *   23 400 ₴ — ВАРТІСТЬ ящиків, які зараз у полі: 195 × 120;
 *   13 800 ₴ — ГРОШІ, які ми справді тримаємо: 115 × 120, бо 80 ящиків узяті за
 *              розписку, і грошей за них немає взагалі.
 *
 * Жодного справжнього прізвища тут немає і бути не може: люди — це `s1…s13`.
 */
describe('канонічний журнал ящиків — звірка зі спекою 21 §8.2', () => {
  /** Аркуш `Ящики`, рядки 7–21: [людина, ящиків]. Двоє стоять у двох рядках кожен (`H2`). */
  const LEDGER: [string, number][] = [
    ['s1', 30],
    ['s2', 50],
    ['s3', 3],
    ['s4', 10],
    ['s5', 80],
    ['s6', 10],
    ['s7', 30],
    ['s8', 3],
    ['s9', 15],
    ['s9', 5],
    ['s10', 10],
    ['s7', 10],
    ['s11', 8],
    ['s12', 1],
    ['s13', 10],
  ]

  /** Ціна ящика в її файлі: `Ящики!L2 = 120`, і те саме віддає VLOOKUP по Чешці. */
  const PRICE = 120

  const issues: CrateIssue[] = LEDGER.map(([supplierId, units], i) => {
    const mode = crateIssueMode(units)
    const perUnit = mode === 'deposit' ? PRICE : 0
    return {
      id: `L${i + 1}`,
      date: '2026-07-05',
      time: `${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`,
      pointId: 'p1',
      supplierId,
      units,
      mode,
      depositPerUnit: perUnit,
      depositTaken: units * perUnit,
      operatorId: 'Оксана Г.',
    }
  })

  /** Повернули рівно двоє: рядок 7 — 30 ящиків, рядок 8 — 50 (`H1`). */
  const returns: CrateReturn[] = [
    ['s1', 'L1', 30],
    ['s2', 'L2', 50],
  ].map(([supplierId, issueId, units]) => {
    const allocations = [
      { issueId: issueId as string, units: units as number, perUnit: PRICE, amount: (units as number) * PRICE },
    ]
    return {
      id: `R-${issueId}`,
      date: '2026-07-28',
      time: '11:00',
      pointId: 'p1',
      supplierId: supplierId as string,
      units: units as number,
      allocations,
      depositRefund: crateRefund(allocations),
      operatorId: 'Оксана Г.',
    }
  })

  const everyone = [...new Set(LEDGER.map(([s]) => s))]
  const totals = everyone.reduce(
    (acc, s) => {
      const b = crateBalance(s, issues, returns)
      return {
        taken: acc.taken + b.taken,
        returned: acc.returned + b.returned,
        units: acc.units + b.units,
        deposit: acc.deposit + b.deposit,
        receipt: acc.receipt + b.receipt,
        held: Math.round((acc.held + b.depositHeld) * 100) / 100,
        people: acc.people + (b.units > 0 ? 1 : 0),
      }
    },
    { taken: 0, returned: 0, units: 0, deposit: 0, receipt: 0, held: 0, people: 0 },
  )

  it('в аркуші 15 рядків і 13 людей', () => {
    expect(LEDGER).toHaveLength(15)
    expect(everyone).toHaveLength(13)
  })

  it('видано 275 ящиків', () => {
    expect(totals.taken).toBe(275)
  })

  it('повернуто 80 ящиків', () => {
    expect(totals.returned).toBe(80)
  })

  it('у полі лишилося 195 ящиків', () => {
    expect(totals.units).toBe(195)
  })

  it('із них 115 за кошти і 80 за розписку', () => {
    expect(totals.deposit).toBe(115)
    expect(totals.receipt).toBe(80)
    expect(totals.deposit + totals.receipt).toBe(195)
  })

  it('ящики тримають 11 людей, а не 13: двоє повернули все', () => {
    expect(totals.people).toBe(11)
  })

  it('ЗАВДАТКІВ У НАС 13 800,00 ₴ — і це 115 × 120, а не 195 × 120', () => {
    expect(totals.held).toBe(13_800)
    expect(totals.held).toBe(115 * PRICE)
    expect(totals.held).not.toBe(195 * PRICE)
  })

  it('узято завдатків 23 400,00 ₴, віддано 9 600,00 ₴, різниця — ті самі 13 800,00', () => {
    const taken = issues.reduce((n, i) => n + i.depositTaken, 0)
    const refunded = returns.reduce((n, r) => n + r.depositRefund, 0)
    expect(taken).toBe(23_400)
    expect(refunded).toBe(9_600)
    expect(taken - refunded).toBe(13_800)
  })

  /*
   * ДВА РЯДКИ НИЖЧЕ РАНІШЕ НЕ ВИКОНУВАЛИ ЖОДНОГО РЯДКА ПРОДАКШН-КОДУ. Тут стояло
   * `expect(33_000 - 23_400).toBe(9_600)` і `expect(275 * PRICE).toBe(33_000)` —
   * твердження про віднімання й множення в JavaScript, зелені при БУДЬ-ЯКІЙ реалізації
   * рушія. Текст був вартий того, щоб лишитися (він пояснює три числа), тому тести не
   * видалені, а привʼязані: обидва множники тепер приходять із `crateBalance()`.
   */
  it('9 600,00 ₴ — це РІВНО та сума, що губиться в її аркуші через назву села в грошовій клітинці', () => {
    expect(totals.taken * PRICE - totals.units * PRICE).toBe(9_600)
    expect(totals.returned * PRICE).toBe(9_600)
  })

  it('аркуш стверджує 33 000,00 ₴ — це ВСЕ видане, без жодного повернення', () => {
    // 275 приходить із `taken`, який рахує рушій по 13 людях, а не з літерала в тесті.
    expect(totals.taken).toBe(275)
    expect(totals.taken * PRICE).toBe(33_000)
    // і саме цим воно відрізняється від наступних двох чисел
    expect(totals.taken * PRICE).not.toBe(totals.units * PRICE)
    expect(totals.taken * PRICE).not.toBe(totals.held)
  })

  it('вартість ящиків у полі — 23 400,00 ₴, і вона НЕ дорівнює грошам у шухляді', () => {
    expect(totals.units * PRICE).toBe(23_400)
    expect(totals.units * PRICE - totals.held).toBe(9_600)
  })

  it('єдиний рядок понад 50 ящиків пішов за розписку і не дав ані копійки', () => {
    const paper = issues.filter((i) => i.mode === 'receipt')
    expect(paper).toHaveLength(1)
    expect(paper[0].units).toBe(80)
    expect(paper[0].depositTaken).toBe(0)
  })

  it('людина з двох рядків має 40 ящиків і 4 800,00 ₴ завдатку', () => {
    const b = crateBalance('s7', issues, returns)
    expect(b.units).toBe(40)
    expect(b.depositHeld).toBe(4_800)
  })

  it('часткове повернення 7 із 40 дає 840,00 ₴ і лишає 33 ящики на 3 960,00 ₴', () => {
    const alloc = allocateCrateReturn(7, openCrateIssues('s7', issues, returns))
    expect(crateRefund(alloc)).toBe(840)
    const after = crateBalance('s7', issues, [
      ...returns,
      {
        id: 'R-part',
        date: '2026-08-04',
        time: '12:00',
        pointId: 'p1',
        supplierId: 's7',
        units: 7,
        allocations: alloc,
        depositRefund: crateRefund(alloc),
        operatorId: 'Оксана Г.',
      },
    ])
    expect(after.units).toBe(33)
    expect(after.depositHeld).toBe(3_960)
  })
})
