import { describe, expect, it } from 'vitest'
import { openDebts, ownerName, round2, signerFor, sum, weigh } from './calc'
import {
  BERRIES,
  buildSeed,
  DEFAULT_SETTINGS,
  DEFAULT_TARE_ID,
  POINTS,
  PRODUCTS,
  CASH_BOOK_FROM,
  OPERATORS,
  OWNER,
  SEASON_START,
  TARE_TYPES,
  TODAY,
} from './seed'
import { SUPPLIER_SEED } from './seed-suppliers'
import type { ISODate, PointKind, Reception } from './types'

/** Останній повний день історії: 27.06–03.08 — це і є 38 торгових днів ✓ PART A */
const HISTORY_END: ISODate = '2026-08-03'

const seed = buildSeed()

/** Склад — пункт іншого ВИДУ; усе, що каже «пункт прийому», міряється саме по виду */
const pointsOfKind = (kind: PointKind) => seed.points.filter((p) => p.kind === kind)

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

  it('на екрані тільки ті села, які назвав клієнт', () => {
    const NAMED = new Set([
      'Гайове', 'Шипинки', 'Попівці',            // працюють зараз
      'Конищів', 'Михайлівці', 'Журавлівка',     // у планах клієнта
      'Осламів', 'Войнашівка', 'Зоряне', 'Дашківці', 'Міжлісся', // реєстр
    ])
    for (const p of seed.points.filter((x) => x.active && x.kind !== 'base')) {
      expect(NAMED.has(p.name), p.name).toBe(true)
    }
    const active = pointsOfKind('reception')
      .filter((p) => p.active)
      .map((p) => p.name)
    expect(active).toContain('Гайове')
    expect(active).toContain('Шипинки')
    expect(active).toContain('Попівці')
  })

  it('база — приймальний пункт із власними, вищими цінами (M37)', () => {
    const base = pointsOfKind('base')
    expect(base).toHaveLength(1)
    expect(base[0].active).toBe(true)
    // «склад тоже считається як одна прийомка, але тут типа як оптові ціни» (ряд. 545)
    const own = seed.receptions.filter((r) => r.pointId === base[0].id)
    expect(own.length).toBeGreaterThan(0)
    const basePrice = seed.prices.find(
      (p) => p.pointId === base[0].id && p.berryId === 'v_mal_1',
    )!
    const pointPrice = seed.prices.find((p) => p.pointId === 'p1' && p.berryId === 'v_mal_1')!
    expect(basePrice.price).toBeGreaterThan(pointPrice.price)
    // виведені з обігу сорти на складі не котуються взагалі
    const retiredIds = new Set(BERRIES.filter((b) => b.retired).map((b) => b.id))
    expect(seed.prices.some((p) => p.pointId === base[0].id && retiredIds.has(p.berryId))).toBe(
      false,
    )
  })

  it('прийомка складу не зачепила жодного замороженого анкера сезону', () => {
    // якщо котресь із цих чисел поїхало — новий код потрапив НЕ в кінець buildSeed()
    const p1 = inSeason('p1')
    expect(new Set(p1.map((r) => r.date)).size).toBe(38)
    expect(p1.length).toBeGreaterThan(1_701 * 0.97)
    // на складі жодної виплати: борг там нульовий за побудовою, тому попунктна звірка
    // «виплата гасить тільки прийомки свого пункту» лишається чинною
    expect(seed.payouts.some((p) => p.pointId === 'base')).toBe(false)
    expect(seed.receptions.filter((r) => r.pointId === 'base').every((r) => r.debt === 0)).toBe(
      true,
    )
  })

  // ПЕРЕБАЗОВАНО 17 → 18: додається Аронія, названа клієнтом у дзвінку №4 як позиція
  // цього сезону (docs/13 §3, docs/15 З2). Виміряних у файлі клієнта було 17 ✓ PART A.
  it('18 сортів: 17 виміряних плюс Аронія з дзвінка №4 (PART A)', () => {
    expect(BERRIES).toHaveLength(18)
    expect(new Set(BERRIES.map((b) => b.id)).size).toBe(18)
  })

  // ПЕРЕБАЗОВАНО 9 → 10 товарів: Аронія — новий ТОВАР, рядок у PRODUCTS прописаний у
  // docs/15 З2 крок 4. Твердження про Кизил НЕ змінюється: в Аронії свій сорт є, тому
  // товар без жодного сорту й далі рівно один.
  it('10 товарів, і Кизил не має жодного сорту (PART A + Аронія)', () => {
    expect(PRODUCTS).toHaveLength(10)
    const withoutVariety = PRODUCTS.filter((p) => !BERRIES.some((b) => b.product === p.name))
    expect(withoutVariety.map((p) => p.name)).toEqual(['Кизил'])
  })

  it('шість ОПТ-сортів виведені з обігу, але з довідника не зникли', () => {
    const retired = BERRIES.filter((b) => b.retired)
    expect(retired.length).toBe(6)
    expect(retired.every((b) => b.name.includes('ОПТ'))).toBe(true)
    // ціни лишаються перевіреними — на них тримається доказова база
    expect(BERRIES.find((b) => b.name === 'Ожина ОПТ')!.basePrice).toBe(65)
    expect(BERRIES.find((b) => b.name === 'Шипшина ОПТ')!.basePrice).toBe(30)
  })

  it('Аронія є в довіднику і не має історичних квитанцій', () => {
    const aronia = BERRIES.find((b) => b.name === 'Аронія')
    expect(aronia).toBeDefined()
    // вікно сезону ПОЗА демо-періодом: цикл цін робить `continue` до першого rnd(),
    // тому заморожені числа не рухаються (див. seed.ts, `if (day < berry.from …) continue`)
    expect(aronia!.from > TODAY).toBe(true)
    expect(seed.receptions.some((r) => r.berryId === aronia!.id)).toBe(false)
  })

  it('маркер: 34 ОПТ, 18 фермерів, решта без позначки — детерміновано', () => {
    const kinds = seed.suppliers.map((s) => s.kind)
    expect(kinds.filter((k) => k === 'wholesale').length).toBe(34)
    expect(kinds.filter((k) => k === 'farmer').length).toBe(18)
    expect(kinds.filter((k) => k === 'none').length).toBe(208 - 34 - 18)
    // ОПТ ніколи не перетворюється у фермера: набір ОПТ узятий із замороженого літерала
    expect(seed.suppliers.every((s) => s.kind !== 'wholesale' || s.village.length > 0)).toBe(true)
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

  // ПЕРЕБАЗОВАНО −15 → −30: вимога клієнта, що змінилась (M34, дзвінок №4 ряд. 701/729 —
  // «30 - це максимум» і «то ми закрили мінус 30, бо далека дорога»), а не зручність.
  // Верхня межа лишається 30: саме на неї спираються рядки +26…+30 на другому пункті.
  it('межі Дод. ціни −30…+30 (M34, дзвінок №4: «30 - це максимум», мінус до −30)', () => {
    expect(DEFAULT_SETTINGS).toEqual({ surchargeMin: -30, surchargeMax: 30 })
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

describe('Конищів — другий пункт', () => {
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

  it('боржник на 129 278 ₴ поза другим пунктом — звичайний постачальник (H9/S16)', () => {
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

/** Малі пункти: 6–10 рядків/день, і p5 — мінімум мережі ✓ docs/05 §1.5 */
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

  it('Гайове, Попівці, Михайлівці — 6–10 рядків на день (docs/05 §1.5)', () => {
    for (const pointId of ['p3', 'p4', 'p5']) {
      const lines = perDay(pointId)
      expect(lines).toHaveLength(38)
      expect(Math.min(...lines), pointId).toBeGreaterThanOrEqual(6)
      expect(Math.max(...lines), pointId).toBeLessThanOrEqual(10)
    }
  })

  it('Михайлівці — найлегший пункт мережі: «Зведення» показує асиметрію (M3, docs/05 §1.5)', () => {
    const kg = (pointId: string) =>
      round2(
        seed.receptions.filter((r) => r.pointId === pointId).reduce((s, r) => s + r.net, 0),
      )
    const lines = (pointId: string) => seed.receptions.filter((r) => r.pointId === pointId).length
    const active = POINTS.filter((p) => p.active).map((p) => p.id)
    // за кілограмами — мінімум усієї мережі, включно з чотириденною Войнашівкою
    expect(kg('p5')).toBe(Math.min(...active.map(kg)))
    // за рядками — найлегший із трьох малих (другий пункт коротший просто за календарем)
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

  it('одна ціна на всі ПУНКТИ ПРИЙОМУ, автор — керівник (M6)', () => {
    // ключ ціни лишається (дата, пункт, сорт), але число й час — однакові на всіх пунктах
    //
    // ПЕРЕБАЗОВАНО: перелік звужений до пунктів із POINTS. Склад — пункт іншого ВИДУ, і
    // ціни на ньому НАВМИСНО інші, оптові (M37, S-22: «склад тоже считається як одна
    // прийомка, але тут типа як оптові ціни»). Тобто «одна ціна на всі пункти» — це
    // твердження про пʼять пунктів прийому, а не про склад. Без цього звуження додавання
    // складу зробило б perPoint.size === 6, і тест почав би міряти те, чого вимога не
    // казала. Самі числа — 5 і «однаковий рядок цін» — не рухаються.
    const receptionPoints = new Set(POINTS.map((p) => p.id))
    const perPoint = new Map<string, string[]>()
    for (const p of seed.prices) {
      if (p.date !== SEASON_START || p.berryId !== 'v_mal_1') continue
      if (!receptionPoints.has(p.pointId)) continue
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

/*
 * Довідники, що переїхали зі статусу «модульна константа `seed.ts`» у знімок (27.08.2026).
 * Тести тут доводять РІВНО одне: переїзд не змінив ані значень, ані семантики. Це і є та
 * перевірка, якої не було, коли екрани читали підпис і дату прямо з фікстури.
 */
describe('довідники у знімку: config, users, products', () => {
  it('config повторює константи сіду один в один', () => {
    expect(seed.config).toEqual({
      businessToday: TODAY,
      seasonStart: SEASON_START,
      cashBookFrom: CASH_BOOK_FROM,
      crateTareId: DEFAULT_TARE_ID,
    })
  })

  it('products — той самий довідник товарів, що PRODUCTS', () => {
    expect(seed.products).toEqual(PRODUCTS)
  })

  /**
   * `ownerName()` повертає `string`, а не `string | undefined`, і його запасне значення —
   * назва ролі. Це безпечно РІВНО доти, доки в реєстрі є один керівник. Стверджує це
   * саме цей тест, а не коментар у `calc.ts`.
   */
  /**
   * ⚠️ `expect(ownerName(seed.users)).toBe(OWNER)` ОДНЕ БУЛО Б ТАВТОЛОГІЄЮ, і це не
   * дрібниця: `OWNER` дорівнює `'Керівник'`, і запасне значення в `ownerName()` — той
   * самий рядок. Тобто той assert проходив однаково і коли пошук ПРАЦЮЄ, і коли він
   * провалюється у fallback; він лишився б зеленим навіть із `users: []`. Тому нижче
   * перевіряються ОБИДВІ гілки окремо, на реєстрі, де ім'я НЕ дорівнює назві ролі.
   */
  it('у реєстрі рівно один керівник', () => {
    expect(seed.users.filter((u) => u.role === 'owner').length).toBe(1)
    expect(ownerName(seed.users)).toBe(OWNER)
  })

  it('ownerName() читає саме реєстр, а не свій fallback', () => {
    expect(
      ownerName([{ id: 'u_x', name: 'Інша Людина', role: 'owner', login: 'x' }]),
    ).toBe('Інша Людина')
    // порожній реєстр — зламані дані; підпис не має права стати порожнім, тому роль
    expect(ownerName([])).toBe('Керівник')
    // приймальник керівником не вважається, скільки б їх не було
    expect(
      ownerName([{ id: 'u_p1', name: 'Оксана Г.', role: 'operator', pointId: 'p1', login: 'p1' }]),
    ).toBe('Керівник')
  })

  /**
   * Склад реєстру звіряється з ЦИТАТОЮ клієнта, а не з кодом: «на точці Гайове один касир,
   * точка Шипинки два касири, а в Попівцях один касир» (дзвінок №4, ряд. 558). Тому тут
   * числа по точках, а не `length === 7`: сума зійшлася б і при неправильному розподілі.
   */
  it('на Шипинках двоє касирів, на решті активних точок по одному', () => {
    const byPoint = (id: string) =>
      seed.users.filter((u) => u.role === 'operator' && u.pointId === id).length
    expect(byPoint('p1')).toBe(2)
    for (const id of ['p2', 'p3', 'p4', 'p5']) expect(byPoint(id), id).toBe(1)
  })

  /** Два однакових логіни означають, що вхід під одним веде до випадкового з двох записів */
  it('логіни унікальні й непорожні', () => {
    const logins = seed.users.map((u) => u.login)
    expect(logins.filter((l) => !l.trim())).toEqual([])
    expect(new Set(logins).size).toBe(logins.length)
  })

  it('приймальник кожного активного пункту прийому має підпис', () => {
    for (const p of seed.points.filter((x) => x.active && x.kind === 'reception')) {
      expect(signerFor(seed.users, p.id), p.id).toBeTruthy()
    }
  })

  /**
   * НАЙВАЖЛИВІШИЙ тут. `signerFor()` замінив читання `OPERATORS[pointId]` у восьми
   * екранах, і замінив мовчки: підпис під документом — не те поле, розбіжність у якому
   * хтось побачить. Тому звіряємо ПОКЛЮЧОВО, включно з `base` і `all`, які віддають
   * керівника («тільки керівник має до цього всього доступ»).
   */
  it('signerFor() відтворює OPERATORS для КОЖНОГО ключа, включно з base і all', () => {
    for (const [pointId, expected] of Object.entries(OPERATORS)) {
      expect(signerFor(seed.users, pointId), pointId).toBe(expected)
    }
  })

  it('пункт без приймальника віддає undefined, а не чужий підпис', () => {
    const idle = seed.points.find((p) => !OPERATORS[p.id])
    expect(idle, 'у сіді мусить бути хоч один пункт без приймальника').toBeTruthy()
    expect(signerFor(seed.users, idle!.id)).toBeUndefined()
  })
})
