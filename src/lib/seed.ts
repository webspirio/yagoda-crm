import {
  allocateCrateReturn,
  allocatePayout,
  cashStanding,
  crateIssueMode,
  crateRefund,
  crateShipmentDraft,
  openCrateIssues,
  openDebts,
  productDay,
  reconcileDay,
  round2,
  shiftDiscrepancy,
  shiftStatusFor,
  shipmentTotal,
  tareWeight,
  weigh,
} from './calc'
import { addDays, toISO } from './format'
import { SUPPLIER_SEED } from './seed-suppliers'
import type {
  Berry,
  CashCount,
  CashFloat,
  ClockTime,
  CrateAllotment,
  CrateIssue,
  CrateReturn,
  CrateShipment,
  DayExpense,
  ExpensePolicy,
  ISODate,
  Payout,
  Point,
  PriceRecord,
  Reception,
  Reweigh,
  ReweighLine,
  Settings,
  Shift,
  Supplier,
  TareLine,
  TareType,
  Transfer,
} from './types'

/** Deterministic PRNG so the demo looks the same on every laptop. */
function mulberry32(a: number) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const TODAY: ISODate = '2026-08-04'
/** Перший день у їхньому `Прийом товару!A` ✓ PART A — далі 38 торгових днів поспіль до 03.08 */
export const SEASON_START: ISODate = '2026-06-27'
/** Останній повний день історії; 04.08 — 39-й, частковий, «зараз іде» */
const HISTORY_END: ISODate = '2026-08-03'

/**
 * 10 пунктів з їхнього ж випадаючого списку `Data_Import!E` ✓ PART A. p6–p10 — «від 5 до 10».
 *
 * Клієнт назвала три працюючі точки: Гайове, Шипинки, Попівці. Двох назв із сіду —
 * Войнашівка і Міжлісся — вона не називала взагалі. Звузити набір активних до трьох
 * означало б зсунути `rnd()` у циклі прийомки і зламати заморожені анкери сезону, тому
 * p2 і p5 ПЕРЕЙМЕНОВАНІ на села з її ж списку планованих точок («с. Конищів,
 * с. Михайлівці… та інші»), а їхні старі назви переїхали на неактивні p10 і зникли з
 * екрана. `id` не чіпаємо: на них тримається все — від `HOME_POINT_BY_VILLAGE` до анкерів.
 */
export const POINTS: Point[] = [
  { id: 'p1', name: 'Шипинки', village: 'с. Шипинки', kind: 'reception', isMain: true, active: true },
  { id: 'p2', name: 'Конищів', village: 'с. Конищів', kind: 'reception', isMain: false, active: true },
  { id: 'p3', name: 'Гайове', village: 'с. Гайове', kind: 'reception', isMain: false, active: true },
  { id: 'p4', name: 'Попівці', village: 'с. Попівці', kind: 'reception', isMain: false, active: true },
  { id: 'p5', name: 'Михайлівці', village: 'с. Михайлівці', kind: 'reception', isMain: false, active: true },
  { id: 'p6', name: 'Журавлівка', village: 'с. Журавлівка', kind: 'reception', isMain: false, active: false },
  { id: 'p7', name: 'Осламів', village: 'с. Осламів', kind: 'reception', isMain: false, active: false },
  { id: 'p8', name: 'Зоряне', village: 'с. Зоряне', kind: 'reception', isMain: false, active: false },
  { id: 'p9', name: 'Дашківці', village: 'с. Дашківці', kind: 'reception', isMain: false, active: false },
  { id: 'p10', name: 'Войнашівка', village: 'с. Войнашівка', kind: 'reception', isMain: false, active: false },
]

/**
 * Склад/холодильник: місце переважування І пункт прийому з оптовими цінами (M37).
 * Поза `POINTS` навмисно: `activePoints` у `buildSeed()` будується саме з `POINTS`,
 * і розширення того масиву зсунуло б послідовність `rnd()` у циклі прийомки.
 *
 * БЕЗ `export`: назовні база виходить у складі `seed.points`, і жодному екрану окремий
 * літерал не потрібен. Експорт без імпортера `deadcode` показав би як нову знахідку —
 * а поставити її в baseline було б позеленінням через розширення винятку.
 */
const BASE_POINT: Point = {
  id: 'base',
  name: 'Склад',
  village: 'база',
  kind: 'base',
  isMain: false,
  active: true,
}

/**
 * Каса на початок дня, набрана руками в `E1` ✓ PART B; Гайове — зі скриншотів ДОПОМОГА ✓ H6.
 *
 * БЕЗ `export`: єдиний споживач цих двох чисел — наділи каси в кінці цього ж файлу
 * (21 §8.1), а назовні вони виходять уже як `CashFloat`. Доти запис лежав у
 * `baselines/dead-exports.json` як експорт без жодного імпортера; знахідка зникла разом
 * зі словом `export`, і запис прибраний із baseline — це дозволений бік храповика.
 */
const CASH_FLOAT_BY_POINT: Record<string, number> = { p1: 145_453, p3: 50_000 }

/**
 * Товар — верхній рівень, 10 позицій: 9 виміряних ✓ PART A плюс Аронія з дзвінка №4.
 * `Berry.product` посилається на `name`.
 * Кизил не має жодного сорту в переліку сортів — і це реальний глухий кут: тара тягнеться
 * `VLOOKUP` по сорту, ціна теж прив'язана до сорту, тому «Кизил» нікуди не веде ✓ PART A.
 */
export const PRODUCTS: Array<{ id: string; name: string }> = [
  { id: 'pr_malyna', name: 'Малина' },
  { id: 'pr_vyshnia', name: 'Вишня' },
  { id: 'pr_smorodyna', name: 'Смородина' },
  { id: 'pr_porichka', name: 'Порічка' },
  { id: 'pr_ozhyna', name: 'Ожина' },
  { id: 'pr_sunytsia', name: 'Суниця' },
  { id: 'pr_buzyna', name: 'Бузина' },
  { id: 'pr_shypshyna', name: 'Шипшина' },
  { id: 'pr_kyzyl', name: 'Кизил' },
  // Аронія названа клієнтом у дзвінку №4 як позиція цього сезону — новий ТОВАР, і в нього
  // одразу є свій сорт, тому «товар без жодного сорту» лишається рівно один: Кизил
  { id: 'pr_aroniia', name: 'Аронія' },
]

/**
 * Сорт — 18 позицій, і це ключ ціни. Виміряних у файлі клієнта було 17 ✓ PART A;
 * 18-та — Аронія, названа клієнтом у дзвінку №4, у кінці масиву й поза демо-періодом.
 *
 * Верифіковані чотири ціни: Ожина 60 / Ожина ОПТ 65 / Шипшина 35 / Шипшина ОПТ 30 ✓ PART A.
 * Асиметрія навмисна: ОПТ — окремий сорт зі своєю ціною, а не множник і не знижка.
 *
 * ⟡ Решта 13 цін і ВСІ вікна сезону — припущення, звірити з `Data_Import!B/C` профайлером.
 * Числа підібрані так, щоб сезон на Шипинках зійшовся на виміряних 47 441 кг і 5 968 793 ₴
 * (≈125,8 ₴/кг), тобто основний обсяг несе малина ✓ PART A.
 */
export const BERRIES: Berry[] = [
  { id: 'v_mal_v', name: 'Малина ВИЩИЙ сорт', short: 'Мал. ВС', product: 'Малина', wholesale: false, from: '2026-06-27', to: '2026-08-04', basePrice: 140 },
  { id: 'v_mal_1', name: 'Малина 1', short: 'Мал. 1', product: 'Малина', wholesale: false, from: '2026-06-27', to: '2026-08-04', basePrice: 130 },
  { id: 'v_mal_2', name: 'Малина 2', short: 'Мал. 2', product: 'Малина', wholesale: false, from: '2026-06-27', to: '2026-08-04', basePrice: 115 },
  { id: 'v_mal_3', name: 'Малина 3', short: 'Мал. 3', product: 'Малина', wholesale: false, from: '2026-06-27', to: '2026-08-04', basePrice: 95 },
  { id: 'v_sun', name: 'Суниця', short: 'Суниця', product: 'Суниця', wholesale: false, from: '2026-06-27', to: '2026-07-10', basePrice: 90 },
  { id: 'v_vysh', name: 'Вишня', short: 'Вишня', product: 'Вишня', wholesale: false, from: '2026-06-27', to: '2026-07-20', basePrice: 35 },
  { id: 'v_vysh_o', name: 'Вишня ОПТ', short: 'Вишня ОПТ', product: 'Вишня', wholesale: true, retired: true, from: '2026-06-27', to: '2026-07-20', basePrice: 32 },
  // Сезон продовжений 28.07 → 04.08 навмисно (09 §8.1 п.5): канонічний день собівартості
  // тримається на трьох товарах, і Порічки без цього на 04.08 немає ні в цінах, ні в прийомці.
  // ОПТ-сорт `v_por_o` лишається як був — канонічному дню він не потрібен.
  { id: 'v_por', name: 'Порічка', short: 'Порічка', product: 'Порічка', wholesale: false, from: '2026-07-05', to: '2026-08-04', basePrice: 50 },
  { id: 'v_por_o', name: 'Порічка ОПТ', short: 'Порічка ОПТ', product: 'Порічка', wholesale: true, retired: true, from: '2026-07-05', to: '2026-07-28', basePrice: 48 },
  { id: 'v_smor', name: 'Смородина', short: 'Смородина', product: 'Смородина', wholesale: false, from: '2026-07-05', to: '2026-08-04', basePrice: 45 },
  { id: 'v_smor_o', name: 'Смородина ОПТ', short: 'Смород. ОПТ', product: 'Смородина', wholesale: true, retired: true, from: '2026-07-05', to: '2026-08-04', basePrice: 42 },
  { id: 'v_ozh', name: 'Ожина', short: 'Ожина', product: 'Ожина', wholesale: false, from: '2026-07-22', to: '2026-08-04', basePrice: 60 },
  { id: 'v_ozh_o', name: 'Ожина ОПТ', short: 'Ожина ОПТ', product: 'Ожина', wholesale: true, retired: true, from: '2026-07-22', to: '2026-08-04', basePrice: 65 },
  { id: 'v_buz', name: 'Бузина', short: 'Бузина', product: 'Бузина', wholesale: false, from: '2026-07-25', to: '2026-08-04', basePrice: 25 },
  { id: 'v_buz_o', name: 'Бузина ОПТ', short: 'Бузина ОПТ', product: 'Бузина', wholesale: true, retired: true, from: '2026-07-25', to: '2026-08-04', basePrice: 22 },
  { id: 'v_shyp', name: 'Шипшина', short: 'Шипшина', product: 'Шипшина', wholesale: false, from: '2026-08-01', to: '2026-08-04', basePrice: 35 },
  { id: 'v_shyp_o', name: 'Шипшина ОПТ', short: 'Шипш. ОПТ', product: 'Шипшина', wholesale: true, retired: true, from: '2026-08-01', to: '2026-08-04', basePrice: 30 },
  // Аронія названа клієнтом у дзвінку №4 як позиція цього сезону. Вікно — ПІСЛЯ TODAY:
  // цикл цін відсіює її раніше, ніж викличе rnd(), тому сезонні анкери не рухаються
  { id: 'v_aron', name: 'Аронія', short: 'Аронія', product: 'Аронія', wholesale: false, retired: false, from: '2026-08-20', to: '2026-10-15', basePrice: 28 },
]

