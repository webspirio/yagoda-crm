import { allocatePayout, openDebts, round2, tareWeight, weigh } from './calc'
import { addDays, toISO } from './format'
import { SUPPLIER_SEED } from './seed-suppliers'
import type {
  Berry,
  ISODate,
  Payout,
  Point,
  PriceRecord,
  Reception,
  Settings,
  Supplier,
  TareLine,
  TareType,
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

/** 10 пунктів з їхнього ж випадаючого списку `Data_Import!E` ✓ PART A. p6–p10 — «від 5 до 10» */
export const POINTS: Point[] = [
  { id: 'p1', name: 'Шипинки', village: 'с. Шипинки', isMain: true, active: true },
  { id: 'p2', name: 'Войнашівка', village: 'с. Войнашівка', isMain: false, active: true },
  { id: 'p3', name: 'Гайове', village: 'с. Гайове', isMain: false, active: true },
  { id: 'p4', name: 'Попівці', village: 'с. Попівці', isMain: false, active: true },
  { id: 'p5', name: 'Міжлісся', village: 'с. Міжлісся', isMain: false, active: true },
  { id: 'p6', name: 'Конищів', village: 'с. Конищів', isMain: false, active: false },
  { id: 'p7', name: 'Михайлівці', village: 'с. Михайлівці', isMain: false, active: false },
  { id: 'p8', name: 'Зоряне', village: 'с. Зоряне', isMain: false, active: false },
  { id: 'p9', name: 'Дашківці', village: 'с. Дашківці', isMain: false, active: false },
  { id: 'p10', name: 'Журавлівка', village: 'с. Журавлівка', isMain: false, active: false },
]

/** Каса на початок дня, набрана руками в `E1` ✓ PART B; Гайове — зі скриншотів ДОПОМОГА ✓ H6 */
export const CASH_FLOAT_BY_POINT: Record<string, number> = { p1: 145_453, p3: 50_000 }

/**
 * Товар — верхній рівень, 9 позицій ✓ PART A. `Berry.product` посилається на `name`.
 * Кизил не має жодного сорту в переліку 17 — і це реальний глухий кут: тара тягнеться
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
]

/**
 * Сорт — 17 позицій, і це ключ ціни ✓ PART A.
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
  { id: 'v_vysh_o', name: 'Вишня ОПТ', short: 'Вишня ОПТ', product: 'Вишня', wholesale: true, from: '2026-06-27', to: '2026-07-20', basePrice: 32 },
  { id: 'v_por', name: 'Порічка', short: 'Порічка', product: 'Порічка', wholesale: false, from: '2026-07-05', to: '2026-07-28', basePrice: 50 },
  { id: 'v_por_o', name: 'Порічка ОПТ', short: 'Порічка ОПТ', product: 'Порічка', wholesale: true, from: '2026-07-05', to: '2026-07-28', basePrice: 48 },
  { id: 'v_smor', name: 'Смородина', short: 'Смородина', product: 'Смородина', wholesale: false, from: '2026-07-05', to: '2026-08-04', basePrice: 45 },
  { id: 'v_smor_o', name: 'Смородина ОПТ', short: 'Смород. ОПТ', product: 'Смородина', wholesale: true, from: '2026-07-05', to: '2026-08-04', basePrice: 42 },
  { id: 'v_ozh', name: 'Ожина', short: 'Ожина', product: 'Ожина', wholesale: false, from: '2026-07-22', to: '2026-08-04', basePrice: 60 },
  { id: 'v_ozh_o', name: 'Ожина ОПТ', short: 'Ожина ОПТ', product: 'Ожина', wholesale: true, from: '2026-07-22', to: '2026-08-04', basePrice: 65 },
  { id: 'v_buz', name: 'Бузина', short: 'Бузина', product: 'Бузина', wholesale: false, from: '2026-07-25', to: '2026-08-04', basePrice: 25 },
  { id: 'v_buz_o', name: 'Бузина ОПТ', short: 'Бузина ОПТ', product: 'Бузина', wholesale: true, from: '2026-07-25', to: '2026-08-04', basePrice: 22 },
  { id: 'v_shyp', name: 'Шипшина', short: 'Шипшина', product: 'Шипшина', wholesale: false, from: '2026-08-01', to: '2026-08-04', basePrice: 35 },
  { id: 'v_shyp_o', name: 'Шипшина ОПТ', short: 'Шипш. ОПТ', product: 'Шипшина', wholesale: true, from: '2026-08-01', to: '2026-08-04', basePrice: 30 },
]

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
 * M7: «не більше 20… чи не більше 30». Верхня межа саме 30, а не 25: +30 реально
 * трапляється на другому пункті ✓ PART B, і жорсткий кап на 25 відкидав би їхні ж дані.
 */
export const DEFAULT_SETTINGS: Settings = { surchargeMin: -15, surchargeMax: 30 }

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
 * Малі пункти — «щойно розгорнуті», 6–10 рядків/день ✓ docs/05 §1.5. Міжлісся тримаємо
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
 * кого мішок випадково витягнув, і Попівці виходили в 23 рази важчими за Міжлісся.
 */
const SMALL_OPEN_SHARE = P1_OPEN_DEBT / 5_968_793

/**
 * Дод. ціна +26…+30 — рівно те, чим виправданий кап 30, а не 25: «+30 реально трапляється
 * на другому пункті» ✓ M7, PART B, docs/05 §1.5 S13. П'ять рядків, усі на Войнашівці.
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
 * Войнашівка в серпні — майже виключно малина вищих сортів. Це не смак, це арифметика їхніх
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
  // Войнашівка щойно в роботі: каса тонка (50 000 ₴ на пункті іншого масштабу ✓ H6 проти
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
    wholesale: s.wholesale,
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
    // і Міжлісся в цій вилці найнижче ✓ docs/05 §1.5
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
          (b) => day >= b.from && day <= b.to && (!b.wholesale || supplier.wholesale),
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
          point.id === 'p2' ? MIX_P2 : supplier.wholesale ? MIX_WHOLESALE : MIX_RETAIL
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
          slots.find((s) => s.supplier.wholesale && (weightOf.get(s.supplier.id) ?? 0) >= 20) ??
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
          .filter((s) => s.supplier.wholesale && !s.fixedNet)
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
      // Тільки Войнашівка: на «Тарі і сортах» кап 30 має спиратись на реальні рядки, інакше
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
      // на Войнашівці боржник не забирає нічого — 129 278 ₴ це його персональне число ✓ H9;
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

  return {
    points: POINTS,
    berries: BERRIES,
    tareTypes: TARE_TYPES,
    suppliers,
    prices,
    receptions,
    payouts,
  }
}

export function nextCode(prefix: string, existing: string[], width = 4) {
  const max = existing.reduce((m, c) => {
    const n = Number(c.split('-')[1])
    return Number.isFinite(n) ? Math.max(m, n) : m
  }, 0)
  return `${prefix}-${String(max + 1).padStart(width, '0')}`
}

export function nowTime() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function todayISO() {
  return toISO(new Date())
}
