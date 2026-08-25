import { describe, expect, it } from 'vitest'
import {
  CRATE_RECEIPT_THRESHOLD,
  allocateCrateReturn,
  checkCrateIssue,
  checkCrateReturn,
  checkCrateTransfer,
  crateBalance,
  crateIssueMode,
  crateRefund,
  crateShipmentDraft,
  crateStanding,
  effectiveAt,
  openCrateIssues,
  shipmentTotal,
} from './calc'
import type {
  CrateAllotment,
  CrateIssue,
  CrateReturn,
  CrateShipment,
  Reception,
  TareLine,
  Transfer,
} from './types'

/** Ящик — це РІВНО Чешка (рішення Р-1). Інші тари тут лише щоб довести, що вони не рахуються. */
const CHESHKA = 'tr_cheshka'
const PALLET_TARE = 'tr_yashchyk'

let seq = 0
const id = (p: string) => `${p}${(seq += 1)}`

function issue(over: Partial<CrateIssue> = {}): CrateIssue {
  const units = over.units ?? 10
  const mode = over.mode ?? crateIssueMode(units)
  const perUnit = over.depositPerUnit ?? (mode === 'deposit' ? 120 : 0)
  return {
    id: over.id ?? id('ci'),
    date: '2026-07-01',
    time: '09:00',
    pointId: 'p1',
    supplierId: 's1',
    units,
    mode,
    depositPerUnit: perUnit,
    depositTaken: Math.round(units * perUnit * 100) / 100,
    operatorId: 'Оксана Г.',
    ...over,
  }
}

function ret(over: Partial<CrateReturn> = {}): CrateReturn {
  const allocations = over.allocations ?? []
  return {
    id: over.id ?? id('cr'),
    date: '2026-08-01',
    time: '10:00',
    pointId: 'p1',
    supplierId: 's1',
    units: over.units ?? allocations.reduce((n, a) => n + a.units, 0),
    allocations,
    depositRefund: over.depositRefund ?? crateRefund(allocations),
    operatorId: 'Оксана Г.',
    ...over,
  }
}

function shipment(over: Partial<CrateShipment> = {}): CrateShipment {
  return {
    id: over.id ?? id('cs'),
    date: '2026-08-04',
    pointId: 'p1',
    withBerryUnits: 0,
    receptionCount: 0,
    brokenUnits: 0,
    operatorId: 'Оксана Г.',
    postedDate: '2026-08-04',
    postedTime: '20:00',
    ...over,
  }
}

function transfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: over.id ?? id('tf'),
    date: '2026-08-04',
    pointId: 'p1',
    crates: 0,
    cash: 0,
    carrier: 'Перевізник',
    sentBy: 'Керівник',
    sentTime: '18:00',
    status: 'accepted',
    ...over,
  }
}

function reception(over: Partial<Reception> & { tare: TareLine[] }): Reception {
  return {
    id: id('rc'),
    code: 'К-1',
    date: '2026-08-04',
    time: '09:00',
    pointId: 'p1',
    supplierId: 's1',
    berryId: 'b1',
    gross: 0,
    pallet: 0,
    tareWeight: 0,
    net: 0,
    price: 0,
    bonus: 0,
    amount: 0,
    paid: 0,
    debt: 0,
    carriedIn: 0,
    operator: 'Оксана Г.',
    synced: true,
    ...over,
  }
}

describe('crateIssueMode — «до 50 за кошти, після 50 за розписку» (1081)', () => {
  it('1 ящик — за кошти', () => {
    expect(crateIssueMode(1)).toBe('deposit')
  })

  it('РІВНО 50 ящиків — ще за кошти: межа включна (Q-19)', () => {
    expect(crateIssueMode(50)).toBe('deposit')
  })

  it('51 ящик — уже за розписку', () => {
    expect(crateIssueMode(51)).toBe('receipt')
  })

  it('80 ящиків із їхнього журналу — за розписку', () => {
    expect(crateIssueMode(80)).toBe('receipt')
  })

  it('поріг за замовчуванням дорівнює 50, і його можна замінити на 30', () => {
    expect(CRATE_RECEIPT_THRESHOLD).toBe(50)
    expect(crateIssueMode(40, 30)).toBe('receipt')
    expect(crateIssueMode(30, 30)).toBe('deposit')
  })
})