/**
 * День, з якого ведеться касова книга демо (`21 §8.1`). Свідоме звуження: подій каси за
 * всі 39 днів було б 200+, а доводять вони рівно те саме, що й за сім.
 *
 * ЕКСПОРТУЄТЬСЯ, бо `store.ts` передає це саме число в `cashStanding({ openedOn })`. Поки
 * примірників було два, вони мали шанс розійтися мовчки — і тоді екран каси показував би
 * інший залишок, ніж той, з якого зроблено `CashCount` у сіді.
 */
export const CASH_BOOK_FROM: ISODate = '2026-07-29'

/** `Data_Import!G/H/I` ✓ PART A. Чешка стоїть у 1 701 з 1 701 рядка ✓ H5 */
export const TARE_TYPES: TareType[] = [
  { id: 'tr_cheshka', name: 'Чешка', weight: 1.2, price: 120 },
  { id: 'tr_lubianka', name: 'Лубʼянка', weight: 0.3, price: 50 },
  { id: 'tr_mishok', name: 'Мішок', weight: 0.1, price: 10 },
  { id: 'tr_yashchyk', name: 'Ящик', weight: 2.0, price: 20 },
]

/** «в нас другий тари немає» ✓ PART A — у прийомках сіду інших тар немає взагалі */
export const DEFAULT_TARE_ID = 'tr_cheshka'

/**
 * Межі дод. ціни, названі клієнтом на дзвінку №4: «30 - це максимум» (ряд. 701).
 * Верхня межа саме 30, а не 25: +30 реально трапляється на другому пункті ✓ PART B.
 * Мінус реальний і теж до −30: «поки довезла, то вже свила, то ми закрили мінус 30» (729).
 * Керівник змінює межу сам — на горіхах ціна може стрибнути на 100 ₴ (714–716).
 */
export const DEFAULT_SETTINGS: Settings = { surchargeMin: -30, surchargeMax: 30 }

/** Ціну виставляє керівник: «Я виставляю ціну для всіх» ✓ M6 */
export const OWNER = 'Керівник'

/**
 * Псевдоніми приймальників — по одному на активний пункт. Публічний білд не показує
 * жодного справжнього імені, тому власниця в журналах фігурує як «Керівник» (§1.0).
 */
export const OPERATORS: Record<string, string> = {
  p1: 'Оксана Г.',
  p2: 'Тарас Б.',
  p3: 'Ігор В.',
  p4: 'Богдан Р.',
  p5: 'Леся М.',
  // переважування й прийомку на складі робить керівник: «тільки керівник має до цього
  // всього доступ» (дзвінок №4, ряд. 617–621) — окремого «приймальника бази» немає
  base: OWNER,
  all: OWNER,
}

/* ------------------------- обсяги: демо важить стільки, скільки їхній сезон ------------------------- */

/**
 * Рядків на день, Шипинки, 27.06–03.08: 38 днів, сума 1 701, середнє 44,8, максимум 78 ✓ PART A, H10.
 * 15.07 стоїть 69 — піковий день по грошах ✓ H10, і це НЕ день максимуму рядків.
 */
const P1_DAY_LINES = [
  18, 20, 23, 25,
  27, 30, 33, 35, 38, 40, 43,
  45, 47, 50, 52, 55, 58, 62,
  69, 72, 78, 74, 70, 66, 62,
  58, 54, 50, 46, 43, 40, 37,
  34, 32, 30, 30, 28, 27,
]

/** Кг на рядок по днях — липнева палетна хвиля, а не рівна поличка */
const P1_KG_PER_LINE = [
  13, 14, 15, 16,
  18, 19, 21, 22, 24, 26, 28,
  30, 33, 36, 38, 41, 44, 47,
  49, 47, 45, 43, 41, 39, 37,
  35, 33, 31, 29, 28, 26, 25,
  24, 23, 22, 21, 20, 19,
]

const P1_SEASON_KG = 47_441 // ✓ PART A
const P1_PEAK_DAY: ISODate = '2026-07-15' // ✓ H10: 69 рядків, 3 374,3 кг, 479 267 ₴ готівкою
const P1_PEAK_KG = 3_374.3
/** 04.08 — 39-й день, частковий: працюють, поки ми дивимось на екран */
const P1_TODAY_LINES = 18

/** Σ відкритого залишку на TODAY ✓ PART A, H5 — те саме число, що в їхній колонці `O` */
const P1_OPEN_DEBT = 1_273_518

/** Другий пункт (аркуш `average`): 184 рядки за 01–04.08 ✓ PART A, H9 — 05.08 ще не настало */
const P2_DAY_LINES: Record<string, number> = {
  '2026-08-01': 56,
  '2026-08-02': 57,
  '2026-08-03': 47,
  '2026-08-04': 24,
}
/**
 * Кілограми другого пункту — єдине місце, де ми свідомо відступаємо від виміряного числа.
 * Їхні три цифри несумісні з цим прайсом: 184 рядки / 6 930 кг / Сума 1 012 883 ₴ ✓ H9 —
 * це 146,2 ₴/кг, тобто ДОРОЖЧЕ за найдорожчий сорт у списку (Малина ВИЩИЙ 140). Тримаємо
 * гроші — Сума ≈1 012 883 ₴ і БОРГ 855 676 ₴, — а кілограми відпускаємо на +12 %: інакше
 * пункт мусив би за чотири дні видати 16 000 ₴ готівки на 184 прийомки, і це на екрані
 * читалось би як зламане. ⟡ Знімається одним поглядом у `Data_Import!B`.
 */
const P2_SEASON_KG = 7_800
const P2_OPEN_DEBT = 855_676

/** ✓ H9/S16: один постачальник другого пункту винен 129 278 ₴ — він ще не забирав гроші */
const P2_TOP_DEBT_NAME = 'Савчук Дарія Богданівна'
const P2_TOP_DEBT_UAH = 129_278

/**
 * Малі пункти — «щойно розгорнуті», 6–10 рядків/день ✓ docs/05 §1.5. p5 тримаємо
 * мінімумом мережі: «Зведення» має показувати асиметрію, а не чотири однакові стовпчики.
 * Кілограми теж нормалізуємо — без денної цілі важкий ОПТ-постачальник із загального мішка
 * тягнув на Попівці 45 кг/рядок проти 27,9 на Шипинках, і придорожній пункт на 8 рядків
 * важив утричі більше за сусідній.
 */
const SMALL_POINT_LINES: Record<string, [number, number]> = {
  p3: [7, 10],
  p4: [7, 10],
  p5: [6, 8],
}
/** Кг на рядок — частка від денного середнього Шипинок, тобто та сама липнева хвиля */
const SMALL_POINT_KG_FACTOR: Record<string, number> = { p3: 0.95, p4: 1, p5: 0.7 }

/**
 * Частка відкритого залишку від нарахованого: на Шипинках це 1 273 518 / 5 968 793 = 21,3 %
 * ✓ PART A. Малі пункти доводимо до тієї самої частки — інакше борг пункту залежить від того,
 * кого мішок випадково витягнув, і Попівці виходили в 23 рази важчими за p5.
 */
const SMALL_OPEN_SHARE = P1_OPEN_DEBT / 5_968_793

/**
 * Дод. ціна +26…+30 — рівно те, чим виправданий кап 30, а не 25: «+30 реально трапляється
 * на другому пункті» ✓ M7, PART B, docs/05 §1.5 S13. П'ять рядків, усі на p2 (Конищів).
 */
const P2_HIGH_BONUS = [26, 30, 27, 30, 28]

/**
 * Найбільший рядок сезону ✓ PART A: 701,5 кг брутто, 115 ящиків, ≈81 525 ₴, з Піддоном.
 * Сорт бриф не називає, і ОПТ тут арифметично неможливий: 115 Чешок — це 138 кг тари,
 * тобто нетто 544,2 кг, а 81 525 ₴ на 544,2 кг = 149,8 ₴/кг — вище за будь-який ОПТ-сорт
 * (максимум Ожина ОПТ 65). Тому беремо Малину ВИЩИЙ за ціною дня, а різницю до 150 ₴/кг
 * добирає Дод. ціна — рівно той механізм, який описує M6. Виходить 81 630 ₴, 0,13 % вище.
 */
const EXTREME_GROSS = 701.5
const EXTREME_CRATES = 115
const EXTREME_PALLET = 19.3
const EXTREME_UAH = 81_525
/** І поруч, того ж дня, рядок на 3 кг: один ящик, без Піддона, без Дод. ціни ✓ PART A, S12 */
const GRANNY_NET = 3

/** Піддон: 1 рядок тут, 6 на другому пункті, значення 6 і 13,9–19,3 кг ✓ PART B */
const P2_PALLETS = [13.9, 19.3, 6, 17.2, 15.4, 18.6]

/**
 * Частка рядків по сортах — окремо для ОПТ-постачальника і для решти.
 * ⟡ Реальний мікс треба виміряти по `Прийом товару!C`; поки він виведений з арифметики:
 * при цих 13 ⟡ цінах сезон на 47 441 кг дає 5 968 793 ₴ (125,8 ₴/кг ✓ PART A) тільки якщо
 * майже весь обсяг — малина, і вона зсунута до вищих сортів. Решта 13 сортів лишається
 * рідкою — рівні стовпчики на «Зведенні» читались би як макет.
 */
const MIX_WHOLESALE: Record<string, number> = {
  v_mal_v: 38, v_mal_1: 30, v_mal_2: 10, v_mal_3: 4,
  v_sun: 0.6, v_vysh: 0.5, v_por: 0.5, v_smor: 0.6, v_ozh: 0.6, v_buz: 0.4, v_shyp: 0.4,
  v_vysh_o: 1.2, v_por_o: 1.2, v_smor_o: 1.6, v_ozh_o: 1.6, v_buz_o: 2, v_shyp_o: 2.5,
}
const MIX_RETAIL: Record<string, number> = {
  v_mal_v: 20, v_mal_1: 33, v_mal_2: 22, v_mal_3: 7,
  v_sun: 4, v_vysh: 3, v_por: 2.5, v_smor: 3, v_ozh: 2.5, v_buz: 1.5, v_shyp: 1,
  // ОПТ-сорти сюди не доходять: їх відсіює сам постачальник, не мікс
  v_vysh_o: 0, v_por_o: 0, v_smor_o: 0, v_ozh_o: 0, v_buz_o: 0, v_shyp_o: 0,
}
/**
 * Другий пункт у серпні — майже виключно малина вищих сортів. Це не смак, це арифметика їхніх
 * же чисел: 184 рядки, 6 930 кг, Сума 1 012 883 ₴ ✓ H9 = 146,2 ₴/кг, тобто ВИЩЕ за будь-який
 * сорт у прайсі. Тримаємо рядки й гроші, а середню ціну підводимо міксом настільки,
 * наскільки прайс дозволяє. ⟡ Справжня ціна малини — з `Data_Import!B`.
 */
const MIX_P2: Record<string, number> = {
  v_mal_v: 52, v_mal_1: 34, v_mal_2: 8, v_mal_3: 3,
  v_sun: 0.4, v_vysh: 0.4, v_por: 0.4, v_smor: 1, v_ozh: 1, v_buz: 0.4, v_shyp: 0.4,
  v_vysh_o: 0.3, v_por_o: 0.3, v_smor_o: 0.5, v_ozh_o: 0.5, v_buz_o: 0.3, v_shyp_o: 0.3,
}

/** Дод. ціна — 193 рядки з 1 701 (11 %), спостережений діапазон −15…+25 ✓ PART B, M7, G2 */
const BONUS_SHARE = 0.11
const BONUS_VALUES = [5, 5, 5, 10, 10, 3, 8, 15, 20, 25, -5, -10, -15, 12, 2]

