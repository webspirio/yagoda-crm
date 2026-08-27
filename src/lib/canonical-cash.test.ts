import { describe, expect, it } from 'vitest'
import { cashStanding, checkBerryPayout } from './calc'
import type { CashFloat, Payout, Reception, Transfer } from './types'

/**
 * ПРИЙМАЛЬНИЙ тест фази 6 (`21 §8.3`).
 *
 * Числа — ЇЇ ВЛАСНІ, з дзвінка №4, ряд. 1187–1193, переписані сюди руками:
 *   «за три дні… сумувалася кількість грошей, наприклад, там 250 000»
 *   «керівник віддає, наприклад, тільки 150»
 *   «виходить, що ще мінус, типу, ще 100 лишається»
 *   «просто щоб бачили вони, що їм не хватає до 200»
 *
 * І одна річ, якої в її словах немає, а модель її показує: переказ МУСИВ приїхати вранці
 * третього дня. Якби він не приїхав, каса пішла б у мінус на 50 000, і `G12`/`I58`
 * заблокували б виплату на 30 001-й гривні. Тобто в її реальному процесі гроші вже
 * приїжджають частинами протягом цих трьох днів — інакше точка не могла б працювати.
 */
describe('канонічна каса — звірка зі спекою 21 §8.3', () => {
  const FLOAT = 200_000
  const D1 = '2026-08-01'
  const D2 = '2026-08-02'
  const D3 = '2026-08-03'

  const floats: CashFloat[] = [
    {
      id: 'f1',
      pointId: 'p1',
      amount: FLOAT,
      effectiveFrom: D1,
      setBy: 'Керівник',
      setDate: D1,
      setTime: '07:00',
    },
  ]

  /** Видано за ягоду того дня: 90 000 + 80 000 + 80 000 = 250 000. */
  const spend: [string, number][] = [
    [D1, 90_000],
    [D2, 80_000],
    [D3, 80_000],
  ]
  const receptions: Reception[] = spend.map(([date, paid], i) => ({
    id: `rc${i}`,
    code: `К-${i}`,
    date,
    time: '14:00',
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
  }))

  /** «керівник віддає тільки 150» — уранці третього дня, до закупівлі того дня. */
  const transfers: Transfer[] = [
    {
      id: 'tf1',
      date: D3,
      pointId: 'p1',
      crates: 0,
      cash: 150_000,
      carrier: 'Перевізник',
      sentBy: 'Керівник',
      sentTime: '07:30',
      status: 'accepted',
      acceptedBy: 'Оксана Г.',
      acceptedTime: '09:10',
    },
  ]

  const payouts: Payout[] = []
  const at = (date: string, withTransfer = true) =>
    cashStanding({
      pointId: 'p1',
      date,
      openedOn: D1,
      floats,
      receptions,
      payouts,
      transfers: withTransfer ? transfers : [],
      issues: [],
      returns: [],
    })

  it('день 1: видано 90 000 — у касі 110 000,00, база винна 90 000,00', () => {
    const s = at(D1)
    expect(s.berryOut).toBe(90_000)
    expect(s.berryCash).toBe(110_000)
    expect(s.floatShortfall).toBe(90_000)
  })

  it('день 2: видано ще 80 000 — у касі 30 000,00, база винна 170 000,00', () => {
    const s = at(D2)
    expect(s.berryOut).toBe(170_000)
    expect(s.berryCash).toBe(30_000)
    expect(s.floatShortfall).toBe(170_000)
  })

  it('день 3: переказ 150 000 прийнято, видано 80 000 — У КАСІ 100 000,00', () => {
    const s = at(D3)
    expect(s.cashIn).toBe(150_000)
    expect(s.berryOut).toBe(250_000)
    expect(s.berryCash).toBe(100_000)
  })

  it('НЕ ХВАТАЄ ДО НАДІЛУ рівно 100 000,00 — «ще мінус, типу, ще 100 лишається»', () => {
    expect(at(D3).floatShortfall).toBe(100_000)
    expect(at(D3).float).toBe(200_000)
  })

  it('разом за три дні видано 250 000,00, переказано 150 000,00', () => {
    // Перший рядок — про ВХІДНІ дані: сума її прикладу справді 250 000. Решта — про
    // рушій. Раніше останнім рядком тут стояло `expect(200_000 - 100_000).toBe(100_000)`:
    // твердження про віднімання в JavaScript, зелене при будь-якій реалізації. Тепер
    // обидва доданки приходять із `cashStanding()` — наділ і те, що з нього лишилося.
    expect(spend.reduce((n, [, v]) => n + v, 0)).toBe(250_000)
    const s = at(D3)
    expect(s.berryOut).toBe(250_000)
    expect(s.cashIn).toBe(150_000)
    expect(s.float! - s.berryCash).toBe(100_000)
    expect(s.floatShortfall).toBe(100_000)
  })

  it('шухляда дорівнює касі за ягоду: завдатків за ящики тут немає', () => {
    const s = at(D3)
    expect(s.crateCash).toBe(0)
    expect(s.expectedCash).toBe(100_000)
  })

  it('БЕЗ переказу третій день пішов би в мінус на 50 000,00 — тобто він мусив приїхати', () => {
    const s = at(D3, false)
    expect(s.berryCash).toBe(-50_000)
  })

  it('і G12 зупинив би виплату на 30 001-й гривні: у касі 30 000,00', () => {
    const beforeDay3 = at(D2, false)
    expect(beforeDay3.berryCash).toBe(30_000)
    expect(checkBerryPayout(30_000, beforeDay3.berryCash).ok).toBe(true)
    expect(checkBerryPayout(30_000.01, beforeDay3.berryCash).ok).toBe(false)
    expect(checkBerryPayout(80_000, beforeDay3.berryCash)).toEqual({ ok: false, max: 30_000 })
  })
})