describe('effectiveAt — наділ це історія, а не поле на точці (1067)', () => {
  const A: CrateAllotment[] = [
    { id: 'a1', pointId: 'p1', units: 600, effectiveFrom: '2026-06-27', setBy: 'Керівник', setDate: '2026-06-27', setTime: '08:00' },
    { id: 'a2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '08:00' },
    { id: 'a3', pointId: 'p3', units: 200, effectiveFrom: '2026-06-27', setBy: 'Керівник', setDate: '2026-06-27', setTime: '08:00' },
  ]

  it('14.07 діє наділ 600', () => {
    expect(effectiveAt(A, 'p1', '2026-07-14')?.units).toBe(600)
  })

  it('у сам день зміни 15.07 діє вже 800', () => {
    expect(effectiveAt(A, 'p1', '2026-07-15')?.units).toBe(800)
  })

  it('04.08 діє 800 — пізнішого запису немає', () => {
    expect(effectiveAt(A, 'p1', '2026-08-04')?.units).toBe(800)
  })

  it('до першого запису наділу немає: null, а не 0', () => {
    expect(effectiveAt(A, 'p1', '2026-06-26')).toBeNull()
  })

  it('наділ іншої точки не підмішується: на p3 це 200, не 800', () => {
    expect(effectiveAt(A, 'p3', '2026-08-04')?.units).toBe(200)
  })

  it('порядок записів у масиві не має значення: перевернутий масив дає ті самі 800', () => {
    expect(effectiveAt([...A].reverse(), 'p1', '2026-08-04')?.units).toBe(800)
  })
})

describe('openCrateIssues — FIFO: найстаріша видача перша (1087)', () => {
  it('дві видачі різних днів ідуть від старішої: 12.07 перед 20.07', () => {
    const older = issue({ id: 'ci-old', date: '2026-07-12', units: 20 })
    const newer = issue({ id: 'ci-new', date: '2026-07-20', units: 30 })
    const open = openCrateIssues('s1', [newer, older], [])
    expect(open.map((x) => x.issue.id)).toEqual(['ci-old', 'ci-new'])
    expect(open.map((x) => x.open)).toEqual([20, 30])
  })

  it('в один день упорядковує за часом: 08:15 перед 17:40', () => {
    const late = issue({ id: 'ci-late', date: '2026-07-12', time: '17:40', units: 5 })
    const early = issue({ id: 'ci-early', date: '2026-07-12', time: '08:15', units: 7 })
    expect(openCrateIssues('s1', [late, early], []).map((x) => x.issue.id)).toEqual([
      'ci-early',
      'ci-late',
    ])
  })

  it('погашене повністю зникає зі списку: з 20 повернули всі 20', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const r = ret({ allocations: [{ issueId: 'ci-1', units: 20, perUnit: 120, amount: 2400 }] })
    expect(openCrateIssues('s1', [i1], [r])).toEqual([])
  })

  it('погашене частково лишається із залишком 13 із 20', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const r = ret({ allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }] })
    const open = openCrateIssues('s1', [i1], [r])
    expect(open).toHaveLength(1)
    expect(open[0].open).toBe(13)
  })

  it('сторнована видача не рахується взагалі: лишається 0 відкритих', () => {
    const i1 = issue({ id: 'ci-1', units: 20, voidedDate: '2026-07-02', voidedBy: 'Керівник' })
    expect(openCrateIssues('s1', [i1], [])).toEqual([])
  })

  it('сторноване повернення не гасить видачу: назад 20 із 20 відкритих', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const r = ret({
      allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }],
      voidedDate: '2026-08-02',
      voidedBy: 'Керівник',
    })
    expect(openCrateIssues('s1', [i1], [r])[0].open).toBe(20)
  })

  it('чужа людина не потрапляє: у s2 своя видача на 9', () => {
    const mine = issue({ id: 'ci-1', supplierId: 's1', units: 20 })
    const other = issue({ id: 'ci-2', supplierId: 's2', units: 9 })
    expect(openCrateIssues('s2', [mine, other], []).map((x) => x.open)).toEqual([9])
  })
})

describe('allocateCrateReturn — часткове повернення за ТИМ САМИМ завдатком (1101)', () => {
  it('брала 20 за кошти, вертає 7 → одна проводка на 840,00 ₴', () => {
    const i1 = issue({ id: 'ci-1', units: 20, depositPerUnit: 120, depositTaken: 2400 })
    const open = openCrateIssues('s1', [i1], [])
    const alloc = allocateCrateReturn(7, open)
    expect(alloc).toEqual([{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }])
    expect(crateRefund(alloc)).toBe(840)
  })

  it('решта 13 ящиків лишається в людини і коштує 1 560,00 ₴', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const r = ret({ allocations: allocateCrateReturn(7, openCrateIssues('s1', [i1], [])) })
    const b = crateBalance('s1', [i1], [r])
    expect(b.units).toBe(13)
    expect(b.depositHeld).toBe(1560)
  })

  it('ціна ящика змінилася зі 120 на 130 — вертаємо за СТАРОЮ: 10 × 120 = 1 200,00', () => {
    const old = issue({ id: 'ci-old', date: '2026-07-01', units: 10, depositPerUnit: 120, depositTaken: 1200 })
    const fresh = issue({ id: 'ci-new', date: '2026-08-01', units: 10, depositPerUnit: 130, depositTaken: 1300 })
    const alloc = allocateCrateReturn(10, openCrateIssues('s1', [old, fresh], []))
    expect(alloc).toEqual([{ issueId: 'ci-old', units: 10, perUnit: 120, amount: 1200 }])
    expect(crateRefund(alloc)).toBe(1200)
  })

  it('повернення через дві видачі: 15 = 10×120 + 5×130 = 1 850,00', () => {
    const old = issue({ id: 'ci-old', date: '2026-07-01', units: 10, depositPerUnit: 120, depositTaken: 1200 })
    const fresh = issue({ id: 'ci-new', date: '2026-08-01', units: 10, depositPerUnit: 130, depositTaken: 1300 })
    const alloc = allocateCrateReturn(15, openCrateIssues('s1', [old, fresh], []))
    expect(alloc).toEqual([
      { issueId: 'ci-old', units: 10, perUnit: 120, amount: 1200 },
      { issueId: 'ci-new', units: 5, perUnit: 130, amount: 650 },
    ])
    expect(crateRefund(alloc)).toBe(1850)
  })

  it('брала 20 за кошти і 70 за розписку — за перші 7 платимо 840,00', () => {
    const money = issue({ id: 'ci-money', date: '2026-07-01', units: 20 })
    const paper = issue({ id: 'ci-paper', date: '2026-07-20', units: 70 })
    expect(paper.mode).toBe('receipt')
    const alloc = allocateCrateReturn(7, openCrateIssues('s1', [money, paper], []))
    expect(crateRefund(alloc)).toBe(840)
  })

  it('розписка грошей не повертає: 70 ящиків після завдаткових 20 дають 0,00', () => {
    const money = issue({ id: 'ci-money', date: '2026-07-01', units: 20 })
    const paper = issue({ id: 'ci-paper', date: '2026-07-20', units: 70 })
    const alloc = allocateCrateReturn(90, openCrateIssues('s1', [money, paper], []))
    expect(alloc.map((a) => a.amount)).toEqual([2400, 0])
    expect(crateRefund(alloc)).toBe(2400)
  })

  it('вертає більше, ніж брала: розкладеться лише 20, а не 25 — різницю мусить побачити викликач', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const alloc = allocateCrateReturn(25, openCrateIssues('s1', [i1], []))
    expect(alloc.reduce((n, a) => n + a.units, 0)).toBe(20)
  })

  it('нуль і мінус нічого не розкладають', () => {
    const open = openCrateIssues('s1', [issue({ units: 20 })], [])
    expect(allocateCrateReturn(0, open)).toEqual([])
    expect(allocateCrateReturn(-5, open)).toEqual([])
  })

  it('копійки: 7 ящиків по 33,33 ₴ дають 233,31, а не 233,3099999', () => {
    const i1 = issue({ id: 'ci-1', units: 20, depositPerUnit: 33.33, depositTaken: 666.6 })
    expect(crateRefund(allocateCrateReturn(7, openCrateIssues('s1', [i1], [])))).toBe(233.31)
  })
})

