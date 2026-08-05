import { describe, expect, it } from 'vitest'
import { openDebts, round2, sum, weigh } from './calc'
import {
  BERRIES,
  buildSeed,
  DEFAULT_SETTINGS,
  DEFAULT_TARE_ID,
  POINTS,
  PRODUCTS,
  SEASON_START,
  TARE_TYPES,
  TODAY,
} from './seed'
import { SUPPLIER_SEED } from './seed-suppliers'
import type { ISODate, Reception } from './types'

/** Останній повний день історії: 27.06–03.08 — це і є 38 торгових днів ✓ PART A */
const HISTORY_END: ISODate = '2026-08-03'

const seed = buildSeed()

const inSeason = (pointId: string) =>
  seed.receptions.filter(
    (r) => r.pointId === pointId && r.date >= SEASON_START && r.date <= HISTORY_END,
  )

const bySupplier = new Map<string, Reception[]>()
for (const r of seed.receptions) {
  const list = bySupplier.get(r.supplierId) ?? []
  list.push(r)
  bySupplier.set(r.supplierId, list)
}
const payoutsBySupplier = new Map(
  [...bySupplier.keys()].map((id) => [id, seed.payouts.filter((p) => p.supplierId === id)]),
)

/**
 * Відкритий залишок пункту РІВНО так, як його рахує екран: книга кожного пункту своя,
 * тому openDebts() отримує лише прийомки цього пункту. Раніше тут зводилось по всій
 * мережі, а потім фільтрувалось — і тест міряв величину, якої на екрані немає.
 */
function openByPoint(pointId: string) {
  let total = 0
  const perSupplier = new Map<string, number>()
  for (const [id, own] of bySupplier) {
    const here = own.filter((r) => r.pointId === pointId)
    if (!here.length) continue
    const open = sum(openDebts(id, here, payoutsBySupplier.get(id) ?? []), (o) => o.open)
    if (open <= 0.009) continue
    total += open
    perSupplier.set(id, open)
  }
  return { total: round2(total), perSupplier }
}

const visitSize = new Map<string, number>()
for (const r of seed.receptions) {
  visitSize.set(r.visitId ?? r.id, (visitSize.get(r.visitId ?? r.id) ?? 0) + 1)
}