/** Готівка на місці проти залишку. Тонка каса пункту — це і є «скільки я должен» з M2 */
interface PayProfile {
  full: number
  toHundred: number
  low: number
  high: number
}
const PAY_PROFILE: Record<string, PayProfile> = {
  // Σ відкритого залишку на Шипинках має вийти на 1 273 518 ₴ ✓ PART A, H5 — а це означає,
  // що готівкою на місці йде ~56 % нарахованого, решта лягає в залишок і гаситься частково.
  // Їхнє «Виплачено» 5 973 595 ₴ ≈ «Нараховано» 5 968 793 ₴ І при цьому Залишок 1 273 518 ₴
  // одночасно неможливі в чесному реєстрі — саме тому §2.3 і каже, що ця колонка не сальдо.
  p1: { full: 0.09, toHundred: 0.11, low: 0.1, high: 0.6 },
  // Другий пункт щойно в роботі: каса тонка (50 000 ₴ на пункті іншого масштабу ✓ H6 проти
  // 145 453 ₴ на Шипинках), тому гроші забирають пізніше — звідси БОРГ 855 676 ₴ ✓ H9
  p2: { full: 0.05, toHundred: 0.05, low: 0.15, high: 0.45 },
  p3: { full: 0.45, toHundred: 0.2, low: 0.2, high: 0.8 },
  p4: { full: 0.45, toHundred: 0.2, low: 0.2, high: 0.8 },
  p5: { full: 0.5, toHundred: 0.2, low: 0.2, high: 0.8 },
}

/** Село постачальника визначає його домашній пункт; варіанти написання ведуть на той самий */
const HOME_POINT_BY_VILLAGE: Record<string, string> = {
  копайгород: 'p1',
  копай: 'p1',
  шипинки: 'p1',
  войнашівка: 'p2',
  шевченкове: 'p2',
  шивченкове: 'p2',
  гайове: 'p3',
  обухів: 'p3',
  обухов: 'p3',
  попівці: 'p4',
  міжлісся: 'p5',
}

/** Один постачальник здає на два пункти — саме тому мітка пункту у файлі ненадійна ✓ PART C 9 */
const POOL_SPILL: Record<string, number> = { p1: 0.04, p2: 0.7, p3: 0.1, p4: 0.1, p5: 0.1 }

const PRICE_REASONS = [
  'Підняли — сусіди дають більше',
  'Знизили — багато мʼякої ягоди',
  'Ціна від переробника з обіду',
  'Підняли — мало привозять',
  'Знизили — брак у партії',
]

function pad(n: number, w = 4) {
  return String(n).padStart(w, '0')
}

export interface SeedData {
  points: Point[]
  berries: Berry[]
  tareTypes: TareType[]
  suppliers: Supplier[]
  prices: PriceRecord[]
  receptions: Reception[]
  payouts: Payout[]
  reweighs: Reweigh[]
  expenses: DayExpense[]
  policies: ExpensePolicy[]
  /* ---- ящики і каса як підзвіт (21 §2.8): вісім ключів, назви — з контракту ---- */
  crateAllotments: CrateAllotment[]
  cashFloats: CashFloat[]
  crateIssues: CrateIssue[]
  crateReturns: CrateReturn[]
  crateShipments: CrateShipment[]
  transfers: Transfer[]
  shifts: Shift[]
  cashCounts: CashCount[]
}

/** Рядок у роботі — до нього ще не приклеєні id, code і час сортування */
interface Slot {
  supplier: Supplier
  berry: Berry
  visitId: string
  time: string
  /** відносна вага в кілограмах дня; нормалізується під денну ціль */
  share: number
  /** нетто в обхід нормалізації — для двох країв масштабу і для боржника другого пункту */
  fixedNet?: number
  /** цільова сума рядка: Дод. ціна добирає різницю до неї від ціни дня */
  targetUah?: number
  crates?: number
  pallet: number
  bonus: number
}