describe('crateBalance — журнал клієнтки: 275 узято, 80 повернуто, 195 у полі', () => {
  /** 15 рядків, 13 людей — рівно як в аркуші `Ящики` (H2: двоє стоять у двох рядках). */
  const LEDGER: [string, number][] = [
    ['s1', 30], ['s2', 50], ['s3', 3], ['s4', 10], ['s5', 80],
    ['s6', 10], ['s7', 30], ['s8', 3], ['s9', 15], ['s9', 5],
    ['s10', 10], ['s7', 10], ['s11', 8], ['s12', 1], ['s13', 10],
  ]
  const issues = LEDGER.map(([supplierId, units], i) =>
    issue({ id: `L${i + 1}`, supplierId, units, date: '2026-07-05', time: `0${i % 9}:30` }),
  )
  const returns = [
    ret({ supplierId: 's1', allocations: [{ issueId: 'L1', units: 30, perUnit: 120, amount: 3600 }] }),
    ret({ supplierId: 's2', allocations: [{ issueId: 'L2', units: 50, perUnit: 120, amount: 6000 }] }),
  ]

  it('усього видано 275 ящиків', () => {
    // Той самий клас, що й у canonical-crates: раніше цей рядок додавав числа САМОГО
    // масиву і був би зелений, навіть якби `crateBalance()` не вмів рахувати `taken`
    // взагалі. Тепер 275 віддає рушій, а форма аркуша (15 рядків, 13 людей) стоїть окремо.
    const everyone = [...new Set(LEDGER.map(([s]) => s))]
    expect(LEDGER).toHaveLength(15)
    expect(everyone).toHaveLength(13)
    expect(everyone.reduce((n, s) => n + crateBalance(s, issues, returns).taken, 0)).toBe(275)
  })

  it('людина з двох рядків має баланс 40, а не 30: 30 + 10', () => {
    const b = crateBalance('s7', issues, returns)
    expect(b.taken).toBe(40)
    expect(b.units).toBe(40)
    expect(b.depositHeld).toBe(4800)
  })

  it('друга така людина має 20: 15 + 5', () => {
    expect(crateBalance('s9', issues, returns).units).toBe(20)
  })

  it('хто повернув усе, має нуль ящиків і нуль завдатку', () => {
    const b = crateBalance('s1', issues, returns)
    expect(b.taken).toBe(30)
    expect(b.returned).toBe(30)
    expect(b.units).toBe(0)
    expect(b.depositHeld).toBe(0)
    expect(b.open).toEqual([])
  })

  it('80 ящиків за розписку не дають ані копійки завдатку', () => {
    const b = crateBalance('s5', issues, returns)
    expect(b.units).toBe(80)
    expect(b.receipt).toBe(80)
    expect(b.deposit).toBe(0)
    expect(b.depositHeld).toBe(0)
  })

  it('drift дорівнює нулю, поки повернення розкладені рівно', () => {
    expect(crateBalance('s1', issues, returns).drift).toBe(0)
  })

  it('повернення, у якому units не дорівнює сумі allocations, дає drift −3', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const broken = ret({
      units: 10,
      allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }],
    })
    expect(crateBalance('s1', [i1], [broken]).drift).toBe(-3)
  })
})

