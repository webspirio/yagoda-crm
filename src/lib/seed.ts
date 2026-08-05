import { allocatePayout, openDebts, round2, tareWeight } from './calc'
import { addDays, toISO } from './format'
import type {
  Berry,
  ISODate,
  Payout,
  Point,
  PriceRecord,
  Reception,
  Supplier,
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
export const SEASON_START: ISODate = '2026-07-06'

export const POINTS: Point[] = [
  { id: 'p1', name: 'Лісова', village: 'с. Заріччя', isMain: true },
  { id: 'p2', name: 'Гончарі', village: 'с. Гончарівка', isMain: false },
  { id: 'p3', name: 'Дубрівка', village: 'с. Дубрівка', isMain: false },
  { id: 'p4', name: 'Соснівка', village: 'с. Соснівка', isMain: false },
]

export const BERRIES: Berry[] = [
  { id: 'b1', name: 'Малина осіння', short: 'Мал. ос.', from: '2026-07-28', to: '2026-08-04', basePrice: 118 },
  { id: 'b2', name: 'Малина літня', short: 'Мал. літ.', from: '2026-07-06', to: '2026-07-29', basePrice: 96 },
  { id: 'b3', name: 'Чорниця', short: 'Чорниця', from: '2026-07-06', to: '2026-08-01', basePrice: 112 },
  { id: 'b4', name: 'Ожина', short: 'Ожина', from: '2026-07-22', to: '2026-08-04', basePrice: 84 },
  { id: 'b5', name: 'Смородина чорна', short: 'Смородина', from: '2026-07-10', to: '2026-08-04', basePrice: 46 },
  { id: 'b6', name: 'Полуниця', short: 'Полуниця', from: '2026-07-06', to: '2026-07-16', basePrice: 68 },
]

export const TARE_TYPES: TareType[] = [
  { id: 't1', name: 'Ящик пластиковий', weight: 1.6 },
  { id: 't2', name: 'Ящик дерев’яний', weight: 1.1 },
  { id: 't3', name: 'Відро 10 л', weight: 0.35 },
  { id: 't4', name: 'Кошик', weight: 0.9 },
  { id: 't5', name: 'Лоток картонний', weight: 0.25 },
]

export const OPERATORS: Record<string, string> = {
  p1: 'Оксана Гриців',
  p2: 'Тарас Мельник',
  p3: 'Ігор Волошин',
  p4: 'Богдан Кушнір',
}

const SURNAMES = [
  'Ковальчук', 'Бондаренко', 'Ткачук', 'Мельничук', 'Шевченко', 'Кравець', 'Панасюк',
  'Гуменюк', 'Романюк', 'Савчук', 'Лисенко', 'Даниленко', 'Марчук', 'Олійник',
  'Гнатюк', 'Стельмах', 'Дудник', 'Пилипчук', 'Захарчук', 'Юрчук', 'Мазур',
  'Ярема', 'Сидорук', 'Гаврилюк', 'Чорний', 'Демчук', 'Левчук', 'Приймак',
  'Бабій', 'Козак', 'Наконечний', 'Терещук', 'Хомʼяк', 'Цимбалюк', 'Швець',
  'Яценко', 'Бортник', 'Гладун', 'Дацюк', 'Іванчук', 'Кушнір', 'Лозовий',
  'Матвіїв', 'Нестерук', 'Осадчук', 'Прокопчук', 'Рудик', 'Сокіл',
]

const FIRST_M = ['Микола', 'Петро', 'Василь', 'Іван', 'Андрій', 'Богдан', 'Роман', 'Степан', 'Юрій', 'Олег']
const FIRST_F = ['Марія', 'Ольга', 'Ганна', 'Оксана', 'Наталія', 'Ірина', 'Леся', 'Софія', 'Тетяна', 'Віра']

const VILLAGES = ['с. Заріччя', 'с. Гончарівка', 'с. Дубрівка', 'с. Соснівка', 'с. Липники', 'с. Мокре', 'с. Осова', 'с. Кам’янка']

const NOTES = [
  'Возить зранку, до 9:00',
  'Здає разом із сусідкою',
  'Своя тара — ящики',
  'Просить розрахунок на картку',
  'Дзвонити перед приїздом',
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

export function buildSeed(): SeedData {
  const rnd = mulberry32(20260804)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]
  const between = (a: number, b: number) => a + rnd() * (b - a)
  const int = (a: number, b: number) => Math.floor(between(a, b + 1))

  /* ---------------- suppliers ---------------- */
  const suppliers: Supplier[] = []
  const usedNames = new Set<string>()
  for (let i = 0; i < 52; i++) {
    let name = ''
    do {
      const female = rnd() > 0.45
      name = `${pick(SURNAMES)} ${pick(female ? FIRST_F : FIRST_M)}`
    } while (usedNames.has(name))
    usedNames.add(name)

    const wholesale = rnd() < 0.16
    const homePointId = POINTS[Math.min(3, Math.floor(rnd() * (rnd() < 0.45 ? 1.4 : 4)))].id
    suppliers.push({
      id: `s${i + 1}`,
      name,
      phone: `+380${int(50, 99)}${pad(int(1000000, 9999999), 7)}`,
      village: pick(VILLAGES),
      homePointId,
      wholesale,
      bonus: wholesale ? pick([3, 4, 5, 5, 6]) : 0,
      note: rnd() < 0.18 ? pick(NOTES) : undefined,
      createdAt: SEASON_START,
    })
  }

  /* ---------------- days ---------------- */
  const days: ISODate[] = []
  for (let d = SEASON_START; d <= TODAY; d = addDays(d, 1)) days.push(d)

  /* ---------------- day prices ---------------- */
  const prices: PriceRecord[] = []
  const priceMap = new Map<string, number>() // `${date}|${pointId}|${berryId}` -> price
  let priceSeq = 0
  const drift = new Map<string, number>()

  for (const day of days) {
    for (const berry of BERRIES) {
      if (day < berry.from || day > berry.to) continue
      const prev = drift.get(berry.id) ?? 0
      const step = Math.round(between(-4, 4))
      const trend = berry.id === 'b1' ? 1 : -0.4 // autumn raspberry climbing, rest easing off
      const next = Math.max(-18, Math.min(22, prev + step + trend))
      drift.set(berry.id, next)

      for (const point of POINTS) {
        if (point.id === 'p4' && day < '2026-07-28') continue
        const local = point.isMain ? 0 : Math.round(between(-3, 1))
        const price = Math.max(20, Math.round(berry.basePrice + next + local))
        priceMap.set(`${day}|${point.id}|${berry.id}`, price)
        prices.push({
          id: `pr${++priceSeq}`,
          date: day,
          pointId: point.id,
          berryId: berry.id,
          price,
          time: '07:30',
          author: point.isMain ? 'Оксана Гриців' : OPERATORS[point.id],
        })

        // an intraday correction now and then — exactly the thing Excel loses
        if (rnd() < 0.12) {
          const bump = pick([5, 5, -5, 3, 8])
          const corrected = Math.max(20, price + bump)
          priceMap.set(`${day}|${point.id}|${berry.id}`, corrected)
          prices.push({
            id: `pr${++priceSeq}`,
            date: day,
            pointId: point.id,
            berryId: berry.id,
            price: corrected,
            time: pick(['12:40', '13:15', '14:00', '15:30']),
            author: 'Оксана Гриців',
            reason: bump > 0 ? 'Підняли — конкуренти в Гончарівці' : 'Знизили — багато мʼякої ягоди',
          })
        }
      }
    }
  }

  /* ---------------- receptions ---------------- */
  const receptions: Reception[] = []
  let recSeq = 0

  for (const day of days) {
    const isToday = day === TODAY
    for (const point of POINTS) {
      if (point.id === 'p4' && day < '2026-07-28') continue
      const activeBerries = BERRIES.filter((b) => day >= b.from && day <= b.to)
      if (!activeBerries.length) continue

      const base = point.isMain ? int(15, 23) : int(6, 13)
      const count = isToday ? Math.max(3, Math.round(base * 0.45)) : base
      const pool = suppliers.filter((s) => s.homePointId === point.id || rnd() < 0.12)
      if (!pool.length) continue

      for (let i = 0; i < count; i++) {
        const supplier = pick(pool)
        const berry = pick(activeBerries)
        const price = priceMap.get(`${day}|${point.id}|${berry.id}`)
        if (!price) continue

        const hour = isToday ? int(7, 12) : int(7, 19)
        const time = `${pad(hour, 2)}:${pad(int(0, 59), 2)}`

        // container mix
        const tareType = supplier.wholesale ? TARE_TYPES[0] : pick(TARE_TYPES)
        const tareCount = supplier.wholesale ? int(8, 34) : int(1, 7)
        const tare = [{ tareId: tareType.id, count: tareCount }]
        const tw = tareWeight(tare, TARE_TYPES)

        const perContainer = supplier.wholesale ? between(7, 12) : between(3.5, 9)
        const net = round2(Math.max(0.4, tareCount * perContainer))
        const gross = round2(net + tw)
        const effective = price + supplier.bonus
        const amount = round2(net * effective)

        // remainder logic — no small change, or by agreement
        let paid = amount
        const roll = rnd()
        if (roll < 0.1 && amount > 400) {
          paid = Math.floor(amount / 100) * 100 // no small notes in the till
        } else if (roll < 0.3) {
          // by agreement: the rest tomorrow
          const agreed = pick([200, 300, 500, 500, 1000, 1500, 2000])
          paid =
            amount > agreed * 1.6
              ? Math.round((amount - agreed) / 10) * 10
              : Math.floor(amount / 100) * 100
        }
        if (paid < 0) paid = 0
        const debt = round2(amount - paid)

        receptions.push({
          id: `r${++recSeq}`,
          code: `Ч-${pad(recSeq)}`,
          date: day,
          time,
          pointId: point.id,
          supplierId: supplier.id,
          berryId: berry.id,
          gross,
          tare,
          tareWeight: tw,
          net,
          price,
          bonus: supplier.bonus,
          amount,
          paid: round2(paid),
          debt,
          operator: OPERATORS[point.id],
          synced: true,
        })
      }
    }
  }

  receptions.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))

  /* ---------------- payouts against old balances ---------------- */
  const payouts: Payout[] = []
  let paySeq = 0

  for (const day of days) {
    if (day === SEASON_START) continue
    // the rest is handed over when the person shows up with berries again —
    // so whoever stopped coming keeps hanging on the balance, exactly like in real life
    const priorReceptions = receptions.filter((r) => r.date <= addDays(day, -2))
    const cameToday = new Set(receptions.filter((r) => r.date === day).map((r) => r.supplierId))
    const candidates = new Set(
      priorReceptions
        .filter((r) => r.debt > 0 && cameToday.has(r.supplierId))
        .map((r) => r.supplierId),
    )

    for (const supplierId of candidates) {
      // a slow-paying quarter drags balances across weeks — that is where the tails come from
      const slow = Number(supplierId.replace(/\D/g, '')) % 4 === 0
      if (rnd() > (slow ? 0.12 : 0.45)) continue
      const open = openDebts(supplierId, priorReceptions, payouts)
      if (!open.length) continue
      // settle when the supplier next shows up, or shortly after
      const total = round2(open.reduce((s, o) => s + o.open, 0))
      const partial = rnd() < 0.2
      const amount = partial ? round2(Math.max(50, Math.round((total * between(0.3, 0.7)) / 10) * 10)) : total
      const allocations = allocatePayout(amount, open)
      if (!allocations.length) continue

      const supplier = suppliers.find((s) => s.id === supplierId)!
      payouts.push({
        id: `pay${++paySeq}`,
        code: `В-${pad(paySeq, 3)}`,
        date: day,
        time: `${pad(Math.floor(between(8, 18)), 2)}:${pad(Math.floor(between(0, 59)), 2)}`,
        pointId: supplier.homePointId,
        supplierId,
        amount: round2(allocations.reduce((s, a) => s + a.amount, 0)),
        allocations,
        operator: OPERATORS[supplier.homePointId],
        synced: true,
      })
    }
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
