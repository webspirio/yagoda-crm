import { describe, expect, it } from 'vitest'
import { round2, topSuppliers } from './calc'
import type { TopSupplierRow } from './calc'
import { buildSeed, TODAY } from './seed'
import type { Berry, Reception, Supplier } from './types'

/* ------------------------- фікстури ------------------------- */
/*
 * Локальні навмисно: `src/lib/test-fixtures.ts` не створюється і фікстури з `cost.test.ts`
 * не переносяться (див. коментар у `network-average.test.ts`).
 *
 * Прізвища вигадані. Жодного справжнього прізвища клієнта в `src/` немає.
 */

const FROM = '2026-07-01'
const TO = '2026-09-01'

const BERRIES: Berry[] = [
  { id: 'm1', name: 'Малина 1', short: 'М1', product: 'Малина', wholesale: false, from: FROM, to: TO, basePrice: 160 },
  { id: 'm3', name: 'Малина 3', short: 'М3', product: 'Малина', wholesale: false, from: FROM, to: TO, basePrice: 90 },
  { id: 'sm', name: 'Смородина', short: 'См', product: 'Смородина', wholesale: false, from: FROM, to: TO, basePrice: 60 },
]

const SUPPLIERS: Supplier[] = [
  { id: 's1', name: 'Перший П.', village: 'Копайгород', homePointId: 'p1', kind: 'wholesale', createdAt: FROM },
  { id: 's2', name: 'Другий Д.', village: 'Шипинки', homePointId: 'p1', kind: 'farmer', createdAt: FROM },
  { id: 's3', name: 'Аркадій А.', village: 'Гайове', homePointId: 'p3', kind: 'none', createdAt: FROM },
  { id: 's4', name: 'Без квитанцій Б.', village: 'Осламів', homePointId: 'p1', kind: 'none', createdAt: FROM },
  // те саме село, що в s3: без цієї пари тай-брейк ТРЕТЬОГО рівня (прізвище) не покритий
  { id: 's5', name: 'Ярема Я.', village: 'Гайове', homePointId: 'p3', kind: 'none', createdAt: FROM },
]

let seq = 0
function rec(over: {
  supplierId: string
  net: number
  amount: number
  berryId?: string
  pointId?: string
  date?: string
}): Reception {
  seq += 1
  return {
    id: `r${seq}`,
    code: `Ч-${seq}`,
    date: over.date ?? '2026-08-04',
    time: '09:00',
    pointId: over.pointId ?? 'p1',
    supplierId: over.supplierId,
    berryId: over.berryId ?? 'm1',
    gross: over.net,
    pallet: 0,
    tare: [],
    tareWeight: 0,
    net: over.net,
    price: 0,
    bonus: 0,
    amount: over.amount,
    paid: over.amount,
    debt: 0,
    carriedIn: 0,
    operator: 'Оксана Г.',
    synced: true,
  }
}

const run = (receptions: Reception[], from = FROM, to = TO): TopSupplierRow[] =>
  topSuppliers(receptions, SUPPLIERS, BERRIES, from, to)