describe('crateStanding — «і в сумі воно сходиться 600» (1046)', () => {
  const allotments: CrateAllotment[] = [
    { id: 'a1', pointId: 'p1', units: 600, effectiveFrom: '2026-06-27', setBy: 'Керівник', setDate: '2026-06-27', setTime: '08:00' },
    { id: 'a2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '08:00' },
  ]

  it('наскрізний приклад 04.08: 800 = 341 пустих + 195 у людей + 264 у нас', () => {
    const issues = [issue({ id: 'i1', date: '2026-07-05', units: 275 })]
    const returns = [
      ret({ date: '2026-07-20', units: 80, allocations: [{ issueId: 'i1', units: 80, perUnit: 120, amount: 9600 }] }),
    ]
    const shipments = [
      shipment({ date: '2026-08-03', withBerryUnits: 89, receptionCount: 27 }),
      shipment({ date: '2026-08-04', withBerryUnits: 173, brokenUnits: 2, receptionCount: 3 }),
    ]
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues,
      returns,
      shipments,
      transfers: [],
    })
    expect(st.allotment).toBe(800)
    expect(st.inField).toBe(195)
    expect(st.atBase).toBe(264)
    expect(st.onHand).toBe(341)
    expect(st.shortfall).toBe(459)
    expect(st.onHand! + st.inField + st.atBase).toBe(800)
  })

  it('переказ у дорозі НЕ рухає наділ: 40 ящиків у стані sent лишають 264 у нас', () => {
    const shipments = [shipment({ date: '2026-08-04', withBerryUnits: 264 })]
    const base = { pointId: 'p1', date: '2026-08-04', allotments, issues: [], returns: [], shipments }
    expect(crateStanding({ ...base, transfers: [transfer({ crates: 40, status: 'sent' })] }).atBase).toBe(264)
    expect(crateStanding({ ...base, transfers: [transfer({ crates: 40, status: 'disputed' })] }).atBase).toBe(264)
    expect(crateStanding({ ...base, transfers: [transfer({ crates: 40, status: 'accepted' })] }).atBase).toBe(224)
  })

  it('«тільки вони підтвердили надходження — мінус змінився» (1050): 140 → 100', () => {
    const issues = [issue({ id: 'i1', date: '2026-07-05', units: 100 })]
    const shipments = [shipment({ date: '2026-08-03', withBerryUnits: 40 })]
    const base = { pointId: 'p1', date: '2026-08-04', allotments, issues, returns: [], shipments }
    expect(crateStanding({ ...base, transfers: [transfer({ crates: 40, status: 'sent' })] }).shortfall).toBe(140)
    expect(crateStanding({ ...base, transfers: [transfer({ crates: 40, status: 'accepted' })] }).shortfall).toBe(100)
  })

  it('документи пізніших днів не враховуються: станом на 03.08 у нас 89, а не 264', () => {
    const shipments = [
      shipment({ date: '2026-08-03', withBerryUnits: 89 }),
      shipment({ date: '2026-08-04', withBerryUnits: 173, brokenUnits: 2 }),
    ]
    const st = crateStanding({
      pointId: 'p1', date: '2026-08-03', allotments, issues: [], returns: [], shipments, transfers: [],
    })
    expect(st.atBase).toBe(89)
    expect(st.onHand).toBe(711)
  })

  /*
   * Той самий рядок `mine()` тримає межу дня для ВСІХ трьох масивів, але свідок у нього
   * був лише один — відправлення. Обхід фільтрів після рецензії тестів: питання «чи є в
   * наборі документ ЧУЖОГО ДНЯ саме для ЦЬОГО масиву?» для видач і повернень давало «ні».
   */
  it('видача ЗАВТРАШНЬОГО дня сьогодні в людях не стоїть: 195, а не 295', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [
        issue({ id: 'i1', date: '2026-07-05', units: 195 }),
        issue({ id: 'i2', date: '2026-08-05', units: 100 }),
      ],
      returns: [],
      shipments: [],
      transfers: [],
    })
    expect(st.inField).toBe(195)
    expect(st.onHand).toBe(605)
  })

  it('повернення ЗАВТРАШНЬОГО дня сьогоднішнього «у людей» не зменшує: 195, а не 115', () => {
    const issues = [issue({ id: 'i1', date: '2026-07-05', units: 195 })]
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues,
      returns: [
        ret({
          date: '2026-08-05',
          units: 80,
          allocations: [{ issueId: 'i1', units: 80, perUnit: 120, amount: 9600 }],
        }),
      ],
      shipments: [],
      transfers: [],
    })
    expect(st.inField).toBe(195)
    expect(st.onHand).toBe(605)
  })

  it('на 14.07 діє наділ 600, і порожніх 600', () => {
    const st = crateStanding({
      pointId: 'p1', date: '2026-07-14', allotments, issues: [], returns: [], shipments: [], transfers: [],
    })
    expect(st.allotment).toBe(600)
    expect(st.onHand).toBe(600)
  })

  it('без наділу onHand це null, а shortfall усе одно рахується: 30', () => {
    const st = crateStanding({
      pointId: 'p9',
      date: '2026-08-04',
      allotments,
      issues: [issue({ pointId: 'p9', units: 30 })],
      returns: [],
      shipments: [],
      transfers: [],
    })
    expect(st.allotment).toBeNull()
    expect(st.onHand).toBeNull()
    expect(st.shortfall).toBe(30)
  })

  it('сторноване відправлення не рахується: у нас 0, порожніх 800', () => {
    const shipments = [
      shipment({ withBerryUnits: 173, brokenUnits: 2, voidedDate: '2026-08-04', voidedBy: 'Керівник' }),
    ]
    const st = crateStanding({
      pointId: 'p1', date: '2026-08-04', allotments, issues: [], returns: [], shipments, transfers: [],
    })
    expect(st.atBase).toBe(0)
    expect(st.onHand).toBe(800)
  })

  it('чужа точка не підмішується: 500 ящиків на p3 не чіпають p1', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [issue({ pointId: 'p3', units: 500 })],
      returns: [],
      shipments: [shipment({ pointId: 'p3', withBerryUnits: 500 })],
      transfers: [],
    })
    expect(st.inField).toBe(0)
    expect(st.atBase).toBe(0)
    expect(st.onHand).toBe(800)
  })

  /**
   * `Q-25`, знайдено при реалізації: людина взяла ящики на p1 і повернула на p3. Модель це
   * ДОЗВОЛЯЄ, і ящики переїжджають між наділами: p1 лишається з 20 «у людей», яких там уже
   * немає, а p3 отримує −20, хоч нікому нічого не видавала. Тест пришпилює цю поведінку,
   * щоб вона була рішенням, а не випадковістю: у стенограмі цього випадку немає взагалі.
   */
  it('Q-25: узяла на p1, повернула на p3 — p1 має 20 у людей, p3 має −20', () => {
    const issues = [issue({ id: 'i1', pointId: 'p1', units: 20 })]
    const returns = [
      ret({
        pointId: 'p3',
        units: 20,
        allocations: [{ issueId: 'i1', units: 20, perUnit: 120, amount: 2400 }],
      }),
    ]
    const at = (pointId: string) =>
      crateStanding({
        pointId,
        date: '2026-08-04',
        allotments,
        issues,
        returns,
        shipments: [],
        transfers: [],
      })
    expect(at('p1').inField).toBe(20)
    expect(at('p3').inField).toBe(-20)
    // А баланс самої людини мережевий — і він нуль, як і має бути.
    expect(crateBalance('s1', issues, returns).units).toBe(0)
  })

  it('бій входить у «у нас» нарівні з ягодою: 173 + 2 = 175 (977)', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [],
      returns: [],
      shipments: [shipment({ withBerryUnits: 173, brokenUnits: 2 })],
      transfers: [],
    })
    expect(st.atBase).toBe(175)
    expect(st.shipped).toBe(175)
  })
})