export function buildSeed(): SeedData {
  const rnd = mulberry32(20260804)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const between = (a: number, b: number) => a + rnd() * (b - a)
  const int = (a: number, b: number) => Math.floor(between(a, b + 1))

  const activePoints = POINTS.filter((p) => p.active)

  /* ---------------- suppliers ---------------- */
  // ПІБ і села — із замороженого літерала; телефон відсутній у 208 з 208 ✓ PART C 7, H5
  const suppliers: Supplier[] = SUPPLIER_SEED.map((s, i) => ({
    id: `s${i + 1}`,
    name: s.name,
    village: s.village,
    homePointId: HOME_POINT_BY_VILLAGE[s.village.trim().toLowerCase()] ?? 'p1',
    // ОПТ беремо з замороженого літерала `seed-suppliers.ts` — 208 рядків із
    // `wholesale: boolean` лишаються джерелом істини, правити їх руками означало б
    // 208 шансів на описку. Фермерів розставляємо детерміновано кожним десятим із
    // решти — 18 карток, щоб екран маркерів мав що показувати (M24)
    kind: s.wholesale ? 'wholesale' : i % 10 === 0 ? 'farmer' : 'none',
    note: s.note,
    createdAt: SEASON_START,
  }))
  const weightOf = new Map(suppliers.map((s, i) => [s.id, SUPPLIER_SEED[i].weight]))

  /* ---------------- days ---------------- */
  const days: ISODate[] = []
  for (let d = SEASON_START; d <= TODAY; d = addDays(d, 1)) days.push(d)

  /* ---------------- ціна дня: одна центральна, з журналом ---------------- */
  // Ключем лишається (date, pointId, сорт) — запис однаковий на всіх активних пунктах.
  // Дрейфу «шумом» більше немає: ціна стоїть кілька днів і рухається сходинкою з причиною ✓ M6.
  const prices: PriceRecord[] = []
  const priceSteps = new Map<string, { time: string; price: number }[]>()
  const offset = new Map<string, number>()
  let priceSeq = 0

  for (const day of days) {
    for (const berry of BERRIES) {
      if (day < berry.from || day > berry.to) continue
      // на останній день вікна (і на TODAY) ціна дорівнює довідниковій — саме ці числа
      // клієнт побачить на «Цінах дня», і чотири з них верифіковані
      const pinned = day === TODAY || day === berry.to
      // сходинка й коридор — у відсотках від ціни самого сорту, інакше бузина за 22 ₴
      // ходила б тими самими п'ятірками, що малина за 140
      const stepSize = Math.max(1, Math.round(berry.basePrice * 0.04))
      const span = Math.max(2, Math.round(berry.basePrice * 0.1))
      let off = offset.get(berry.id) ?? 0
      if (pinned) off = 0
      else if (rnd() < 0.28) {
        off = Math.max(-span, Math.min(span, off + stepSize * pick([1, 1, -1, 2, -2])))
      }
      offset.set(berry.id, off)

      const steps = [{ time: '07:30', price: Math.max(1, Math.round(berry.basePrice + off)) }]
      // 64 зі 175 комбінацій (дата, сорт) реально мали більш ніж одну ціну на день ✓ PART C 16.
      // В Excel це дефект, тут — журнал: прийомки до зміни рахуються за старою ціною.
      if (!pinned && rnd() < 0.37) {
        const corrections = rnd() < 0.25 ? 2 : 1
        for (let c = 0; c < corrections; c++) {
          const bump = stepSize * pick([1, 1, -1, 2])
          steps.push({
            time: c === 0 ? pick(['11:20', '12:40', '13:15']) : pick(['15:30', '16:10']),
            price: Math.max(1, steps[steps.length - 1].price + bump),
          })
        }
      }
      priceSteps.set(`${day}|${berry.id}`, steps)

      for (const step of steps) {
        for (const point of activePoints) {
          prices.push({
            id: `pr${++priceSeq}`,
            date: day,
            pointId: point.id,
            berryId: berry.id,
            price: step.price,
            time: step.time,
            author: OWNER,
            reason: step.time === '07:30' ? undefined : pick(PRICE_REASONS),
          })
        }
      }
    }
  }

  const priceAt = (date: ISODate, berryId: string, time: string) => {
    const steps = priceSteps.get(`${date}|${berryId}`)
    if (!steps) return undefined
    let price = steps[0].price
    for (const s of steps) if (s.time <= time) price = s.price
    return price
  }

  /* ---------------- пул постачальників на пункт ---------------- */
  const pools = new Map<string, Supplier[]>()
  const bags = new Map<string, Supplier[]>()
  for (const point of activePoints) {
    const pool = suppliers.filter(
      (s) => s.homePointId === point.id || rnd() < POOL_SPILL[point.id],
    )
    pools.set(point.id, pool)
    // мішок із повторами: важкий ОПТ лежить у ньому 27 разів, бабуся — один
    const bag: Supplier[] = []
    for (const s of pool) {
      const w = weightOf.get(s.id) ?? 1
      for (let i = 0; i < w; i++) bag.push(s)
    }
    bags.set(point.id, bag)
  }

  /* ---------------- денні цілі ---------------- */
  const p1Kg = (() => {
    const raw = P1_DAY_LINES.map((n, i) => n * P1_KG_PER_LINE[i])
    const k = P1_SEASON_KG / raw.reduce((a, b) => a + b, 0)
    const scaled = raw.map((v) => v * k)
    const peak = days.indexOf(P1_PEAK_DAY)
    const delta = P1_PEAK_KG - scaled[peak]
    const rest = P1_SEASON_KG - scaled[peak]
    return scaled.map((v, i) => (i === peak ? P1_PEAK_KG : (v * (rest - delta)) / rest))
  })()

  const p2Lines = Object.values(P2_DAY_LINES).reduce((a, b) => a + b, 0)

  const lineTarget = (pointId: string, dayIndex: number, day: ISODate) => {
    if (pointId === 'p1') return day === TODAY ? P1_TODAY_LINES : P1_DAY_LINES[dayIndex]
    if (pointId === 'p2') return P2_DAY_LINES[day] ?? 0
    // «щойно розгорнуті» пункти — 6–10 рядків на день, щоб мережа читалась асиметрично,
    // і p5 у цій вилці найнижче ✓ docs/05 §1.5
    const [lo, hi] = SMALL_POINT_LINES[pointId]
    return day === TODAY ? int(Math.round(lo / 2), Math.round(hi / 2)) : int(lo, hi)
  }

  /** Денне середнє кг/рядок на Шипинках — від нього живуть малі пункти */
  const p1KgPerLine = (dayIndex: number) => {
    const i = Math.min(dayIndex, P1_DAY_LINES.length - 1)
    return p1Kg[i] / P1_DAY_LINES[i]
  }

  const kgTarget = (pointId: string, dayIndex: number, day: ISODate, lines: number) => {
    if (pointId === 'p1') return day === TODAY ? undefined : p1Kg[dayIndex]
    if (pointId === 'p2') return (P2_SEASON_KG * lines) / p2Lines
    return lines * p1KgPerLine(dayIndex) * SMALL_POINT_KG_FACTOR[pointId]
  }

  /* ---------------- receptions ---------------- */
  const receptions: Reception[] = []
  const visits: { id: string; date: ISODate; pointId: string; supplierId: string }[] = []
  let visitSeq = 0
  let palletsUsed = 0
  let highBonusUsed = 0
  let topDebtAccrued = 0
  const topDebtSupplier = suppliers.find((s) => s.name === P2_TOP_DEBT_NAME)

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex]
    const isToday = day === TODAY
    const seenToday = new Set<string>()

    for (const point of activePoints) {
      const target = lineTarget(point.id, dayIndex, day)
      if (target <= 0) continue
      const bag = bags.get(point.id)!
      if (!bag.length) continue
      const profile = PAY_PROFILE[point.id]
      const slots: Slot[] = []

      /* --- боржник другого пункту приїжджає щодня і щоразу лишає все за нами --- */
      if (point.id === 'p2' && topDebtSupplier) {
        const berry = BERRIES[0]
        const time = `${pad(int(7, 9), 2)}:${pad(int(0, 59), 2)}`
        const price = priceAt(day, berry.id, time) ?? berry.basePrice
        // останній день добирає рівно те, чого не хватає до 129 278 ₴ ✓ H9
        const net = isToday
          ? round2(Math.max(20, (P2_TOP_DEBT_UAH - topDebtAccrued) / (price + 5)))
          : 210
        topDebtAccrued = round2(topDebtAccrued + net * (price + 5))
        seenToday.add(topDebtSupplier.id)
        const visitId = `v${++visitSeq}`
        visits.push({ id: visitId, date: day, pointId: point.id, supplierId: topDebtSupplier.id })
        slots.push({
          supplier: topDebtSupplier,
          berry,
          visitId,
          time,
          share: 0,
          fixedNet: net,
          pallet: 0,
          bonus: 5,
        })
      }

      /* --- візити: 1 постачальник, 1–5 рядків, один «Разом» ✓ M5 --- */
      while (slots.length < target) {
        let candidate: Supplier | undefined
        for (let attempt = 0; attempt < 40 && !candidate; attempt++) {
          const draw = bag[Math.floor(rnd() * bag.length)]
          if (!seenToday.has(draw.id)) candidate = draw
        }
        // важкі постачальники займають мішок, тому в кінці дня добираємо з пулу напряму
        const supplier = candidate ?? pools.get(point.id)!.find((s) => !seenToday.has(s.id))
        if (!supplier) break
        seenToday.add(supplier.id)

        // ОПТ-сорт може взяти тільки ОПТ-постачальник
        const inSeason = BERRIES.filter(
          (b) => day >= b.from && day <= b.to && (!b.wholesale || supplier.kind === 'wholesale'),
        )
        if (!inSeason.length) break

        // 284 з 1 369 візитів мультирядкові (20,8 %), максимум 5 рядків ✓ PART C 15, H5
        const roll = rnd()
        const want =
          roll < 0.79 ? 1 : roll < 0.952 ? 2 : roll < 0.982 ? 3 : roll < 0.994 ? 4 : 5
        const lines = Math.min(want, inSeason.length, target - slots.length)

        const hour = isToday ? int(7, 11) : int(7, 18)
        const time = `${pad(hour, 2)}:${pad(int(0, 59), 2)}`
        const visitId = `v${++visitSeq}`
        visits.push({ id: visitId, date: day, pointId: point.id, supplierId: supplier.id })

        const w = weightOf.get(supplier.id) ?? 1
        const mix =
          point.id === 'p2' ? MIX_P2
          : supplier.kind === 'wholesale' ? MIX_WHOLESALE
          : MIX_RETAIL
        const left = [...inSeason]
        for (let l = 0; l < lines; l++) {
          // рядки одного візиту — різні сорти: «маліна є трьох сортів» ✓ PART A
          let total = 0
          for (const b of left) total += mix[b.id]
          let roll2 = rnd() * total
          let index = left.length - 1
          for (let i = 0; i < left.length; i++) {
            roll2 -= mix[left[i].id]
            if (roll2 <= 0) {
              index = i
              break
            }
          }
          const berry = left.splice(index, 1)[0]
          slots.push({
            supplier,
            berry,
            visitId,
            time,
            share:
              w >= 20 ? between(60, 200)
              : w >= 13 ? between(30, 90)
              : w >= 8 ? between(12, 38)
              : w >= 4 ? between(7, 22)
              : between(3, 12),
            pallet: 0,
            bonus: rnd() < BONUS_SHARE ? pick(BONUS_VALUES) : 0,
          })
        }
      }
      if (!slots.length) continue

      /* --- два краї масштабу, в один день і в один журнал ✓ S12 --- */
      if (point.id === 'p1' && day === P1_PEAK_DAY) {
        const big =
          slots.find(
            (s) => s.supplier.kind === 'wholesale' && (weightOf.get(s.supplier.id) ?? 0) >= 20,
          ) ??
          slots[0]
        big.berry = BERRIES[0]
        big.crates = EXTREME_CRATES
        big.pallet = EXTREME_PALLET
        big.fixedNet = round2(
          EXTREME_GROSS - EXTREME_PALLET - EXTREME_CRATES * TARE_TYPES[0].weight,
        )
        big.targetUah = EXTREME_UAH
        const small = slots.find((s) => (weightOf.get(s.supplier.id) ?? 9) <= 3 && !s.fixedNet)
        if (small) {
          small.crates = 1
          small.bonus = 0
          small.fixedNet = GRANNY_NET
        }
      }

      /* --- Піддон: найважчі ОПТ-рядки дня, 6 рядків на другому пункті ✓ PART B --- */
      if (point.id === 'p2' && palletsUsed < P2_PALLETS.length) {
        const optInSeason = BERRIES.filter((b) => b.wholesale && day >= b.from && day <= b.to)
        const candidates = slots
          .filter((s) => s.supplier.kind === 'wholesale' && !s.fixedNet)
          .sort((a, b) => b.share - a.share)
        const perDay = day === HISTORY_END ? 1 : 2
        for (let i = 0; i < Math.min(perDay, candidates.length); i++) {
          if (palletsUsed >= P2_PALLETS.length) break
          if (!candidates[i].berry.wholesale && optInSeason.length) {
            candidates[i].berry = optInSeason[palletsUsed % optInSeason.length]
          }
          candidates[i].pallet = P2_PALLETS[palletsUsed++]
        }
      }

      /* --- Дод. ціна +26…+30: те саме, чим виправданий кап 30 ✓ M7, S13 --- */
      // Тільки другий пункт: на «Тарі і сортах» кап 30 має спиратись на реальні рядки, інакше
      // власниця бачить межу, під якою в даних немає нічого вище +25.
      if (point.id === 'p2' && highBonusUsed < P2_HIGH_BONUS.length) {
        let takenToday = 0
        for (const slot of slots) {
          if (highBonusUsed >= P2_HIGH_BONUS.length || takenToday >= 2) break
          if (slot.fixedNet || slot.targetUah || slot.bonus !== 0) continue
          slot.bonus = P2_HIGH_BONUS[highBonusUsed++]
          takenToday++
        }
      }

      /* --- нормалізація під денну ціль по кілограмах --- */
      const fixedKg = slots.reduce((s, x) => s + (x.fixedNet ?? 0), 0)
      const shareSum = slots.reduce((s, x) => s + (x.fixedNet ? 0 : x.share), 0)
      const goal = kgTarget(point.id, dayIndex, day, slots.length)
      const k = goal && shareSum > 0 ? Math.max(0, goal - fixedKg) / shareSum : 1

      for (const slot of slots) {
        const net = slot.fixedNet ?? round2(Math.max(GRANNY_NET, slot.share * k))
        const crates = slot.crates ?? Math.max(1, Math.round(net / between(3.6, 6.2)))
        const tare: TareLine[] = [{ tareId: DEFAULT_TARE_ID, count: crates }]
        const tw = tareWeight(tare, TARE_TYPES)
        const gross = round2(net + slot.pallet + tw)
        const price = priceAt(day, slot.berry.id, slot.time) ?? slot.berry.basePrice
        // Дод. ціна на найбільшому рядку не вигадана, а виведена: 81 525 ₴ / 544,2 кг = 150 ₴/кг,
        // тобто ціна дня плюс надбавка — рівно той механізм, який описує M6/M7
        const bonus = slot.targetUah
          ? Math.max(
              DEFAULT_SETTINGS.surchargeMin,
              Math.min(
                DEFAULT_SETTINGS.surchargeMax,
                Math.round(slot.targetUah / (slot.fixedNet ?? net)) - price,
              ),
            )
          : slot.bonus
        const w = weigh({ gross, pallet: slot.pallet, tare, price, bonus }, TARE_TYPES)
        receptions.push({
          id: '',
          code: '',
          date: day,
          time: slot.time,
          pointId: point.id,
          supplierId: slot.supplier.id,
          berryId: slot.berry.id,
          gross: w.gross,
          pallet: w.pallet,
          tare,
          tareWeight: w.tareWeight,
          net: w.net,
          price,
          bonus,
          amount: w.amount,
          paid: 0,
          debt: w.amount,
          carriedIn: 0,
          visitId: slot.visitId,
          operator: OPERATORS[point.id],
          synced: true,
        })
      }

      /* --- одна виплата на візит: «Разом» рахується по всіх рядках ✓ M5, M10 --- */
      const created = receptions.slice(receptions.length - slots.length)
      const byVisit = new Map<string, Reception[]>()
      for (const r of created) {
        const list = byVisit.get(r.visitId!) ?? []
        list.push(r)
        byVisit.set(r.visitId!, list)
      }
      for (const lines of byVisit.values()) {
        const accrued = round2(lines.reduce((s, r) => s + r.amount, 0))
        // боржник другого пункту готівки не бере взагалі — але САМЕ на другому пункті:
        // без цієї перевірки він не брав готівки ніде, і одна людина тримала 26 % боргу
        // всієї мережі (795 245 ₴), чого ground truth не каже ніде ✓ H9/S16
        const zero =
          point.id === 'p2' && topDebtSupplier && lines[0].supplierId === topDebtSupplier.id
        const roll = rnd()
        let paid = accrued
        if (zero) paid = 0
        else if (day === P1_PEAK_DAY && point.id === 'p1' && roll < 0.8) paid = accrued
        else if (roll < profile.full) paid = accrued
        else if (roll < profile.full + profile.toHundred) paid = Math.floor(accrued / 100) * 100
        else paid = round2(Math.round((accrued * between(profile.low, profile.high)) / 10) * 10)
        if (paid < 0) paid = 0

        let left = round2(paid)
        for (const r of lines) {
          const take = round2(Math.max(0, Math.min(left, r.amount)))
          left = round2(left - take)
          r.paid = take
          r.debt = round2(r.amount - take)
        }
      }
    }
  }

  receptions.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  receptions.forEach((r, i) => {
    r.id = `r${i + 1}`
    r.code = `Ч-${pad(i + 1)}`
  })

  /* ---------------- цінові викиди ✓ PART C 12 ---------------- */
  // «Ціна» реально містить 1.0 і 450/550, і жодних меж ніде немає. ⟡ Сорт-носій бриф
  // не називає — не приписуємо. У демо ці рядки їдуть з маркером «підозріла ціна».
  const outlierTargets = [1, 450, 550]
  const outlierRows = receptions.filter(
    (r) => r.pointId === 'p1' && r.net > 10 && r.net < 40 && r.date > '2026-07-05',
  )
  outlierTargets.forEach((price, i) => {
    const r = outlierRows[Math.floor((outlierRows.length / 4) * (i + 1))]
    if (!r) return
    r.price = price
    r.amount = round2(r.net * (price + r.bonus))
    r.paid = r.amount
    r.debt = 0
  })

  /* ---------------- переплати ✓ H7 ---------------- */
  // У файлі 257 рядків із від'ємним Залишком (15 %), бо колонку «Виплачено» ніхто не обмежує.
  // Стільки не сіємо навмисно: наше віконечко робить видачу понад «Разом» неможливою за
  // побудовою — це і є фіча. Лишаємо горстку, щоб шлях від'ємного балансу існував на екрані.
  // НЕ на Шипинках: тамтешній борг калібрується на виміряні 1 273 518 ₴ ✓ PART A/H5, а
  // зведена переплата зменшила б цифру на екрані рівно на свою суму — і клієнт, який
  // звіряє саме це число зі своїм файлом, побачив би розбіжність без причини.
  const overpaid = receptions.filter(
    (r) => r.pointId !== 'p1' && r.pointId !== 'p2' && r.debt > 100 && r.net > 15 && r.amount < 6000,
  )
  for (let i = 0; i < 6; i++) {
    const r = overpaid[Math.floor((overpaid.length / 7) * (i + 1))]
    if (!r) continue
    r.paid = round2(r.amount + pick([100, 200, 300, 500, 800]))
    r.debt = round2(r.amount - r.paid)
  }

  /* ---------------- виплати за старі дні ---------------- */
  // Індексуємо прийомки по постачальнику один раз: інакше на ~2 700 рядках цей етап
  // перефільтровує весь масив на кожного кандидата кожного дня.
  const bySupplier = new Map<string, Reception[]>()
  for (const r of receptions) {
    const list = bySupplier.get(r.supplierId) ?? []
    list.push(r)
    bySupplier.set(r.supplierId, list)
  }
  const paidBySupplier = new Map<string, Payout[]>()
  const visitsByDay = new Map<ISODate, typeof visits>()
  for (const v of visits) {
    const list = visitsByDay.get(v.date) ?? []
    list.push(v)
    visitsByDay.set(v.date, list)
  }

  const payouts: Payout[] = []
  let paySeq = 0

  for (const day of days) {
    if (day === SEASON_START) continue
    // решту віддають, коли людина приїжджає з ягодою знову — хто перестав приїжджати,
    // висить на залишку, точно як у житті
    for (const visit of visitsByDay.get(day) ?? []) {
      // на другому пункті боржник не забирає нічого — 129 278 ₴ це його персональне число ✓ H9;
      // на решті пунктів він розраховується як усі, інакше борг нікуди не гаситься
      if (topDebtSupplier && visit.supplierId === topDebtSupplier.id && visit.pointId === 'p2') {
        continue
      }
      const own = bySupplier.get(visit.supplierId)
      if (!own) continue
      const cutoff = addDays(day, -2)
      // виплата гасить ТІЛЬКИ прийомки свого пункту: людину розраховують там, куди вона здала
      // ягоду. Інакше «Окремо: видано за ягоду попередніх днів» у касі пункту показувало б
      // гроші, що вийшли з цієї шухляди за чужу ягоду — reconcileDay() рахується попунктно.
      const prior = own.filter((r) => r.date <= cutoff && r.pointId === visit.pointId)
      if (!prior.length) continue
      // повільна четвертина тягне залишки через тижні — звідси й хвости в «Залишках»
      const slow = Number(visit.supplierId.slice(1)) % 4 === 0
      // піковий день — каса повна, і саме тоді забирають старе ✓ H10
      const chance =
        visit.pointId === 'p2' ? 0.06 : day === P1_PEAK_DAY ? 0.4 : slow ? 0.08 : 0.18
      if (rnd() > chance) continue

      const open = openDebts(visit.supplierId, prior, paidBySupplier.get(visit.supplierId) ?? [])
      if (!open.length) continue
      const total = round2(open.reduce((s, o) => s + o.open, 0))
      const partial = rnd() < 0.45
      const amount = partial
        ? round2(Math.max(50, Math.round((total * between(0.3, 0.7)) / 10) * 10))
        : total
      const allocations = allocatePayout(amount, open)
      if (!allocations.length) continue

      const payout: Payout = {
        id: `pay${++paySeq}`,
        code: `В-${pad(paySeq, 3)}`,
        date: day,
        time: `${pad(int(8, 18), 2)}:${pad(int(0, 59), 2)}`,
        pointId: visit.pointId,
        supplierId: visit.supplierId,
        amount: round2(allocations.reduce((s, a) => s + a.amount, 0)),
        allocations,
        operator: OPERATORS[visit.pointId],
        synced: true,
      }
      payouts.push(payout)
      const list = paidBySupplier.get(visit.supplierId) ?? []
      list.push(payout)
      paidBySupplier.set(visit.supplierId, list)
    }
  }

  /* ---------------- калібровка під виміряний Σ Залишок ---------------- */
  // Профілі виплат самі виводять залишок у потрібний порядок, точне число дає ця пропорційна
  // доводка: різниця розкидається по рядках як «людина забрала трохи менше / трохи більше
  // готівки». Рухається тільки `paid`, суми прийомок недоторкані, а борг ніколи не падає
  // нижче того, що вже прив'язано виплатою, — тому FIFO-прив'язки лишаються чинними.
  const allocated = new Map<string, number>()
  for (const p of payouts) {
    for (const a of p.allocations) {
      allocated.set(a.receptionId, round2((allocated.get(a.receptionId) ?? 0) + a.amount))
    }
  }
  const openOf = (r: Reception) => round2(r.debt - (allocated.get(r.id) ?? 0))

  // Виміряні цілі є лише на двох пунктах; малі доводимо до тієї самої частки нарахованого,
  // що й Шипинки (21,3 %) — інакше борг пункту вирішує випадок, а не профіль виплат, і на
  // «Залишках» один придорожній пункт виходить у 20 разів важчим за сусідній.
  const openTargets: Array<[string, number]> = [
    ['p1', P1_OPEN_DEBT],
    ['p2', P2_OPEN_DEBT],
  ]
  for (const pointId of Object.keys(SMALL_POINT_LINES)) {
    const accrued = receptions
      .filter((r) => r.pointId === pointId)
      .reduce((s, r) => s + r.amount, 0)
    openTargets.push([pointId, round2(accrued * SMALL_OPEN_SHARE)])
  }

  for (const [pointId, target] of openTargets) {
    const rows = receptions.filter((r) => r.pointId === pointId)
    const need = round2(target - rows.reduce((s, r) => s + Math.max(0, openOf(r)), 0))
    // недобір: людина забрала трохи менше готівки, борг виріс — прив'язки цілі
    // перебір: рухаємо тільки те, що ще не прив'язане виплатою, тому борг не падає нижче неї
    const movable =
      need > 0
        ? rows.filter((r) => r.paid > 0 && r.debt > 0)
        : // боржника на 129 278 ₴ ✓ H9 не чіпаємо: це персональне число, а не наповнювач
          rows.filter((r) => r.supplierId !== topDebtSupplier?.id)
    const capacity = movable.reduce(
      (s, r) => s + (need > 0 ? r.paid : Math.max(0, openOf(r))),
      0,
    )
    if (capacity <= 0) continue
    const k = Math.min(1, Math.abs(need) / capacity)
    for (const r of movable) {
      const step = round2((need > 0 ? -r.paid : Math.max(0, openOf(r))) * k)
      if (!step) continue
      r.paid = round2(r.paid + step)
      r.debt = round2(r.amount - r.paid)
    }
  }

  /* ---------------- Попередній залишок на квитанції ---------------- */
  // carriedIn — презентація, не вхідне поле: він стоїть тільки на першому рядку візиту,
  // за яким того ж дня пішла виплата за старі дні. Тоді передрук історичного чека показує
  // «Попередній залишок» так само, як бачив приймальник ✓ M10, M11.
  for (const payout of payouts) {
    const own = bySupplier.get(payout.supplierId)!
    let balance = 0
    for (const r of own) if (r.date < payout.date) balance += r.debt
    for (const p of paidBySupplier.get(payout.supplierId) ?? []) {
      if (p.date < payout.date) balance -= p.amount
    }
    const visitLines = own
      .filter((r) => r.date === payout.date && r.pointId === payout.pointId)
      .sort((a, b) => a.time.localeCompare(b.time))
    if (!visitLines.length) continue
    visitLines[0].carriedIn = round2(Math.max(0, balance))
    // прив'язуємо виплату до цього ж візиту, щоб передрук чека не вгадував,
    // яка з виплат людини за той день належить якому чеку
    payout.visitId = visitLines[0].visitId
  }

  /* ---------------- База як пункт прийому (M37) ---------------- */
  // Усе нижче стоїть У САМОМУ КІНЦІ buildSeed() і споживає ВЛАСНИЙ генератор: наявна
  // послідовність rnd() лишається недоторканою, тому жоден заморожений анкер сезону
  // (38 днів, 78 рядків, 47 441 кг, 5 968 793 ₴, 1 273 518 ₴, 855 676 ₴, 129 278 ₴) не
  // рухається. `activePoints` теж не розширений — база не бере участі в циклі прийомки.
  const rndBase = mulberry32(20260806)

  // «склад тоже считається як одна прийомка, але тут типа як оптові ціни» (дзвінок №4,
  // ряд. 545): та сама ціна дня плюс 8 %. Виведені з обігу сорти на складі не котуються.
  for (const day of days) {
    for (const berry of BERRIES) {
      if (berry.retired || day < berry.from || day > berry.to) continue
      const steps = priceSteps.get(`${day}|${berry.id}`)
      if (!steps) continue
      for (const step of steps) {
        prices.push({
          id: `pr_base_${day}_${berry.id}_${step.time.replace(':', '')}`,
          date: day,
          pointId: BASE_POINT.id,
          berryId: berry.id,
          price: Math.round(step.price * 1.08),
          time: step.time,
          author: OWNER,
          reason: 'Оптова ціна складу: +8 % до ціни дня',
        })
      }
    }
  }

  // Невелика прийомка складу за TODAY, щоб екран пункту не був порожній. Обмеження, які
  // тримають заморожені твердження про ВСІ прийомки: час у частковому дні 07:00–12:00,
  // тара тільки Чешка, Піддон і Дод. ціна нульові, розрахунок повний (борг 0, тому й
  // жодної виплати на складі), нетто через weigh() — рушій і сід рахують однаково.
  const baseInt = (a: number, b: number) => a + Math.floor(rndBase() * (b - a + 1))
  const baseBerries = BERRIES.filter((b) => !b.retired && TODAY >= b.from && TODAY <= b.to)
  const baseSuppliers = suppliers.filter((s) => s.kind === 'wholesale').slice(0, 4)
  let baseSeq = receptions.length
  for (const supplier of baseSuppliers) {
    const visitId = `v_base_${supplier.id}`
    const time = `${pad(baseInt(7, 11), 2)}:${pad(baseInt(0, 59), 2)}`
    const left = [...baseBerries]
    const lines = rndBase() < 0.5 ? 2 : 1
    for (let l = 0; l < lines && left.length; l++) {
      const berry = left.splice(baseInt(0, left.length - 1), 1)[0]
      const net = round2(baseInt(80, 400) + Math.round(rndBase() * 10) / 10)
      const tare: TareLine[] = [{ tareId: DEFAULT_TARE_ID, count: Math.max(1, Math.round(net / 5)) }]
      const gross = round2(net + tareWeight(tare, TARE_TYPES))
      // berry — це вже елемент BERRIES, тому пошук і `!` тут були зайві
      const price = Math.round(berry.basePrice * 1.08)
      const w = weigh({ gross, pallet: 0, tare, price, bonus: 0 }, TARE_TYPES)
      baseSeq++
      receptions.push({
        id: `r${baseSeq}`,
        code: `Ч-${pad(baseSeq)}`,
        date: TODAY,
        time,
        pointId: BASE_POINT.id,
        supplierId: supplier.id,
        berryId: berry.id,
        gross: w.gross,
        pallet: w.pallet,
        tare,
        tareWeight: w.tareWeight,
        net: w.net,
        price,
        bonus: 0,
        amount: w.amount,
        paid: w.amount,
        debt: 0,
        carriedIn: 0,
        visitId,
        operator: OPERATORS[BASE_POINT.id],
        synced: true,
      })
    }
  }

  /* ---------------- Переважування і витрати дня (09 §8) ---------------- */
  // ВЛАСНИЙ генератор, як і в блоці бази вище: наявні послідовності rnd() і rndBase()
  // лишаються недоторканими, тому заморожені анкери сезону не рухаються ЗА ПОБУДОВОЮ,
  // а не за збігом. Усе нижче стоїть у самому кінці buildSeed(), перед return.
  const rndCost = mulberry32(20260805)
  const costBetween = (a: number, b: number) => a + rndCost() * (b - a)
  const costInt = (a: number, b: number) => a + Math.floor(rndCost() * (b - a + 1))

  const reweighs: Reweigh[] = []
  const expenses: DayExpense[] = []
  // Політик у сіді немає: дефолт byWeight застосовується саме тоді, коли політики немає,
  // і канонічний день мусить рахуватись дефолтом, а не збереженим правилом (D-3).
  const policies: ExpensePolicy[] = []

  const receptionsByDayPoint = new Map<string, Reception[]>()
  for (const r of receptions) {
    const key = `${r.date}|${r.pointId}`
    const list = receptionsByDayPoint.get(key) ?? []
    list.push(r)
    receptionsByDayPoint.set(key, list)
  }

  /**
   * Єдиний на весь сід день із НАДЛИШКОМ (I47, Q-06) — найважчий день Шипинок.
   * Вибір не косметичний: I47 спрацьовує лише коли пул відʼємний, тобто коли надлишок у
   * гривнях перекриває ручні витрати дня. На малому пункті 1,8 % ваги — це 600 ₴ проти
   * ~3 800 ₴ витрат, і попередження не з'явилося б узагалі.
   */
  const surplusDay = (() => {
    const kgByDay = new Map<ISODate, number>()
    for (const r of receptions) {
      if (r.pointId !== 'p1' || r.date === TODAY) continue
      kgByDay.set(r.date, (kgByDay.get(r.date) ?? 0) + r.net)
    }
    let best: ISODate = HISTORY_END
    let bestKg = -1
    for (const [d, kgOfDay] of kgByDay) {
      if (kgOfDay > bestKg) {
        bestKg = kgOfDay
        best = d
      }
    }
    return best
  })()
  /** Один товар прийняли, а зважити забули (I50) */
  const MISSING_PRODUCT_DAY = { pointId: 'p3', date: '2026-07-22' as ISODate }
  /** Один день без переважування взагалі: витрати є, класти їх нікуди (I51) */
  const NO_REWEIGH_DAY = { pointId: 'p4', date: '2026-07-29' as ISODate }

  let rwSeq = 0
  let expSeq = 0
  for (const day of days) {
    for (const point of activePoints) {
      // (p1, TODAY) прибитий оверрайдом нижче — генератор його не чіпає взагалі,
      // інакше довелося б переписувати вже згенероване, а це два джерела однієї цифри
      if (point.id === 'p1' && day === TODAY) continue
      const dayRows = receptionsByDayPoint.get(`${day}|${point.id}`)
      if (!dayRows?.length) continue
      const rows = productDay(day, point.id, dayRows, BERRIES)
      if (!rows.length) continue

      /* --- витрати дня: касир, вантажник, водій, пальне (09 §8) --- */
      // Мережевих рядків не буває: ExpenseScope скасовано цілком (13 §1 П-2) — керівник
      // ділить одну машину на три пункти сам і заводить три рядки на трьох пунктах.
      const loaders = costInt(1, 2)
      const drivers = costInt(1, 2)
      const plan: Array<[string, number]> = [
        ['Касир', 1_000],
        [loaders === 1 ? 'Вантажник' : `Вантажник ×${loaders}`, 1_300 * loaders],
        [drivers === 1 ? 'Водій' : `Водій ×${drivers}`, 500 * drivers],
        ['Пальне', Math.round(costBetween(700, 1_400) / 10) * 10],
      ]
      const expenseTime = `${pad(costInt(18, 21), 2)}:${pad(costInt(0, 59), 2)}`
      for (const [label, amount] of plan) {
        expenses.push({
          id: `ex${++expSeq}`,
          date: day,
          pointId: point.id,
          kind: 'manual',
          label,
          amount,
          createdBy: OWNER,
          createdDate: day,
          createdTime: expenseTime,
        })
      }

      if (point.id === NO_REWEIGH_DAY.pointId && day === NO_REWEIGH_DAY.date) continue

      const surplus = point.id === 'p1' && day === surplusDay
      const skipProduct =
        point.id === MISSING_PRODUCT_DAY.pointId && day === MISSING_PRODUCT_DAY.date
          ? rows[rows.length - 1].product
          : null

      // сорт-носій рядка — найважчий сорт цього товару того дня: так його й записує вагар
      const carrier = new Map<string, { berryId: string; net: number }>()
      for (const r of dayRows) {
        const product = BERRIES.find((b) => b.id === r.berryId)?.product ?? r.berryId
        const cur = carrier.get(product)
        if (!cur || r.net > cur.net) carrier.set(product, { berryId: r.berryId, net: r.net })
      }

      const id = `rw${++rwSeq}`
      const lines: ReweighLine[] = []
      for (const row of rows) {
        if (row.product === skipProduct) continue
        // Недостача 0,5–1,8 % ваги (09 §8). Надлишковий день — 2,0–3,0 %, і це не смак:
        // I47 спрацьовує РІВНО тоді, коли пул відʼємний, тобто коли надлишок у гривнях
        // перекриває ручні витрати дня (їх максимум тут 6 000 ₴). Зміряно: при 0,5–1,8 %
        // на найважчому дні пул лишався додатним і попередження не з'являлось узагалі.
        const drift = surplus ? costBetween(0.02, 0.03) : costBetween(0.005, 0.018)
        const netKg = round2(Math.max(0.1, row.kgPoint * (surplus ? 1 + drift : 1 - drift)))
        const crates = Math.max(1, Math.round(netKg / 5))
        const tare: TareLine[] = [{ tareId: DEFAULT_TARE_ID, count: crates }]
        const tw = tareWeight(tare, TARE_TYPES)
        lines.push({
          id: `${id}_${lines.length + 1}`,
          order: lines.length + 1,
          berryId: carrier.get(row.product)?.berryId ?? row.product,
          product: row.product,
          grossKg: round2(netKg + tw),
          palletKg: 0,
          tare,
          tareWeightKg: tw,
          tareUnits: crates,
          netKg,
        })
      }
      if (!lines.length) {
        rwSeq--
        continue
      }
      reweighs.push({
        id,
        berryDate: day,
        fromPointId: point.id,
        atPointId: BASE_POINT.id,
        weighedDate: day,
        weighedTime: `${pad(costInt(17, 20), 2)}:${pad(costInt(0, 59), 2)}`,
        status: 'posted',
        lines,
        // знімок кладеться РАЗ, у момент проведення, і більше не переписується (D-2, I41)
        snapshot: rows.map((r) => ({
          product: r.product,
          kgPoint: r.kgPoint,
          avgPoint: r.avgPoint,
        })),
        operator: OWNER,
        synced: true,
      })
    }
  }

  /* ---------------- КАНОНІЧНИЙ ДЕНЬ: Шипинки, TODAY (09 §8.1, D-1) ---------------- */
  // Обіцянка «Шипинки 04.08 дадуть РІВНО числа зі спеки» генератором не виконується:
  // базова ціна малини ≤ 140, а недостача й пальне випадкові. Тому день прибивається
  // оверрайдом — і саме цей день є критерієм приймання всієї фази.

  // 1 · прибираємо згенеровану прийомку p1 за TODAY. Спершу посилання на неї, бо виплата,
  //     що гасила б прибраний рядок, лишилася б із сумою без покриття, а виплата взагалі
  //     без прив'язок не має права існувати (seed.test.ts).
  //     ЗМІРЯНО на цьому сіді: прибираються 18 рядків, ПРИВ'ЯЗОК на них 0 — але ШІСТЬ
  //     виплат мають visitId прибраного візиту (його ставить блок «Попередній залишок»
  //     вище). Без цього очищення передрук чека шукав би візит, якого вже немає. Кількості
  //     залежать від послідовності rnd() і зсуваються з кожною правкою сіду, тому блок
  //     написаний загально, а не під сьогоднішні шість.
  const doomedToday = receptions.filter((r) => r.pointId === 'p1' && r.date === TODAY)
  const doomed = new Set(doomedToday.map((r) => r.id))
  const doomedVisits = new Set(doomedToday.map((r) => r.visitId))
  for (let i = payouts.length - 1; i >= 0; i--) {
    const p = payouts[i]
    if (p.visitId && doomedVisits.has(p.visitId)) p.visitId = undefined
    const kept = p.allocations.filter((a) => !doomed.has(a.receptionId))
    if (kept.length === p.allocations.length) continue
    if (!kept.length) {
      payouts.splice(i, 1)
      continue
    }
    p.allocations = kept
    p.amount = round2(kept.reduce((s, a) => s + a.amount, 0))
  }
  for (let i = receptions.length - 1; i >= 0; i--) {
    if (doomed.has(receptions[i].id)) receptions.splice(i, 1)
  }

  // 2 · рівно три рядки одного візиту. Ставка 160 ₴/кг вища за довідникову (малина ≤ 140) —
  //     і це нормально: оверрайд прибиває саму СУМУ рядка, рівно як це робить Дод. ціна.
  const canonSupplier = suppliers.find((s) => s.homePointId === 'p1')!
  const CANON: Array<{ berryId: string; net: number; price: number; bonus: number }> = [
    { berryId: 'v_mal_v', net: 800, price: 140, bonus: 20 },
    { berryId: 'v_smor', net: 60, price: 45, bonus: 15 },
    { berryId: 'v_por', net: 5, price: 50, bonus: 10 },
  ]
  let canonSeq = receptions.reduce((m, r) => {
    const n = Number(r.id.slice(1))
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  for (const c of CANON) {
    const crates = Math.max(1, Math.round(c.net / 5))
    const tare: TareLine[] = [{ tareId: DEFAULT_TARE_ID, count: crates }]
    const gross = round2(c.net + tareWeight(tare, TARE_TYPES))
    const w = weigh({ gross, pallet: 0, tare, price: c.price, bonus: c.bonus }, TARE_TYPES)
    canonSeq++
    receptions.push({
      id: `r${canonSeq}`,
      code: `Ч-${pad(canonSeq)}`,
      date: TODAY,
      time: '09:20',
      pointId: 'p1',
      supplierId: canonSupplier.id,
      berryId: c.berryId,
      gross: w.gross,
      pallet: w.pallet,
      tare,
      tareWeight: w.tareWeight,
      net: w.net,
      price: c.price,
      bonus: c.bonus,
      amount: w.amount,
      // розрахунок повний: борг 0, тому канонічний день не рухає ні залишок p1, ні виплати
      paid: w.amount,
      debt: 0,
      carriedIn: 0,
      visitId: 'v_canon_p1',
      operator: OPERATORS.p1,
      synced: true,
    })
  }

  // 3 · переважування 790,00 / 59,00 / 5,00 і знімок разом із ним. Знімок береться з
  //     productDay() — тим самим кодом, яким його потім читає costOfDay(): якби сід
  //     рахував середню ціну власною формулою, розбіжність між ними ніхто б не побачив.
  const canonBerryOf = new Map(
    CANON.map((c) => [BERRIES.find((b) => b.id === c.berryId)!.product, c.berryId]),
  )
  const CANON_BASE_KG: Record<string, number> = { Малина: 790, Смородина: 59, Порічка: 5 }
  const canonRows = productDay(TODAY, 'p1', receptions, BERRIES)
  const canonId = `rw${++rwSeq}`
  reweighs.push({
    id: canonId,
    berryDate: TODAY,
    fromPointId: 'p1',
    atPointId: BASE_POINT.id,
    weighedDate: TODAY,
    weighedTime: '13:40',
    status: 'posted',
    lines: canonRows.map((row, i) => {
      const netKg = CANON_BASE_KG[row.product]
      const crates = Math.max(1, Math.round(netKg / 5))
      const tare: TareLine[] = [{ tareId: DEFAULT_TARE_ID, count: crates }]
      const tw = tareWeight(tare, TARE_TYPES)
      return {
        id: `${canonId}_${i + 1}`,
        order: i + 1,
        berryId: canonBerryOf.get(row.product) ?? row.product,
        product: row.product,
        grossKg: round2(netKg + tw),
        palletKg: 0,
        tare,
        tareWeightKg: tw,
        tareUnits: crates,
        netKg,
      }
    }),
    snapshot: canonRows.map((r) => ({
      product: r.product,
      kgPoint: r.kgPoint,
      avgPoint: r.avgPoint,
    })),
    operator: OWNER,
    synced: true,
  })

  // 4 · рівно чотири ручні витрати: 1 000 + 1 300 + 500 + 1 000 = 3 800. Разом із
  //     недостачею 1 660 це дає пул 5 460,00 ₴ — те саме число, яким живуть §3.3 і §3.4.
  const CANON_EXPENSES: Array<[string, number]> = [
    ['Касир', 1_000],
    ['Вантажник', 1_300],
    ['Водій', 500],
    ['Пальне', 1_000],
  ]
  for (const [label, amount] of CANON_EXPENSES) {
    expenses.push({
      id: `ex${++expSeq}`,
      date: TODAY,
      pointId: 'p1',
      kind: 'manual',
      label,
      amount,
      createdBy: OWNER,
      createdDate: TODAY,
      createdTime: '19:10',
    })
  }

  /* ---------------- 5 · один СТОРНОВАНИЙ документ (I54, ескіз Н9) ---------------- */
  // Без нього право «сторнувати з причиною» (09 §7) не має в демо ЖОДНОГО прикладу: список
  // «Проведені переважування за цей день» показував би лише зелені рядки, а ескіз Н9 малює
  // сторнований рядок саме з причиною «двічі ввели ту саму машину». Тому кладемо дубль
  // канонічного документа зі статусом `voided` — рівно той сценарій, який причина й описує.
  //
  // Чому саме на канонічному дні, хоч решта оверрайду його береже від шуму: сторнований
  // документ на 27.06 керівник побачив би лише перелистнувши 38 днів назад, тобто ніколи.
  // А на гроші це не впливає ЗА ПОБУДОВОЮ — `costOfDay()` виключає `voided` і з `kgBase`,
  // і з вибору знімка (I54), тому пул, собівартість і порушення канонічного дня однакові
  // з дублем і без нього. Перевірено прогоном: 5 460 / 135 700 / 0 порушень в обох випадках.
  const canonTwin = reweighs.find((r) => r.id === canonId)
  if (canonTwin) {
    reweighs.push({
      ...canonTwin,
      id: `rw${++rwSeq}`,
      lines: canonTwin.lines.map((l, i) => ({ ...l, id: `rw${rwSeq}_${i + 1}` })),
      status: 'voided',
      // ту саму машину провели вдруге через 6 хвилин, а помилку побачили ще за 12
      weighedTime: '17:46',
      voidedDate: TODAY,
      voidedTime: '17:58',
      voidedBy: OWNER,
      voidReason: 'двічі ввели ту саму машину',
      synced: true,
    })
  }

  /* ---------------- ЯЩИКИ І КАСА ЯК ПІДЗВІТ (21 §8.1) ---------------- */
  /*
   * ПРАВИЛО РОЗМІЩЕННЯ, без якого поїдуть заморожені анкери сезону: увесь цей блок стоїть
   * у КІНЦІ buildSeed() і крутить ВЛАСНИЙ генератор. На послідовності `rnd()` у циклі
   * прийомки тримаються 1 701 рядок / 38 днів / 47 441 кг / 5 968 793 ₴ — один зайвий
   * виклик `rnd()` до того циклу зсунув би кожне з цих чисел. Нижче — тільки `crnd()`.
   */
  const crnd = mulberry32(20260805)
  const crateInt = (a: number, b: number) => a + Math.floor(crnd() * (b - a + 1))
  /** Вечір: «наший перевізник ввечері сідає і їде на точку» (дзвінок №4, ряд. 1144) */
  const clock = (from: number, to: number) => `${pad(crateInt(from, to), 2)}:${pad(crateInt(0, 59), 2)}`

  /**
   * День, з якого ведеться касова книга — за сім днів до TODAY. Не з 27.06: подій каси за
   * 39 днів було б 200+, а доводять вони рівно те саме, що й за сім. Це СВІДОМЕ звуження
   * (21 §8.1), і воно назване тут, а не сховане у формі даних.
   */
  const CASH_BOOK_OPEN = CASH_BOOK_FROM

  /*
   * НАДІЛ — це історія, а не поле на точці: «я за те, щоб поняття фіксованої суми… їм
   * потрібно бачити очима візуально, від якої суми їм потрібно відштовхуватись»
   * (1067–1068). Тому на Шипинках ДВА записи: зміна 600 → 800 має бути видима як подія з
   * датою, автором і причиною, а не як переписане число.
   */
  const crateAllotments: CrateAllotment[] = [
    {
      id: 'ca1', pointId: 'p1', units: 600, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Число клієнтки: «Тобто це поки по 600 ящиків» (дзвінок №4, ряд. 940)',
    },
    {
      id: 'ca2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15',
      setBy: OWNER, setDate: '2026-07-15', setTime: '08:10',
      reason: 'Зміряно на цьому ж сіді: 15.07 відвантажено 712 ящиків — наділ 600 не покривав дня. «нам треба на точці, щоб було 800» (1062)',
    },
    {
      id: 'ca3', pointId: 'p2', units: 1_200, effectiveFrom: '2026-08-01',
      setBy: OWNER, setDate: '2026-08-01', setTime: '07:40',
      reason: 'Демонстраційний дефолт. Зміряно: два дні відвантажень поспіль дають до 1 008 ящиків, і всі вони лежать у нас, поки не поїдуть назад',
    },
    {
      id: 'ca4', pointId: 'p3', units: 200, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Демонстраційний дефолт: максимум відвантаження Гайового — 80 ящиків за день',
    },
    {
      id: 'ca5', pointId: 'p4', units: 200, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Демонстраційний дефолт: максимум відвантаження Попівців — 101 ящик за день',
    },
    {
      id: 'ca6', pointId: 'p5', units: 150, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Демонстраційний дефолт: максимум відвантаження Михайлівців — 47 ящиків за день',
    },
  ]

  /*
   * НАДІЛ КАСИ — форма навмисно дзеркальна до наділу ящиків: «технологія з грошима така
   * сама, як з ящиками» (1144). Два числа взяті з їхнього файлу (`CASH_FLOAT_BY_POINT`),
   * решта — демонстраційні дефолти, і кожен позначений як дефолт у своїй причині.
   */
  const cashFloats: CashFloat[] = [
    {
      id: 'cf1', pointId: 'p1', amount: CASH_FLOAT_BY_POINT.p1, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Клітинка E1 їхнього файла — каса на початок дня, набрана руками ✓ PART B',
    },
    {
      id: 'cf2', pointId: 'p1', amount: 500_000, effectiveFrom: '2026-07-10',
      setBy: OWNER, setDate: '2026-07-10', setTime: '08:20',
      reason: 'Зміряно: 13 днів із 39 видали більше за 145 453 ₴, максимум 493 735 ₴ (15.07). Демонстраційний дефолт — справжнє число має назвати клієнт (Q-21)',
    },
    // Конищів відкрився 01.08, і наділ каси починається тим самим днем. Зміряно на цьому
    // сіді: 50 000 ₴ його не покривають — точка завжди на день позаду, тому 04.08 каса за
    // ягоду виходить −1 130,18 ₴ (при книзі, відкритій 01.08). Це не вада демо-даних, а
    // рівно те, про що Q-21: модель наділу правильна, конкретне число — ні. Екран, який
    // відкриє книгу Конищева 29.07 замість 01.08, отримає ще й нульовий початковий
    // залишок, бо на 29.07 наділу в нього ще не було взагалі.
    {
      id: 'cf3', pointId: 'p2', amount: 50_000, effectiveFrom: '2026-08-01',
      setBy: OWNER, setDate: '2026-08-01', setTime: '07:40',
      reason: 'Демонстраційний дефолт: максимум видатку Конищева за день — 42 935 ₴',
    },
    {
      id: 'cf4', pointId: 'p3', amount: CASH_FLOAT_BY_POINT.p3, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Скриншот Гайового ✓ H6. Зміряно: 0 днів із 39 із перевищенням цього наділу',
    },
    {
      id: 'cf5', pointId: 'p4', amount: 60_000, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Демонстраційний дефолт: максимум видатку Попівців за день — 51 019 ₴',
    },
    {
      id: 'cf6', pointId: 'p5', amount: 30_000, effectiveFrom: SEASON_START,
      setBy: OWNER, setDate: SEASON_START, setTime: '08:00',
      reason: 'Демонстраційний дефолт: максимум видатку Михайлівців за день — 26 621 ₴',
    },
  ]

  /*
   * ВИДАЧІ Й ПОВЕРНЕННЯ — ТІЛЬКИ НА ШИПИНКАХ, і це перенесений журнал клієнтки (21 §8.2):
   * 15 рядків, 13 людей, 275 ящиків, рядок у рядок з аркуша `Ящики`. Пара в масиві —
   * [людина, ящиків], і індекс людини ПОВТОРЮЄТЬСЯ там, де в її файлі одна й та сама
   * особа стоїть двома рядками: рядки 9 і 10 (15 + 5) та рядки 7 і 12 (30 + 10) ✓ H2.
   * Саме заради цих двох пар підсумок по людині має що підсумовувати.
   *
   * Спосіб видачі НЕ проставлений руками: його дає `crateIssueMode()` за порогом 50, і
   * рівно один рядок із п'ятнадцяти (80 ящиків) виходить за розписку. Звідси й три різні
   * числа §8.2, яких із самої таблиці не видно: 275 × 120 = 33 000 ₴ стверджує її аркуш,
   * 195 × 120 = 23 400 ₴ коштують ящики, що зараз у полі, а 115 × 120 = 13 800 ₴ ми
   * справді тримаємо готівкою — за 80 ящиків під розписку грошей немає взагалі.
   */
  const CRATE_JOURNAL: Array<[person: number, units: number]> = [
    [0, 30], [1, 50], [2, 3], [3, 10], [4, 80],
    [5, 10], [6, 30], [7, 3], [8, 15], [8, 5],
    [9, 10], [6, 10], [10, 8], [11, 1], [12, 10],
  ]
  const crateFolk = suppliers.filter((s) => s.homePointId === 'p1').slice(0, 13)
  /** Завдаток за ящик — це ЦІНА ЧЕШКИ (рішення Р-1): у їхньому журналі `Ціна тари` = 120 в усіх 15 рядках */
  const cheshka = TARE_TYPES.find((t) => t.id === DEFAULT_TARE_ID)!

  /*
   * Дати видач — 29–31.07, тобто всередині касової книги, а не «десь у липні». Це не
   * косметика: `cashStanding()` читає завдатки з вікна [openedOn … date], і видача,
   * датована 10.07, дала б на екрані каси за ящики 0,00 ₴ при 195 ящиках у людей.
   */
  const crateIssues: CrateIssue[] = CRATE_JOURNAL.map(([person, units], i) => {
    const mode = crateIssueMode(units)
    // За розписку — РІВНО 0 (21 §2.3): тоді завдаток і повернення рахуються однією
    // формулою для обох способів, без окремої гілки й без двох полів, які мусять
    // брехати узгоджено.
    const perUnit = mode === 'deposit' ? cheshka.price : 0
    return {
      id: `ci${i + 1}`,
      date: addDays(CASH_BOOK_OPEN, Math.floor(i / 5)),
      // Година зростає в межах дня: `openCrateIssues()` сортує за (дата, час, id), і
      // FIFO повернення читає саме цей порядок.
      time: `${pad(8 + (i % 5), 2)}:${pad(crateInt(0, 59), 2)}`,
      pointId: 'p1',
      supplierId: crateFolk[person].id,
      units,
      mode,
      depositPerUnit: perUnit,
      depositTaken: round2(units * perUnit),
      receiptNo: mode === 'receipt' ? 'Р-0001' : undefined,
      operatorId: OPERATORS.p1,
    }
  })

  /*
   * Два повернення з її ж журналу: 30 і 50 ящиків, обидва повні. Розклад по видачах не
   * рахується руками — його дає `allocateCrateReturn()` по FIFO, а гроші бере зі ЗНІМКА
   * ціни тієї видачі: «воно автоматично підтягує, як та людина брала» (1087).
   * Разом: 3 600 + 6 000 = 9 600 ₴ з каси за ящики, і в нас лишається 13 800 ₴.
   */
  const crateReturns: CrateReturn[] = []
  for (const back of [
    { id: 'cr1', supplierId: crateFolk[0].id, units: 30, date: addDays(CASH_BOOK_OPEN, 2), time: '11:20' },
    { id: 'cr2', supplierId: crateFolk[1].id, units: 50, date: '2026-08-02', time: '10:05' },
  ]) {
    const allocations = allocateCrateReturn(
      back.units,
      openCrateIssues(back.supplierId, crateIssues, crateReturns),
    )
    crateReturns.push({
      ...back,
      pointId: 'p1',
      allocations,
      depositRefund: crateRefund(allocations),
      operatorId: OPERATORS.p1,
    })
  }

  /*
   * ВЕЧІРНІ ВІДПРАВЛЕННЯ — на кожній активній точці за 29.07–04.08. `withBerryUnits`
   * рахує РУШІЙ із квитанцій дня по Чешці: «не вони мають вносити, а сама програма має
   * вичитати» (1115). Бій — руками, і не щодня: «ламані не кожен день можуть бути» (993).
   *
   * День, у якому точка не прийняла жодної квитанції, відправлення НЕ отримує взагалі:
   * машини ввечері не було. Це стосується лише Конищева 29–31.07 — він відкрився 01.08,
   * і документ «відправлено 0 ящиків» на цих трьох днях був би подією, якої не сталося.
   */
  const BROKEN_BY_DAY: Record<string, number> = { '2026-07-29': 3, '2026-07-31': 1, [TODAY]: 2 }
  const shipDays: ISODate[] = []
  for (let d = CASH_BOOK_OPEN; d <= TODAY; d = addDays(d, 1)) shipDays.push(d)

  const crateShipments: CrateShipment[] = []
  for (const point of activePoints) {
    for (const day of shipDays) {
      const draft = crateShipmentDraft({
        date: day,
        pointId: point.id,
        receptions,
        crateTareId: DEFAULT_TARE_ID,
      })
      if (!draft.receptionCount) continue
      crateShipments.push({
        id: `cs${crateShipments.length + 1}`,
        date: day,
        pointId: point.id,
        withBerryUnits: draft.withBerryUnits,
        receptionCount: draft.receptionCount,
        brokenUnits: BROKEN_BY_DAY[day] ?? 0,
        operatorId: OPERATORS[point.id],
        postedDate: day,
        postedTime: clock(18, 20),
      })
    }
  }

  /*
   * ПЕРЕКАЗИ ВЕЗУТЬ ВЧОРАШНЄ — і гроші, і ящики. Дослівно її процес: «ми їм сьогодні
   * передаємо кількість ящиків за вчора і кількість грошей за вчора, яку вони вклали в
   * ягоду» (1144). Гроші беруться з `reconcileDay(D−1).cashOut` — того самого числа, яким
   * звіт дня показує «видано»; ящики — із суми відправлення за D−1.
   *
   * Наслідок, який і треба побачити на екрані: наприкінці дня каса точки дорівнює
   * «наділ − видаток цього дня», а не наділу. Точка завжди на день позаду, і саме це
   * вона називає заборгованістю перед точками (1187).
   */
  const carrier = 'Перевізник Р.'
  const recsOf = new Map(activePoints.map((p) => [p.id, receptions.filter((r) => r.pointId === p.id)]))
  const paysOf = new Map(activePoints.map((p) => [p.id, payouts.filter((x) => x.pointId === p.id)]))
  const shippedOn = (pointId: string, date: ISODate) =>
    crateShipments
      .filter((s) => s.pointId === pointId && s.date === date)
      .reduce((n, s) => n + shipmentTotal(s), 0)
  const cashOutOn = (pointId: string, date: ISODate) =>
    reconcileDay(date, recsOf.get(pointId) ?? [], paysOf.get(pointId) ?? []).cashOut

  const transfers: Transfer[] = []
  // 30.07 … 03.08: перший день книги везти нема чого (вчора книги ще не було), а сьогодні
  // переказів немає взагалі — це друге з трьох навмисних відхилень.
  for (const day of shipDays.slice(1, -1)) {
    const yesterday = addDays(day, -1)
    for (const point of activePoints) {
      const owed = cashOutOn(point.id, yesterday)
      const crates = shippedOn(point.id, yesterday)
      if (!owed && !crates) continue
      // ВІДХИЛЕННЯ 1 (M45, UC-37): 03.08 Шипинки отримують 20 000 ₴ проти витрачених
      // 02.08 29 395,35 ₴ — база гасить борг ЧАСТИНАМИ, і 9 395,35 ₴ лишаються висіти.
      const partial = day === '2026-08-03' && point.id === 'p1'
      transfers.push({
        id: `tf${transfers.length + 1}`,
        date: day,
        pointId: point.id,
        crates,
        cash: partial ? 20_000 : owed,
        carrier,
        sentBy: OWNER,
        sentTime: clock(17, 18),
        status: 'accepted',
        acceptedBy: OPERATORS[point.id],
        acceptedTime: clock(19, 20),
      })
    }
  }

  /*
   * ВІДХИЛЕННЯ 3 (M44, UC-36): сьогодні на Михайлівцях переказ НЕ СХОДИТЬСЯ. Відправлено
   * 20 порожніх ящиків і гроші за 03.08, точка нарахувала 18. Документ у стані 'disputed'
   * не рухає ні касу, ні наділ (I68) — на екрані це видно як БІЛЬШИЙ борг, а не як менші
   * ящики, бо розбіжність закриває керівник новим документом: «щоб керівник просто
   * змінював, щоб не вони, бо то ужас буде» (1185).
   */
  const disputedCrates = shippedOn('p5', '2026-08-03')
  const disputedCash = cashOutOn('p5', '2026-08-03')
  transfers.push({
    id: `tf${transfers.length + 1}`,
    date: TODAY,
    pointId: 'p5',
    crates: disputedCrates,
    cash: disputedCash,
    carrier,
    sentBy: OWNER,
    sentTime: '17:30',
    status: 'disputed',
    reportedCrates: disputedCrates - 2,
    reportedCash: disputedCash,
    disputeNote: 'Порахували ящики при перевізнику: приїхало на два менше, ніж у переказі. Гроші зійшлися',
  })

  /*
   * ЗМІНИ І ПЕРЕРАХУНКИ — тільки за сьогодні і тільки на двох точках (21 §8.1). Історія
   * змін за 39 днів не сіється: вона доводила б рівно те саме, що й одна пара, і це теж
   * свідоме звуження, назване вголос.
   *
   * Жодне число тут не набране руками: і «очікувано», і «пораховано» зводить
   * `cashStanding()` — той самий рушій, яким їх покаже екран каси. Інакше демо показувало
   * б недостачу там, де її немає, а розбіжність у цій моделі не «зникає» ніколи.
   */
  const cashAt = (pointId: string, date: ISODate) =>
    cashStanding({
      pointId,
      date,
      openedOn: CASH_BOOK_OPEN,
      floats: cashFloats,
      receptions,
      payouts,
      transfers,
      issues: crateIssues,
      returns: crateReturns,
    })

  // Гайове: зміна ЗАКРИТА з розбіжністю 0,00. `openingFloat` — це перерахунок на ранок, а
  // на ранок у шухляді лежить те, чим закінчився вчорашній день. Закриває сам приймальник,
  // бо `shiftStatusFor(0)` дає 'closed'; за будь-якої розбіжності це був би
  // 'awaiting_explanation' і керівник (06 §6 п. 5).
  const p3Expected = cashAt('p3', TODAY).expectedCash
  // Приймальник порахував рівно те, що очікувано; нуль тут не набраний руками, а зведений
  // тим самим `shiftDiscrepancy()`, яким його рахуватиме екран закриття зміни.
  const p3Discrepancy = shiftDiscrepancy(p3Expected, p3Expected)
  const shifts: Shift[] = [
    {
      id: 'sf1',
      pointId: 'p3',
      operatorId: OPERATORS.p3,
      date: TODAY,
      openedTime: '07:30',
      openingFloat: cashAt('p3', addDays(TODAY, -1)).expectedCash,
      closedTime: '20:05',
      countedCash: p3Expected,
      discrepancy: p3Discrepancy,
      status: shiftStatusFor(p3Discrepancy),
      closedBy: OPERATORS.p3,
    },
    // Шипинки: зміна ще ВІДКРИТА — сьогодні день у роботі, і саме на ній висить
    // перерахунок серед дня.
    {
      id: 'sf2',
      pointId: 'p1',
      operatorId: OPERATORS.p1,
      date: TODAY,
      openedTime: '07:10',
      openingFloat: cashAt('p1', addDays(TODAY, -1)).expectedCash,
      status: 'open',
    },
  ]

  /*
   * Перерахунок о 16:00 — її власна вимога: «о 16 годині вони мають перерахувати свою
   * касу» (1210), «щоб не цілий день передивлятися» (1197). Він нічого не виправляє, лише
   * фіксує факт.
   *
   * Чесна межа цього числа: `cashStanding()` рахує ПО ДНЯХ, часу в ньому немає взагалі,
   * тому знімок «о 16:00» — це знімок усього дня. Для демо так і треба (число мусить
   * збігатися з екраном каси), але внутрішньоденної точності тут немає, і вигадувати її
   * підгонкою суми було б гірше, ніж сказати про це рядком.
   */
  const p1Cash = cashAt('p1', TODAY)
  const cashCounts: CashCount[] = [
    {
      id: 'cc1',
      shiftId: 'sf2',
      pointId: 'p1',
      date: TODAY,
      at: '16:00',
      countedCash: p1Cash.expectedCash,
      expectedAtCount: p1Cash.expectedCash,
      discrepancy: shiftDiscrepancy(p1Cash.expectedCash, p1Cash.expectedCash),
      countedBy: OPERATORS.p1,
      note: 'Перерахунок серед дня: у шухляді гроші за ягоду і завдатки за ящики разом',
    },
  ]

  return {
    // База лежить поза POINTS саме тому, що POINTS годує цикл прийомки; на екрані ж
    // це звичайний пункт, тому у знімок вона їде разом з усіма (M37)
    points: [...POINTS, BASE_POINT],
    berries: BERRIES,
    tareTypes: TARE_TYPES,
    suppliers,
    prices,
    receptions,
    payouts,
    reweighs,
    expenses,
    policies,
    crateAllotments,
    cashFloats,
    crateIssues,
    crateReturns,
    crateShipments,
    transfers,
    shifts,
    cashCounts,
  }
}

export function nextCode(prefix: string, existing: string[], width = 4) {
  const max = existing.reduce((m, c) => {
    const n = Number(c.split('-')[1])
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(width, '0')}`
}

/** Годинник пристрою, HH:MM. Бізнес-дата — це завжди окремий `ISODate`, не `new Date()`. */
export function nowTime(): ClockTime {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function todayISO() {
  return toISO(new Date())
}
