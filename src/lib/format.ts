import type { ISODate } from './types'

const MONTHS_GEN = [
  'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
  'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня',
]

const WEEKDAYS = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота']

export function uah(v: number, opts: { decimals?: number; sign?: boolean } = {}) {
  const { decimals = 0, sign = false } = opts
  const s = Math.abs(v).toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  const prefix = v < 0 ? '−' : sign && v > 0 ? '+' : ''
  return `${prefix}${s} ₴`
}

/** Balances carry kopecks; show them only when they exist. */
export function uahAuto(v: number) {
  return uah(v, { decimals: Math.abs(v % 1) > 0.004 ? 2 : 0 })
}

/**
 * Кілограми. Мінус — типографський (U+2212), той самий, що друкує `uah()`.
 *
 * `toLocaleString('uk-UA')` віддає дефіс-мінус U+2D, і до фази 2 це ніде не було видно:
 * жоден екран не друкував ВІДʼЄМНОЇ ваги. Недостача на Н8 і Н9 — перша, і поруч у тому
 * самому рядку стоїть `−885,88 ₴` з U+2212. Два різні мінуси в одному рядку аркуша, який
 * керівниця несе з собою, — це не педантизм: на папері вони різної довжини.
 *
 * Зворотний бік безпечний: `parseNumeric()`/`maskDecimalInput()` у `calc.ts` зводять
 * U+2212, U+2013 і U+2014 до звичайного дефіса, тому вага, прочитана з екрана і набрана
 * назад, лишається числом.
 */
export function kg(v: number, decimals = 2) {
  const body = Math.abs(v).toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${v < 0 ? '−' : ''}${body} кг`
}

/**
 * Просте число. Мінус — типографський (U+2212), як в `uah()` і `kg()`.
 *
 * Три форматери мусять писати мінус ОДНАКОВО, бо вони стоять в одному рядку. Зміряно на
 * дні надлишку (Шипинки 15.07): «= −6 150,83 ₴ · ставка -6 150,83 / 3 447,63 = -1,78407»
 * — один U+2212 від `uah()` і два U+2D від `num()` у сімнадцяти символах один від одного.
 * Зворотний бік безпечний так само, як у `kg()`: `parseNumeric()` зводить U+2212 до дефіса.
 */
export function num(v: number, decimals = 0) {
  const body = Math.abs(v).toLocaleString('uk-UA', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
  return `${v < 0 ? '−' : ''}${body}`
}

export function tonnage(kgValue: number) {
  if (kgValue >= 1000) return `${num(kgValue / 1000, 2)} т`
  return `${num(kgValue, 1)} кг`
}

export function parseDate(d: ISODate) {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function toISO(d: Date): ISODate {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function addDays(d: ISODate, n: number): ISODate {
  const dt = parseDate(d)
  dt.setDate(dt.getDate() + n)
  return toISO(dt)
}

export function shortDate(d: ISODate) {
  const dt = parseDate(d)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getDate())}.${p(dt.getMonth() + 1)}`
}

export function longDate(d: ISODate) {
  const dt = parseDate(d)
  return `${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]}`
}

export function weekday(d: ISODate) {
  return WEEKDAYS[parseDate(d).getDay()]
}

export function daysBetween(a: ISODate, b: ISODate) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

export function initials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

/** 1 день / 2 дні / 5 днів */
export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few
  return many
}

export function daysWord(n: number) {
  return `${n} ${plural(n, 'день', 'дні', 'днів')}`
}