describe('crateShipmentDraft — кількість рахує система, не приймальник (1115)', () => {
  it('три квитанції на 60 + 80 + 33 дають 173 ящики', () => {
    const receptions = [
      reception({ tare: [{ tareId: CHESHKA, count: 60 }] }),
      reception({ tare: [{ tareId: CHESHKA, count: 80 }] }),
      reception({ tare: [{ tareId: CHESHKA, count: 33 }] }),
    ]
    const d = crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA })
    expect(d.withBerryUnits).toBe(173)
    expect(d.receptionCount).toBe(3)
  })

  it('інша тара не рахується ящиком: 40 Чешок і 99 «Ящиків» дають 40', () => {
    const receptions = [
      reception({ tare: [{ tareId: CHESHKA, count: 40 }, { tareId: PALLET_TARE, count: 99 }] }),
    ]
    expect(
      crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA })
        .withBerryUnits,
    ).toBe(40)
  })

  it('кілька ліній тари в одній квитанції складаються: 20 + 15 = 35', () => {
    const receptions = [
      reception({ tare: [{ tareId: CHESHKA, count: 20 }, { tareId: CHESHKA, count: 15 }] }),
    ]
    expect(
      crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA })
        .withBerryUnits,
    ).toBe(35)
  })

  it('інший день і інша точка не потрапляють: лишається 60 з однієї квитанції', () => {
    const receptions = [
      reception({ tare: [{ tareId: CHESHKA, count: 60 }] }),
      reception({ date: '2026-08-03', tare: [{ tareId: CHESHKA, count: 89 }] }),
      reception({ pointId: 'p3', tare: [{ tareId: CHESHKA, count: 15 }] }),
    ]
    const d = crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA })
    expect(d.withBerryUnits).toBe(60)
    expect(d.receptionCount).toBe(1)
  })

  it('день без квитанцій дає 0 ящиків із 0 квитанцій, а не NaN', () => {
    const d = crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions: [], crateTareId: CHESHKA })
    expect(d.withBerryUnits).toBe(0)
    expect(d.receptionCount).toBe(0)
    expect(Number.isNaN(d.withBerryUnits)).toBe(false)
  })
})

describe('shipmentTotal — «віддаємо і ті, що з ягодою, і ті, що ламані» (977)', () => {
  it('65 з ягодою і 1 бій — повертаємо 66', () => {
    expect(shipmentTotal({ withBerryUnits: 65, brokenUnits: 1 })).toBe(66)
  })

  it('бою не було — повертаємо 173', () => {
    expect(shipmentTotal({ withBerryUnits: 173, brokenUnits: 0 })).toBe(173)
  })
})

describe('checkCrateIssue — I62: видача понад наявні ящики це block', () => {
  it('на точці 341 порожній: 341 можна, 342 вже ні', () => {
    expect(checkCrateIssue(341, 341).ok).toBe(true)
    expect(checkCrateIssue(342, 341).ok).toBe(false)
    expect(checkCrateIssue(342, 341).max).toBe(341)
  })

  it('нуль і мінус не видаються', () => {
    expect(checkCrateIssue(0, 341).ok).toBe(false)
    expect(checkCrateIssue(-5, 341).ok).toBe(false)
  })

  it('дробова кількість не видається: 2,5 ящика не буває', () => {
    expect(checkCrateIssue(2.5, 341).ok).toBe(false)
  })

  it('точка без наділу не видає нічого, і максимум там null, а не 0', () => {
    expect(checkCrateIssue(1, null)).toEqual({ ok: false, max: null })
  })

  it('точка в мінусі: максимум 0, видати не можна навіть один', () => {
    expect(checkCrateIssue(1, -307)).toEqual({ ok: false, max: 0 })
  })
})

describe('checkCrateReturn — I64: повернення понад узяте це block', () => {
  it('брала 20: 20 прийняти можна, 21 вже ні', () => {
    expect(checkCrateReturn(20, 20).ok).toBe(true)
    expect(checkCrateReturn(21, 20).ok).toBe(false)
    expect(checkCrateReturn(21, 20).max).toBe(20)
  })

  it('часткове повернення 7 із 20 проходить', () => {
    expect(checkCrateReturn(7, 20).ok).toBe(true)
  })

  it('у людини нуль ящиків — прийняти нема чого', () => {
    expect(checkCrateReturn(1, 0)).toEqual({ ok: false, max: 0 })
  })

  it('дробове й нуль не приймаються', () => {
    expect(checkCrateReturn(1.5, 20).ok).toBe(false)
    expect(checkCrateReturn(0, 20).ok).toBe(false)
  })
})

/**
 * Тести, дописані ПІСЛЯ мутаційної рецензії: кожен закриває мутацію, яка вижила на
 * попередніх 60 зелених тестах. Це той самий клас прогалин, що й у фазі 3, де пʼять
 * правил не доводив жоден із 275 тестів.
 */