describe('topSuppliers — здавальники за вагою (M26, Н11)', () => {
  it('сортує за вагою вниз — «з більшого до меншого»', () => {
    const rows = run([
      rec({ supplierId: 's2', net: 100, amount: 16_000 }),
      rec({ supplierId: 's1', net: 400, amount: 64_000 }),
      rec({ supplierId: 's3', net: 250, amount: 40_000 }),
    ])
    expect(rows.map((r) => r.supplierId)).toEqual(['s1', 's3', 's2'])
    expect(rows[0].kgTotal).toBe(400)
    expect(rows[0].amountTotal).toBe(64_000)
    // колонка, яку клієнт просила ПЕРШОЮ
    expect(rows[0].village).toBe('Копайгород')
    expect(rows[0].name).toBe('Перший П.')
  })

  it('складає вагу з РІЗНИХ пунктів: та сама людина везе на дві точки (UC-33 А2)', () => {
    const rows = run([
      rec({ supplierId: 's1', pointId: 'p1', net: 300, amount: 48_000 }),
      rec({ supplierId: 's1', pointId: 'p2', net: 200, amount: 32_000 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].kgTotal).toBe(500)
    expect(rows[0].amountTotal).toBe(80_000)
  })

  it('основний ТОВАР — той, якого привезли найбільше по вазі, а не по грошах', () => {
    const rows = run([
      // малина дорожча, але смородини по вазі більше — колонка про вагу
      rec({ supplierId: 's1', berryId: 'm1', net: 100, amount: 20_000 }),
      rec({ supplierId: 's1', berryId: 'sm', net: 400, amount: 24_000 }),
    ])
    expect(rows[0].topProduct).toBe('Смородина')
  })

  it('два сорти одного товару складаються в ОДИН товар, не в два рядки', () => {
    const rows = run([
      rec({ supplierId: 's1', berryId: 'm1', net: 100, amount: 16_000 }),
      rec({ supplierId: 's1', berryId: 'm3', net: 150, amount: 13_500 }),
      rec({ supplierId: 's1', berryId: 'sm', net: 200, amount: 12_000 }),
    ])
    // 100 + 150 малини = 250 проти 200 смородини: сорт у зведенні не рахується окремо
    expect(rows[0].topProduct).toBe('Малина')
    expect(rows[0].kgTotal).toBe(450)
  })

  it('період фільтрує включно з обома межами', () => {
    const receptions = [
      rec({ supplierId: 's1', date: '2026-06-30', net: 999, amount: 1 }),
      rec({ supplierId: 's2', date: FROM, net: 10, amount: 1_600 }),
      rec({ supplierId: 's3', date: TO, net: 20, amount: 3_200 }),
    ]
    const rows = run(receptions)
    // 30.06 — до початку періоду, і 999 кг у зведення не заходять
    expect(rows.map((r) => r.supplierId)).toEqual(['s3', 's2'])
    // обидві межі включні
    expect(run(receptions, FROM, FROM).map((r) => r.supplierId)).toEqual(['s2'])
    expect(run(receptions, TO, TO).map((r) => r.supplierId)).toEqual(['s3'])
  })

  it('постачальник без квитанцій у періоді не з’являється взагалі — рядка нема', () => {
    const rows = run([rec({ supplierId: 's1', net: 100, amount: 16_000 })])
    expect(rows.map((r) => r.supplierId)).toEqual(['s1'])
    expect(rows.some((r) => r.supplierId === 's4')).toBe(false)
    // порожній період — порожня таблиця, без винятків
    expect(run([], '2026-05-01', '2026-05-31')).toEqual([])
  })

  it('однакова вага: тай-брейк село, далі прізвище — порядок детермінований', () => {
    const rows = run([
      // порядок квитанцій навмисно НЕ той, що очікуваний на виході
      rec({ supplierId: 's2', net: 100, amount: 16_000 }),
      rec({ supplierId: 's5', net: 100, amount: 16_000 }),
      rec({ supplierId: 's1', net: 100, amount: 16_000 }),
      rec({ supplierId: 's3', net: 100, amount: 16_000 }),
    ])
    // усі чотири по 100 кг, тому працює ЛИШЕ тай-брейк: село, далі прізвище.
    // s3 і s5 — з одного села, і саме вони доводять третій рівень
    expect(rows.map((r) => [r.village, r.name])).toEqual([
      ['Гайове', 'Аркадій А.'],
      ['Гайове', 'Ярема Я.'],
      ['Копайгород', 'Перший П.'],
      ['Шипинки', 'Другий Д.'],
    ])
  })

  /**
   * Числа, а не властивості. Було `length > 100` при відомих 193 і цикл монотонності, що
   * просто повторював сортування — такий цикл зелений за будь-якого коректно
   * відсортованого виводу, включно з відсортованим НЕ ТУДИ. Тут прибиті обидва кінці
   * таблиці: мутація «вага ↑» ставить у нульовий рядок 4,28 кг замість 3 603,99.
   */
  it('на демо-даних: 193 рядки, найважчий 3 603,99 кг, найлегший 4,28 кг', () => {
    const seed = buildSeed()
    const rows = topSuppliers(seed.receptions, seed.suppliers, seed.berries, '2026-06-01', TODAY)
    expect(rows).toHaveLength(193)
    expect(rows.map((r) => r.kgTotal).slice(0, 3)).toEqual([3_603.99, 3_576.07, 2_556.01])
    expect(rows[0].amountTotal).toBe(466_179.92)
    expect(rows[0].topProduct).toBe('Малина')
    expect(rows.map((r) => r.kgTotal).slice(-3)).toEqual([5.36, 4.77, 4.28])
    // уся вага сезону, складена по мережі — одне число на всю таблицю
    expect(round2(rows.reduce((a, r) => round2(a + r.kgTotal), 0))).toBe(77_623.23)
    // жодного рядка без села й без прізвища: усі supplierId квитанцій є в довіднику
    expect(rows.every((r) => r.village !== '' && r.name !== '')).toBe(true)
    expect(rows.every((r) => r.topProduct !== '')).toBe(true)
  })

  /**
   * `M-6`: гілки `calc.ts` `village: s?.village ?? ''`, `name: s?.name ?? ''` і
   * `productOf.get(r.berryId) ?? r.berryId` у lcov були непокриті, а `SuppliersPage.tsx`
   * (`OwnerTable`, коментар над рядком) обіцяє їхню поведінку вголос: «постачальника,
   * якого немає в довіднику, рушій усе одно віддає» — і на екрані замість порожньої
   * клітинки друкується «—» (`{r.village || '—'}`).
   *
   * Чому в цьому тесті `topProduct` НЕ порожній рядок. Заявка виправлення просила прибити
   * порожнім і його, але зміряно інше, і рушій тут правий: сорт, якого немає в довіднику,
   * `topSuppliers()` лишає під власним `berryId` (той самий контракт, що в `productDay()`,
   * і він виписаний коментарем у самій функції) — вага не має зникати тому, що хтось
   * прибрав сорт із довідника. Тому правдива перевірка — саме `id` як назва товару.
   * Порожнім `topProduct` не буває взагалі: `top?.[0] ?? ''` недосяжне через публічний
   * API, бо запис у накопичувачі створюється РАЗОМ із записом у `byProduct`, тобто
   * `sort()[0]` завжди є. Це захисне `?? ''`, і тест його не вдає покритим.
   */
  it('невідомий постачальник і невідомий сорт: рядок є, село й прізвище порожні', () => {
    const rows = run([
      // ані в SUPPLIERS, ані в BERRIES такого немає — обидва провали в одній квитанції
      rec({ supplierId: 'ghost', berryId: 'nosuch', net: 42.5, amount: 6_800 }),
      // відомий постачальник, невідомий сорт: перевіряє РІВНО підміну назви товару
      rec({ supplierId: 's1', berryId: 'zzz', net: 10, amount: 1_000 }),
    ])
    const ghost = rows.find((r) => r.supplierId === 'ghost')
    if (!ghost) throw new Error('рядок невідомого постачальника зник — вага не має зникати')
    // головне: вага й гроші на місці, рядок не проковтнутий
    expect(ghost.kgTotal).toBe(42.5)
    expect(ghost.amountTotal).toBe(6_800)
    // саме те, що `OwnerTable` показує як «—»
    expect(ghost.village).toBe('')
    expect(ghost.name).toBe('')
    // назва товару = сам `berryId`, а не порожній рядок і не «undefined»
    expect(ghost.topProduct).toBe('nosuch')

    const known = rows.find((r) => r.supplierId === 's1')
    if (!known) throw new Error('рядок відомого постачальника зник')
    expect([known.village, known.name]).toEqual(['Копайгород', 'Перший П.'])
    expect(known.topProduct).toBe('zzz')
  })
})