const near = (a: string, b: string) => {
  const norm = (s: string) => s.toLowerCase().replace(/[ʼ'’]/g, "'").replace(/\s+/g, ' ').trim()
  const x = norm(a)
  const y = norm(b)
  if (x === y) return false
  if (Math.abs(x.length - y.length) > 3) return false
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    const row = [i]
    for (let j = 1; j <= y.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    prev = row
  }
  return prev[y.length] <= 3
}

describe('довідники', () => {
  it('208 постачальників у реєстрі (PART A, H5: 209 рядків аркуша, 208 осіб)', () => {
    expect(SUPPLIER_SEED).toHaveLength(208)
    expect(seed.suppliers).toHaveLength(208)
    expect(new Set(seed.suppliers.map((s) => s.name)).size).toBe(208)
  })

  it('телефон не заповнений ні в кого (PART C 7, H5: 0 з 209)', () => {
    expect(seed.suppliers.filter((s) => s.phone !== undefined)).toHaveLength(0)
  })

  it('10 пунктів, з них 5 активних (PART A: список із 10, «від 5 до 10»)', () => {
    expect(POINTS).toHaveLength(10)
    expect(POINTS.filter((p) => p.active)).toHaveLength(5)
    expect(POINTS.filter((p) => p.isMain)).toEqual([expect.objectContaining({ name: 'Шипинки' })])
  })

  it('17 сортів (PART A)', () => {
    expect(BERRIES).toHaveLength(17)
    expect(new Set(BERRIES.map((b) => b.id)).size).toBe(17)
  })

  it('9 товарів, і Кизил не має жодного сорту (PART A)', () => {
    expect(PRODUCTS).toHaveLength(9)
    const withoutVariety = PRODUCTS.filter((p) => !BERRIES.some((b) => b.product === p.name))
    expect(withoutVariety.map((p) => p.name)).toEqual(['Кизил'])
  })

  it('4 тари, у кожної є ціна; Чешка 1,2 кг / 120 ₴ і вона за замовчуванням (PART A, H5)', () => {
    expect(TARE_TYPES).toHaveLength(4)
    expect(TARE_TYPES.filter((t) => t.price > 0)).toHaveLength(4)
    const cheshka = TARE_TYPES.find((t) => t.id === DEFAULT_TARE_ID)
    expect(cheshka).toMatchObject({ name: 'Чешка', weight: 1.2, price: 120 })
    // у 1 701 з 1 701 реального рядка стоїть саме вона — у сіді інших тар немає взагалі
    expect(seed.receptions.every((r) => r.tare.every((l) => l.tareId === DEFAULT_TARE_ID))).toBe(
      true,
    )
  })

  it('чотири верифіковані ціни точні, і ОПТ не завжди дорожчий (PART A)', () => {
    const price = (name: string) => BERRIES.find((b) => b.name === name)?.basePrice
    expect(price('Ожина')).toBe(60)
    expect(price('Ожина ОПТ')).toBe(65)
    expect(price('Шипшина')).toBe(35)
    expect(price('Шипшина ОПТ')).toBe(30)
  })

  it('межі Дод. ціни −15…+30 (M7: «не більше 20… чи не більше 30», +30 на другому пункті)', () => {
    expect(DEFAULT_SETTINGS).toEqual({ surchargeMin: -15, surchargeMax: 30 })
  })
})

describe('обсяги Шипинок', () => {
  const p1 = inSeason('p1')

  it('p1: 1 701 рядок за 38 днів, максимум 78 за день (PART A, H10)', () => {
    expect(p1.length).toBeGreaterThan(1701 * 0.98)
    expect(p1.length).toBeLessThan(1701 * 1.02)
    expect(new Set(p1.map((r) => r.date)).size).toBe(38)
    const perDay = new Map<string, number>()
    for (const r of p1) perDay.set(r.date, (perDay.get(r.date) ?? 0) + 1)
    expect(Math.max(...perDay.values())).toBe(78)
  })

  it('p1: 47 441 кг чистої ваги ±3 % (PART A)', () => {
    const kg = round2(p1.reduce((s, r) => s + r.net, 0))
    expect(kg).toBeGreaterThan(47_441 * 0.97)
    expect(kg).toBeLessThan(47_441 * 1.03)
  })

  it('p1: нараховано 5 968 793 ₴ ±5 % (PART A)', () => {
    const accrued = round2(p1.reduce((s, r) => s + r.amount, 0))
    expect(accrued).toBeGreaterThan(5_968_793 * 0.95)
    expect(accrued).toBeLessThan(5_968_793 * 1.05)
  })

  it('p1: відкритий залишок на 04.08 — 1 273 518 ₴ ±8 % (PART A, H5)', () => {
    const { total } = openByPoint('p1')
    expect(total).toBeGreaterThan(1_273_518 * 0.92)
    expect(total).toBeLessThan(1_273_518 * 1.08)
  })

  it('піковий день 15.07 — 69 рядків і 3 374 кг (H10)', () => {
    const peak = seed.receptions.filter((r) => r.pointId === 'p1' && r.date === '2026-07-15')
    expect(peak).toHaveLength(69)
    expect(round2(peak.reduce((s, r) => s + r.net, 0))).toBeCloseTo(3374.3, 0)
  })

  it('04.08 — частковий день у роботі, час між 07:00 і 12:00 (сід)', () => {
    const today = seed.receptions.filter((r) => r.date === TODAY && r.pointId === 'p1')
    expect(today.length).toBeGreaterThan(0)
    expect(today.length).toBeLessThan(p1.length / 38)
    const all = seed.receptions.filter((r) => r.date === TODAY)
    expect(all.every((r) => r.time >= '07:00' && r.time < '12:00')).toBe(true)
  })
})

describe('Войнашівка', () => {
  it('p2: БОРГ 855 676 ₴ ±8 %, і один постачальник у ньому на 129 278 ₴ ±10 % (H9, S16)', () => {
    const { total, perSupplier } = openByPoint('p2')
    expect(total).toBeGreaterThan(855_676 * 0.92)
    expect(total).toBeLessThan(855_676 * 1.08)
    const top = Math.max(...perSupplier.values())
    expect(top).toBeGreaterThan(129_278 * 0.9)
    expect(top).toBeLessThan(129_278 * 1.1)
  })

  it('p2: 184 рядки за 01–04.08 (PART A, H9)', () => {
    const p2 = seed.receptions.filter((r) => r.pointId === 'p2')
    expect(p2).toHaveLength(184)
    expect(p2.every((r) => r.date >= '2026-08-01')).toBe(true)
  })
})

/**
 * Борг мережі не має збиратись в одній людині. Ground truth знає РІВНО ОДНЕ велике персональне
 * число — 129 278 ₴ на другому пункті ✓ H9/S16. Усе, що більше, — артефакт сіду, і на
 * «Залишках» це перше, що впадає в око керівникові.
 */
describe('концентрація залишку', () => {
  const nameOf = new Map(seed.suppliers.map((s) => [s.id, s.name]))
  const crossPoint = new Map<string, number>()
  for (const [id, own] of bySupplier) {
    for (const o of openDebts(id, own, payoutsBySupplier.get(id) ?? [])) {
      crossPoint.set(id, round2((crossPoint.get(id) ?? 0) + o.open))
    }
  }
  const ranked = [...crossPoint.entries()].sort((a, b) => b[1] - a[1])

  it('жоден постачальник не тримає понад 200 000 ₴ по всіх пунктах разом (H9/S16)', () => {
    const top3 = ranked
      .slice(0, 3)
      .map(([id, v]) => `${nameOf.get(id)} — ${v.toFixed(2)} ₴`)
      .join('; ')
    expect(ranked[0][1], `найбільші баланси мережі: ${top3}`).toBeLessThan(200_000)
  })

  it('боржник на 129 278 ₴ поза Войнашівкою — звичайний постачальник (H9/S16)', () => {
    const { perSupplier } = openByPoint('p2')
    const [topId, atP2] = [...perSupplier.entries()].sort((a, b) => b[1] - a[1])[0]
    const elsewhere = round2((crossPoint.get(topId) ?? 0) - atP2)
    // 665 968 ₴ на Попівцях робили з нього 26 % боргу всієї мережі — цього не каже ніщо
    expect(elsewhere, `${nameOf.get(topId)} поза p2: ${elsewhere.toFixed(2)} ₴`).toBeLessThan(atP2)
    expect(elsewhere).toBeLessThan(80_000)
  })

  it('на жодному пункті одна людина не тримає більш ніж 30 % його залишку', () => {
    for (const point of POINTS.filter((p) => p.active)) {
      const { total, perSupplier } = openByPoint(point.id)
      const [id, top] = [...perSupplier.entries()].sort((a, b) => b[1] - a[1])[0]
      const share = (top / total) * 100
      expect(
        share,
        `${point.name}: ${nameOf.get(id)} тримає ${top.toFixed(0)} ₴ із ${total.toFixed(0)} ₴`,
      ).toBeLessThan(30)
    }
  })

  it('залишок трьох малих пунктів — одного порядку (Попівці були в 23 рази важчі)', () => {
    const totals = ['p3', 'p4', 'p5'].map((id) => openByPoint(id).total)
    expect(Math.min(...totals)).toBeGreaterThan(0)
    expect(Math.max(...totals) / Math.min(...totals)).toBeLessThan(10)
  })

  it('на кожному активному пункті десятки постачальників із залишком на TODAY (M2)', () => {
    for (const point of POINTS.filter((p) => p.active)) {
      expect(openByPoint(point.id).perSupplier.size, point.name).toBeGreaterThanOrEqual(20)
    }
  })
})

/** Малі пункти: 6–10 рядків/день, і Міжлісся — мінімум мережі ✓ docs/05 §1.5 */
describe('малі пункти', () => {
  const perDay = (pointId: string) => {
    const map = new Map<ISODate, number>()
    // 04.08 — частковий день, він рахується півсмени і в вилку не входить
    for (const r of seed.receptions) {
      if (r.pointId !== pointId || r.date === TODAY) continue
      map.set(r.date, (map.get(r.date) ?? 0) + 1)
    }
    return [...map.values()]
  }

  it('Гайове, Попівці, Міжлісся — 6–10 рядків на день (docs/05 §1.5)', () => {
    for (const pointId of ['p3', 'p4', 'p5']) {
      const lines = perDay(pointId)
      expect(lines).toHaveLength(38)
      expect(Math.min(...lines), pointId).toBeGreaterThanOrEqual(6)
      expect(Math.max(...lines), pointId).toBeLessThanOrEqual(10)
    }
  })

  it('Міжлісся — найлегший пункт мережі: «Зведення» показує асиметрію (M3, docs/05 §1.5)', () => {
    const kg = (pointId: string) =>
      round2(
        seed.receptions.filter((r) => r.pointId === pointId).reduce((s, r) => s + r.net, 0),
      )
    const lines = (pointId: string) => seed.receptions.filter((r) => r.pointId === pointId).length
    const active = POINTS.filter((p) => p.active).map((p) => p.id)
    // за кілограмами — мінімум усієї мережі, включно з чотириденною Войнашівкою
    expect(kg('p5')).toBe(Math.min(...active.map(kg)))
    // за рядками — найлегший із трьох малих (Войнашівка коротша просто за календарем)
    expect(lines('p5')).toBeLessThan(lines('p3'))
    expect(lines('p5')).toBeLessThan(lines('p4'))
    // і це помітна різниця, а не шум: щонайменше на 15 % легше за сусіда
    expect(kg('p5')).toBeLessThan(Math.min(kg('p3'), kg('p4')) * 0.85)
  })
})

describe('форма прийомок', () => {
  it('мультирядкових візитів 20,8 % ±4 пп, максимум 5 рядків (PART C 15, H5)', () => {
    const sizes = [...visitSize.values()]
    const share = (sizes.filter((n) => n > 1).length / sizes.length) * 100
    expect(share).toBeGreaterThan(20.8 - 4)
    expect(share).toBeLessThan(20.8 + 4)
    expect(Math.max(...sizes)).toBe(5)
  })

  it('Дод. ціна на 11 % ±3 пп рядків, і ніде вище налаштованого капу (PART B, M7, S13)', () => {
    const withBonus = seed.receptions.filter((r) => r.bonus !== 0)
    const share = (withBonus.length / seed.receptions.length) * 100
    expect(share).toBeGreaterThan(8)
    expect(share).toBeLessThan(14)
    // кап із «Тари і сортів» — верхня межа для всіх рядків без винятку
    const inCap = withBonus.every(
      (r) =>
        r.bonus >= DEFAULT_SETTINGS.surchargeMin && r.bonus <= DEFAULT_SETTINGS.surchargeMax,
    )
    expect(inCap).toBe(true)
  })

  it('+26…+30 трапляється тільки на другому пункті — саме цим виправданий кап 30 (M7, S13)', () => {
    // S13: спостережений діапазон −15…+25, і «+30 на другому пункті». Без цих рядків власниця
    // бачила б на «Тарі і сортах» межу 30, під якою в даних немає нічого вище +25.
    const others = seed.receptions.filter((r) => r.pointId !== 'p2' && r.bonus !== 0)
    expect(others.every((r) => r.bonus >= -15 && r.bonus <= 25)).toBe(true)
    const high = seed.receptions.filter((r) => r.bonus > 25)
    expect(high.length).toBeGreaterThanOrEqual(3)
    expect(high.length).toBeLessThanOrEqual(6)
    expect([...new Set(high.map((r) => r.pointId))]).toEqual(['p2'])
    expect(Math.max(...high.map((r) => r.bonus))).toBe(DEFAULT_SETTINGS.surchargeMax)
  })

  it('найбільший рядок сезону: 701,5 кг брутто, 115 ящиків, Піддон (PART A, S12)', () => {
    const big = seed.receptions.find((r) => r.gross === 701.5)
    expect(big).toBeDefined()
    expect(big!.pallet).toBeGreaterThan(0)
    expect(big!.tare.reduce((s, l) => s + l.count, 0)).toBe(115)
    expect(big!.amount).toBeGreaterThan(81_525 * 0.95)
    expect(big!.amount).toBeLessThan(81_525 * 1.05)
  })

  it('і поруч рядок на 3 кг того ж дня (PART A, S12)', () => {
    const big = seed.receptions.find((r) => r.gross === 701.5)!
    const small = seed.receptions.filter((r) => r.date === big.date && r.net <= 3)
    expect(small.length).toBeGreaterThan(0)
    expect(small[0].pallet).toBe(0)
    expect(small[0].bonus).toBe(0)
  })

  it('Піддон рідкий і майже весь на другому пункті (PART B, S14)', () => {
    const pallets = seed.receptions.filter((r) => r.pallet > 0)
    expect(pallets.filter((r) => r.pointId === 'p1')).toHaveLength(1)
    expect(pallets.filter((r) => r.pointId === 'p2')).toHaveLength(6)
    expect(pallets.every((r) => r.pallet === 6 || (r.pallet >= 13.9 && r.pallet <= 19.3))).toBe(
      true,
    )
  })

  it('переплати існують, але їх горстка, а не 15 % (H7 — віконечко цього не дає)', () => {
    const negative = seed.receptions.filter((r) => r.debt < 0)
    expect(negative.length).toBeGreaterThan(0)
    expect(negative.length).toBeLessThan(20)
  })
})

describe('рушій і сід рахують однаково', () => {
  it('net кожного рядка = weigh() від його ж брутто/піддона/тари (calc.ts)', () => {
    const wrong = seed.receptions.filter((r) => {
      const w = weigh(
        { gross: r.gross, pallet: r.pallet, tare: r.tare, price: r.price, bonus: r.bonus },
        TARE_TYPES,
      )
      return w.net !== r.net || w.tareWeight !== r.tareWeight || w.amount !== r.amount
    })
    expect(wrong).toHaveLength(0)
  })

  it('debt кожного рядка = amount − paid (Reception)', () => {
    const wrong = seed.receptions.filter((r) => r.debt !== round2(r.amount - r.paid))
    expect(wrong).toHaveLength(0)
  })

  it('виплати не перевищують боргів, на які їх прив`язано (allocatePayout)', () => {
    const allocated = new Map<string, number>()
    for (const p of seed.payouts) {
      for (const a of p.allocations) {
        allocated.set(a.receptionId, round2((allocated.get(a.receptionId) ?? 0) + a.amount))
      }
    }
    const byId = new Map(seed.receptions.map((r) => [r.id, r]))
    for (const [id, amount] of allocated) {
      expect(byId.get(id)!.debt + 0.01).toBeGreaterThanOrEqual(amount)
    }
  })

  it('Σ прив`язок кожної виплати = її amount (allocatePayout)', () => {
    const wrong = seed.payouts.filter(
      (p) => round2(p.allocations.reduce((s, a) => s + a.amount, 0)) !== p.amount,
    )
    expect(wrong.map((p) => p.code)).toHaveLength(0)
    expect(seed.payouts.every((p) => p.allocations.length > 0)).toBe(true)
  })

  it('originDate прив`язки = дата її прийомки, і в майбутнє не гаситься нічого', () => {
    const byId = new Map(seed.receptions.map((r) => [r.id, r]))
    const badOrigin: string[] = []
    const fromFuture: string[] = []
    for (const p of seed.payouts) {
      for (const a of p.allocations) {
        const r = byId.get(a.receptionId)!
        if (a.originDate !== r.date) badOrigin.push(`${p.code}→${r.code}`)
        if (r.date > p.date) fromFuture.push(`${p.code}→${r.code}`)
      }
    }
    expect(badOrigin).toHaveLength(0)
    expect(fromFuture).toHaveLength(0)
  })

  it('виплата гасить тільки прийомки СВОГО пункту (reconcileDay() рахується попунктно)', () => {
    // інакше «Окремо: видано за ягоду попередніх днів» у касі пункту показує гроші, що вийшли
    // з цієї шухляди за ягоду іншого пункту. Людину розраховують там, куди вона здала ягоду.
    const byId = new Map(seed.receptions.map((r) => [r.id, r]))
    const cross = seed.payouts.flatMap((p) =>
      p.allocations
        .filter((a) => byId.get(a.receptionId)!.pointId !== p.pointId)
        .map((a) => `${p.code} (${p.pointId}) → ${byId.get(a.receptionId)!.code}`),
    )
    expect(cross).toHaveLength(0)
    // те саме з боку каси: скільки пункт видав за старі дні, стільки на ньому й погасилось
    for (const point of POINTS.filter((p) => p.active)) {
      const books = round2(
        seed.payouts.filter((p) => p.pointId === point.id).reduce((s, p) => s + p.amount, 0),
      )
      const absorbed = round2(
        seed.payouts
          .flatMap((p) => p.allocations)
          .filter((a) => byId.get(a.receptionId)!.pointId === point.id)
          .reduce((s, a) => s + a.amount, 0),
      )
      expect(absorbed, point.name).toBeCloseTo(books, 2)
    }
  })

  it('buildSeed() детермінований — два виклики дають той самий JSON', () => {
    expect(JSON.stringify(buildSeed())).toBe(JSON.stringify(buildSeed()))
  })

  it('персистований сід не роздуває localStorage — менше 2 МБ JSON (store.ts)', () => {
    const json = JSON.stringify({
      points: seed.points,
      berries: seed.berries,
      tareTypes: seed.tareTypes,
      suppliers: seed.suppliers,
      prices: seed.prices,
      receptions: seed.receptions,
      payouts: seed.payouts,
    })
    expect(json.length).toBeLessThan(2 * 1024 * 1024)
  })
})

describe('навмисні дублікати в реєстрі', () => {
  it('щонайменше 23 написання — близнюки іншого запису реєстру (H5, PART C 5/6)', () => {
    const names = seed.suppliers.map((s) => s.name)
    const twins = names.filter((a) => names.some((b) => near(a, b)))
    expect(twins.length).toBeGreaterThanOrEqual(23)
  })

  it('обидві пари жорсткого стопу лежать у реєстрі окремими записами (PART C 6)', () => {
    const names = new Set(seed.suppliers.map((s) => s.name))
    for (const name of [
      // одна літера в прізвищі при ідентичному ПІБ
      'Ільчук Оксана Тарасівна',
      'Ільчак Оксана Тарасівна',
      // однакові прізвище + по батькові, різні імена
      'Радчук Надія Петрівна',
      'Радчук Наталія Петрівна',
    ]) {
      expect(names.has(name)).toBe(true)
    }
    // у кожного близнюка свій власний реєстр боргів — саме це й ламає баланс людини
    const forked = seed.suppliers.filter((s) => s.name.startsWith('Ільч'))
    expect(new Set(forked.map((s) => s.id)).size).toBe(forked.length)
  })

  it('села лежать у кількох написаннях одночасно (PART C 8)', () => {
    const villages = new Set(seed.suppliers.map((s) => s.village))
    for (const v of ['копайгород', 'Копайгород', 'Копайгород ', 'шипинки', 'Шипинки']) {
      expect(villages.has(v)).toBe(true)
    }
  })
})

describe('ціна дня', () => {
  it('на 04.08 ціна кожного сорту дорівнює довідниковій (M6)', () => {
    for (const berry of BERRIES) {
      if (TODAY < berry.from || TODAY > berry.to) continue
      const today = seed.prices.filter(
        (p) => p.date === TODAY && p.pointId === 'p1' && p.berryId === berry.id,
      )
      expect(today.length).toBeGreaterThan(0)
      expect(today.every((p) => p.price === berry.basePrice)).toBe(true)
    }
  })

  it('одна ціна на всі активні пункти, автор — керівник (M6)', () => {
    // ключ ціни лишається (дата, пункт, сорт), але число й час — однакові на всіх пунктах
    const perPoint = new Map<string, string[]>()
    for (const p of seed.prices) {
      if (p.date !== SEASON_START || p.berryId !== 'v_mal_1') continue
      const list = perPoint.get(p.pointId) ?? []
      list.push(`${p.time}:${p.price}`)
      perPoint.set(p.pointId, list)
    }
    expect(perPoint.size).toBe(5)
    expect(new Set([...perPoint.values()].map((v) => v.join('|'))).size).toBe(1)
    expect(seed.prices.every((p) => p.author === 'Керівник')).toBe(true)
  })

  it('37 % ±8 пп комбінацій (дата, сорт) мають більш ніж одну ціну за день (PART C 16)', () => {
    const combos = new Map<string, number>()
    for (const p of seed.prices) {
      if (p.pointId !== 'p1') continue
      const key = `${p.date}|${p.berryId}`
      combos.set(key, (combos.get(key) ?? 0) + 1)
    }
    const share = ([...combos.values()].filter((n) => n > 1).length / combos.size) * 100
    expect(share).toBeGreaterThan(29)
    expect(share).toBeLessThan(45)
  })

  it('цінові викиди 1 ₴ і 450/550 ₴ у журналі є (PART C 12)', () => {
    const prices = seed.receptions.map((r) => r.price)
    expect(prices).toContain(1)
    expect(prices).toContain(450)
    expect(prices).toContain(550)
  })
})