describe('прогалини, знайдені мутаційною рецензією', () => {
  const allotments: CrateAllotment[] = [
    { id: 'a1', pointId: 'p1', units: 600, effectiveFrom: '2026-06-27', setBy: 'Керівник', setDate: '2026-06-27', setTime: '08:00' },
    { id: 'a2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '08:00' },
  ]

  it('ДВА часткові повернення на ту саму видачу складаються: 20 − 7 − 5 = 8', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const first = ret({ allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }] })
    const second = ret({ allocations: [{ issueId: 'ci-1', units: 5, perUnit: 120, amount: 600 }] })
    const open = openCrateIssues('s1', [i1], [first, second])
    expect(open[0].open).toBe(8)
    expect(crateBalance('s1', [i1], [first, second]).depositHeld).toBe(960)
  })

  it('розклад не бере більше, ніж лишилося ВІДКРИТИМ: з 13 не можна взяти 20', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const already = ret({ allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }] })
    const alloc = allocateCrateReturn(20, openCrateIssues('s1', [i1], [already]))
    expect(alloc).toEqual([{ issueId: 'ci-1', units: 13, perUnit: 120, amount: 1560 }])
    expect(crateRefund(alloc)).toBe(1560)
  })

  it('відʼємний onHand НЕ затискається в нуль: 15.07 при наділі 600 дає −307', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-07-14',
      allotments,
      issues: [issue({ id: 'i1', date: '2026-07-05', units: 195 })],
      returns: [],
      shipments: [shipment({ date: '2026-07-14', withBerryUnits: 712 })],
      transfers: [],
    })
    expect(st.allotment).toBe(600)
    expect(st.onHand).toBe(-307)
    expect(st.shortfall).toBe(907)
  })

  it('сторнована видача не рахується у складі наділу: у людей 0, порожніх 800', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [issue({ units: 195, voidedDate: '2026-07-06', voidedBy: 'Керівник' })],
      returns: [],
      shipments: [],
      transfers: [],
    })
    expect(st.inField).toBe(0)
    expect(st.onHand).toBe(800)
  })

  it('сторноване повернення не зменшує «повернуто» в балансі: 0, а не 7', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const dead = ret({
      units: 7,
      allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }],
      voidedDate: '2026-08-02',
      voidedBy: 'Керівник',
    })
    const b = crateBalance('s1', [i1], [dead])
    expect(b.returned).toBe(0)
    expect(b.units).toBe(20)
    expect(b.drift).toBe(0)
  })

  it('сторнована видача не рахується і в «узято»: taken 0, units 0, drift 0', () => {
    const dead = issue({ id: 'ci-1', units: 20, voidedDate: '2026-07-02', voidedBy: 'Керівник' })
    const alive = issue({ id: 'ci-2', units: 5 })
    const b = crateBalance('s1', [dead, alive], [])
    expect(b.taken).toBe(5)
    expect(b.units).toBe(5)
    expect(b.depositHeld).toBe(600)
    expect(b.drift).toBe(0)
  })

  it('переказ чужої точки не повертає нам ящики: у нас лишається 264', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [],
      returns: [],
      shipments: [shipment({ withBerryUnits: 264 })],
      transfers: [transfer({ pointId: 'p3', crates: 100, status: 'accepted' })],
    })
    expect(st.atBase).toBe(264)
  })

  it('переказ ЗАВТРАШНЬОГО дня не рахується сьогодні: у нас 264, а не 164', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [],
      returns: [],
      shipments: [shipment({ withBerryUnits: 264 })],
      transfers: [transfer({ date: '2026-08-05', crates: 100, status: 'accepted' })],
    })
    expect(st.atBase).toBe(264)
  })

  it('СТОРНОВАНИЙ переказ не рахується: у нас 264, хоч у документі 100 ящиків', () => {
    const st = crateStanding({
      pointId: 'p1',
      date: '2026-08-04',
      allotments,
      issues: [],
      returns: [],
      shipments: [shipment({ withBerryUnits: 264 })],
      transfers: [
        transfer({ crates: 100, status: 'void', voidedDate: '2026-08-04', voidedBy: 'Керівник' }),
      ],
    })
    expect(st.atBase).toBe(264)
  })

  it('квитанція ПІЗНІШОГО дня не потрапляє у знімок відправлення: 60, а не 149', () => {
    const receptions = [
      reception({ tare: [{ tareId: CHESHKA, count: 60 }] }),
      reception({ date: '2026-08-05', tare: [{ tareId: CHESHKA, count: 89 }] }),
    ]
    const d = crateShipmentDraft({ date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA })
    expect(d.withBerryUnits).toBe(60)
    expect(d.receptionCount).toBe(1)
  })

  it('дробова кількість повернення відтинається донизу: 7,9 ящика це 7', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const alloc = allocateCrateReturn(7.9, openCrateIssues('s1', [i1], []))
    expect(alloc).toEqual([{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }])
  })

  it('FIFO дивиться спершу на ДАТУ, а не на час: 12.07 о 17:40 йде перед 20.07 о 08:15', () => {
    const older = issue({ id: 'ci-old', date: '2026-07-12', time: '17:40', units: 20 })
    const newer = issue({ id: 'ci-new', date: '2026-07-20', time: '08:15', units: 30 })
    expect(openCrateIssues('s1', [newer, older], []).map((x) => x.issue.id)).toEqual([
      'ci-old',
      'ci-new',
    ])
  })

  it('однакові дата й час — перемагає той, хто в журналі РАНІШЕ, а не той, у кого id менший', () => {
    // Переписано після рецензії. Попередня версія подавала [b, a] і чекала ['ci-a','ci-b'] —
    // тобто доводила АЛФАВІТ id. А id генерується Math.random(), і на двох видачах однієї
    // хвилини (людина бере 50 за кошти і 60 за розписку одним візитом) це робило суму до
    // видачі підкиданням монети: зміряно 1 000 прогонів — 493 рази 1 200,00 ₴, 507 разів 0,00.
    const first = issue({ id: 'ci-zzz', date: '2026-07-12', time: '09:00', units: 5 })
    const second = issue({ id: 'ci-aaa', date: '2026-07-12', time: '09:00', units: 6 })
    // журнал append-only: first прийшла першою, хоч її id алфавітно БІЛЬШИЙ
    expect(openCrateIssues('s1', [first, second], []).map((x) => x.issue.id)).toEqual([
      'ci-zzz',
      'ci-aaa',
    ])
  })

  it('нічия FIFO детермінована: сто прогонів з випадковими id дають ту саму виплату', () => {
    const rid = () => Math.random().toString(36).slice(2, 9)
    const seen = new Set<number>()
    for (let n = 0; n < 100; n += 1) {
      const money = issue({ id: `ci_${rid()}`, date: '2026-07-30', time: '10:15', units: 50 })
      const paper = issue({ id: `ci_${rid()}`, date: '2026-07-30', time: '10:15', units: 60 })
      seen.add(crateRefund(allocateCrateReturn(10, openCrateIssues('s1', [money, paper], []))))
    }
    expect([...seen]).toEqual([1200])
  })


  it('повна нічия — та сама дата дії І той самий час ухвалення: перемагає ОСТАННІЙ у журналі', () => {
    // Знайдено на реальному прогоні стора: годинник у тестах прибитий, тому дві правки в
    // одну хвилину збігаються і за setDate, і за setTime. Перша версія розривала таку нічию
    // по id, а id — це Math.random(): результат був то 800, то 900. Журнал append-only, тому
    // «останній у масиві» і є «ухвалений останнім».
    const tie: CrateAllotment[] = [
      { id: 'a-x', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '12:30' },
      { id: 'a-y', pointId: 'p1', units: 900, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '12:30' },
    ]
    expect(effectiveAt(tie, 'p1', '2026-08-04')?.units).toBe(900)
    expect(effectiveAt(tie, 'p1', '2026-08-04')?.id).toBe('a-y')
  })

  it('два наділи з ОДНІЄЮ датою дії: перемагає пізніше ухвалений — 900, не 800', () => {
    const same: CrateAllotment[] = [
      { id: 'a2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '08:00' },
      { id: 'a3', pointId: 'p1', units: 900, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '19:20' },
    ]
    expect(effectiveAt(same, 'p1', '2026-08-04')?.units).toBe(900)
    expect(effectiveAt([...same].reverse(), 'p1', '2026-08-04')?.units).toBe(900)
  })

  it('видача з відʼємним залишком у список відкритих не потрапляє', () => {
    const i1 = issue({ id: 'ci-1', units: 5 })
    const over = ret({ units: 8, allocations: [{ issueId: 'ci-1', units: 8, perUnit: 120, amount: 960 }] })
    expect(openCrateIssues('s1', [i1], [over])).toEqual([])
  })

  it('копійки складаються по видачах, а не після суми: 33,33 × 7 двічі = 466,62', () => {
    const a = issue({ id: 'ci-a', date: '2026-07-01', units: 7, depositPerUnit: 33.33, depositTaken: 233.31 })
    const b = issue({ id: 'ci-b', date: '2026-07-02', units: 7, depositPerUnit: 33.33, depositTaken: 233.31 })
    expect(crateBalance('s1', [a, b], []).depositHeld).toBe(466.62)
  })

  it('склад наділу рахує повернення за units документа: drift не ховає ящиків', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    const broken = ret({ units: 10, allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }] })
    const st = crateStanding({
      pointId: 'p1', date: '2026-08-04', allotments,
      issues: [i1], returns: [broken], shipments: [], transfers: [],
    })
    expect(st.inField).toBe(10)
    expect(crateBalance('s1', [i1], [broken]).drift).toBe(-3)
  })
})

/**
 * Пʼять мутацій пережили рецензію, бо вони ЕКВІВАЛЕНТНІ — але еквівалентні лише поки
 * документ узгоджений сам із собою. Ці два тести кажуть, ЯКЕ поле виграє, коли поля
 * розходяться. У їхньому файлі це не гіпотетика: 20 із 60 клітинок `Залишок` не
 * сходяться зі своїм же рядком (`PART C 3`).
 */
describe('джерело істини, коли поля документа розходяться', () => {
  it('завдаток рахується зі ЗНІМКА ціни, а не з depositTaken: 840,00, попри 9 999 у полі', () => {
    const bad = issue({ id: 'ci-1', units: 20, depositPerUnit: 120, depositTaken: 9999 })
    expect(crateBalance('s1', [bad], []).depositHeld).toBe(2400)
    expect(crateRefund(allocateCrateReturn(7, openCrateIssues('s1', [bad], [])))).toBe(840)
  })

  it('розписка з ненульовою ціною завдатку не робить нас винними: 0,00, не 9 600,00', () => {
    const wrong = issue({ id: 'ci-1', units: 80, mode: 'receipt', depositPerUnit: 120, depositTaken: 0 })
    expect(crateBalance('s1', [wrong], []).depositHeld).toBe(0)
  })

  it('за проведене повернення платить його ВЛАСНА сума, а не перерахунок: 500,00, не 840,00', () => {
    const stored = [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 500 }]
    expect(crateRefund(stored)).toBe(500)
  })
})

/**
 * Другий раунд мутаційної рецензії: те, чого не побачили чотири перші лінзи.
 * Найгостріше тут перше — інваріант `I69` не тримався в коді НІЧИМ, він був живий лише
 * тому, що ніхто не написав `reportedCrates`. Правило, яке тримається на тому, що його
 * ніхто не порушив, — це не правило.
 */
describe('прогалини другого раунду', () => {
  const allotments: CrateAllotment[] = [
    { id: 'a2', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '08:00' },
  ]
  const standing = (transfers: Transfer[], shipments = [shipment({ withBerryUnits: 264 })]) =>
    crateStanding({ pointId: 'p1', date: '2026-08-04', allotments, issues: [], returns: [], shipments, transfers })

  it('I69: цифра, яку назвала точка, у формулу НЕ входить — 164, а не 204', () => {
    const st = standing([transfer({ crates: 100, reportedCrates: 60, status: 'accepted' })])
    expect(st.returnedToPoint).toBe(100)
    expect(st.atBase).toBe(164)
  })

  it('I69: заявка «не сходиться» з числом точки не рухає нічого', () => {
    const st = standing([
      transfer({ crates: 20, reportedCrates: 18, disputeNote: 'двох ящиків не було', status: 'disputed' }),
    ])
    expect(st.returnedToPoint).toBe(0)
    expect(st.atBase).toBe(264)
  })

  it('розклад «у нас» сходиться сам із собою: 264 − 100 = 164', () => {
    const st = standing([
      transfer({ crates: 100, status: 'accepted' }),
      transfer({ crates: 40, status: 'sent' }),
    ])
    expect(st.shipped).toBe(264)
    expect(st.returnedToPoint).toBe(100)
    expect(st.shipped - st.returnedToPoint).toBe(st.atBase)
  })

  it('приймальник перемкнув спосіб РУКАМИ: 20 ящиків за розписку дають 0,00 ₴', () => {
    const manual = issue({ id: 'ci-1', units: 20, mode: 'receipt', depositPerUnit: 0, depositTaken: 0 })
    const b = crateBalance('s1', [manual], [])
    expect(b.receipt).toBe(20)
    expect(b.deposit).toBe(0)
    expect(b.depositHeld).toBe(0)
  })

  it('приймальник перемкнув навпаки: 80 ящиків за кошти дають 9 600,00 ₴', () => {
    const manual = issue({ id: 'ci-1', units: 80, mode: 'deposit', depositPerUnit: 120, depositTaken: 9600 })
    const b = crateBalance('s1', [manual], [])
    expect(b.deposit).toBe(80)
    expect(b.receipt).toBe(0)
    expect(b.depositHeld).toBe(9600)
  })

  it('список відкритих видач віддається цілим: два рядки, 13 і 70, у порядку FIFO', () => {
    const first = issue({ id: 'ci-1', date: '2026-07-01', units: 20 })
    const second = issue({ id: 'ci-2', date: '2026-07-20', units: 70 })
    const already = ret({ allocations: [{ issueId: 'ci-1', units: 7, perUnit: 120, amount: 840 }] })
    const b = crateBalance('s1', [first, second], [already])
    expect(b.open).toHaveLength(2)
    expect(b.open.map((x) => x.issue.id)).toEqual(['ci-1', 'ci-2'])
    expect(b.open.map((x) => x.open)).toEqual([13, 70])
    expect(b.open.map((x) => x.issue.mode)).toEqual(['deposit', 'receipt'])
  })

  it('ящиком може бути інша тара, якщо її назвати: 12 Лубʼянок замість 40 Чешок', () => {
    const receptions = [
      reception({
        tare: [
          { tareId: CHESHKA, count: 40 },
          { tareId: 'tr_lubianka', count: 12 },
        ],
      }),
    ]
    const asLubianka = crateShipmentDraft({
      date: '2026-08-04', pointId: 'p1', receptions, crateTareId: 'tr_lubianka',
    })
    expect(asLubianka.withBerryUnits).toBe(12)
    const asCheshka = crateShipmentDraft({
      date: '2026-08-04', pointId: 'p1', receptions, crateTareId: CHESHKA,
    })
    expect(asCheshka.withBerryUnits).toBe(40)
  })
})

describe('прогалини критика (ящики)', () => {
  it('пізніший ДЕНЬ ухвалення перемагає пізніший час доби попереднього дня', () => {
    const same: CrateAllotment[] = [
      { id: 'a-early-day-late-hour', pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-15', setTime: '19:20' },
      { id: 'a-late-day-early-hour', pointId: 'p1', units: 900, effectiveFrom: '2026-07-15', setBy: 'Керівник', setDate: '2026-07-16', setTime: '08:00' },
    ]
    expect(effectiveAt(same, 'p1', '2026-08-04')?.units).toBe(900)
    expect(effectiveAt([...same].reverse(), 'p1', '2026-08-04')?.units).toBe(900)
  })
})

describe('прогалини рецензії пʼятьох', () => {
  it('розписка з ненульовою ціною НЕ платить при поверненні: 0,00, а не 840,00', () => {
    // I66, друга половина. Раніше вона трималася лише на тому, що стор пише 0 — тобто рівно
    // на тому, що мутаційна рецензія вже визнала недостатнім у сусідній функції.
    const wrong = issue({ id: 'ci-1', units: 80, mode: 'receipt', depositPerUnit: 120, depositTaken: 0 })
    const alloc = allocateCrateReturn(7, openCrateIssues('s1', [wrong], []))
    expect(alloc[0].perUnit).toBe(0)
    expect(crateRefund(alloc)).toBe(0)
  })

  it('нечислова кількість не будує проводок: NaN дає порожній розклад', () => {
    const i1 = issue({ id: 'ci-1', units: 20 })
    expect(allocateCrateReturn(Number.NaN, openCrateIssues('s1', [i1], []))).toEqual([])
    expect(allocateCrateReturn(Number.POSITIVE_INFINITY, openCrateIssues('s1', [i1], []))).toEqual([])
  })
})

describe('checkCrateTransfer — база повертає лише те, що тримає', () => {
  it('у нас 264 — 264 повернути можна, 459 вже ні', () => {
    expect(checkCrateTransfer(264, 264).ok).toBe(true)
    expect(checkCrateTransfer(459, 264)).toEqual({ ok: false, max: 264 })
  })

  it('нуль ящиків у переказі валідний: везуть самі гроші', () => {
    expect(checkCrateTransfer(0, 264).ok).toBe(true)
  })

  it('дробове й відʼємне не приймаються, а відʼємний atBase дає максимум 0', () => {
    expect(checkCrateTransfer(2.5, 264).ok).toBe(false)
    expect(checkCrateTransfer(-1, 264).ok).toBe(false)
    expect(checkCrateTransfer(1, -195)).toEqual({ ok: false, max: 0 })
  })

  it('переказ ящиків днем прийняття, а не відправлення', () => {
    const allotments: CrateAllotment[] = [
      { id: 'a', pointId: 'p1', units: 800, effectiveFrom: '2026-06-27', setBy: 'Керівник', setDate: '2026-06-27', setTime: '08:00' },
    ]
    const base = { pointId: 'p1', allotments, issues: [], returns: [], shipments: [shipment({ date: '2026-08-03', withBerryUnits: 264 })] }
    const t = transfer({ date: '2026-08-03', crates: 100, status: 'accepted', acceptedDate: '2026-08-04' })
    expect(crateStanding({ ...base, date: '2026-08-03', transfers: [t] }).atBase).toBe(264)
    expect(crateStanding({ ...base, date: '2026-08-04', transfers: [t] }).atBase).toBe(164)
  })
})
