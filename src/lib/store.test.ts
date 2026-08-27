import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cashStanding, crateBalance, crateStanding } from './calc'
import { useStore } from './store'
import { CASH_BOOK_FROM, TODAY } from './seed'
import type { ISODate } from './types'

/**
 * Годинник прибитий свідомо. `setPrice`/`setPriceEverywhere` штампують `nowTime()` —
 * реальний час пристрою, — а `priceFor()` бере запис із НАЙБІЛЬШИМ `time`. Ранкові
 * ціни сіду стоять на 07:30, тому з живим годинником ці тести були б зелені вдень і
 * ЧЕРВОНІ між 00:00 і 07:29: зміряно — о 06:30 `priceFor` віддає 130 замість 151.
 * Перевірка, що залежить від часу доби, — це найгірший вид червоного, бо вона вчить
 * не вірити гейту.
 */
describe('setPriceEverywhere', () => {
  beforeAll(() => vi.useFakeTimers({ toFake: ['Date'] }))
  afterAll(() => vi.useRealTimers())
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
  })

  // ПЕРЕБАЗОВАНО проти docs/15 З6 крок 1: там тест іде по `points.filter(p => p.active)`,
  // тобто вимагає загальну ціну й на складі. Склад приймає ягоду за ОПТОВИМИ цінами
  // (M37), і наскільки вони вищі — клієнт не називала (Q-17 відкрите; +8 % у сіді наша
  // оцінка). Один клік «загальної» стирав би цю надбавку назавжди. Тому межа — пункти
  // прийому, а склад лишається окремою клітинкою.
  it('ставить одну ціну на всі активні пункти прийому', () => {
    const st = useStore.getState()
    const reception = st.points.filter((p) => p.active && p.kind === 'reception')
    expect(reception.length).toBe(5)
    st.setPriceEverywhere({ date: TODAY, berryId: 'v_mal_1', price: 151, author: 'Керівник' })
    const after = useStore.getState()
    for (const p of reception) {
      expect(after.priceFor(TODAY, p.id, 'v_mal_1'), p.name).toBe(151)
    }
  })

  it('оптову ціну складу «загальна» не стирає', () => {
    const st = useStore.getState()
    const base = st.points.find((p) => p.kind === 'base')!
    const before = st.priceFor(TODAY, base.id, 'v_mal_1')
    // у сіді склад стоїть дорожче за пункт — саме це й треба захистити
    expect(before).toBeGreaterThan(st.priceFor(TODAY, 'p1', 'v_mal_1')!)
    st.setPriceEverywhere({ date: TODAY, berryId: 'v_mal_1', price: 151, author: 'Керівник' })
    expect(useStore.getState().priceFor(TODAY, base.id, 'v_mal_1')).toBe(before)
  })

  it('не чіпає неактивні пункти й інші сорти', () => {
    const st = useStore.getState()
    const before = st.priceFor(TODAY, 'p1', 'v_mal_2')
    st.setPriceEverywhere({ date: TODAY, berryId: 'v_mal_1', price: 151, author: 'Керівник' })
    const after = useStore.getState()
    expect(after.priceFor(TODAY, 'p1', 'v_mal_2')).toBe(before)
    // p6 — пункт із реєстру, який ще не відкрився: ціни дня в нього немає й не з'явилось
    expect(after.priceFor(TODAY, 'p6', 'v_mal_1')).toBeUndefined()
  })

  it('точкову ціну, виставлену після загальної, загальна не перетирає заднім числом', () => {
    const st = useStore.getState()
    st.setPriceEverywhere({ date: TODAY, berryId: 'v_mal_1', price: 150, author: 'Керівник' })
    useStore.getState().setPrice({
      date: TODAY,
      pointId: 'p1',
      berryId: 'v_mal_1',
      price: 155,
      author: 'Керівник',
      reason: 'конкуренція',
    })
    const after = useStore.getState()
    expect(after.priceFor(TODAY, 'p1', 'v_mal_1')).toBe(155)
    expect(after.priceHistory(TODAY, 'p1', 'v_mal_1').length).toBeGreaterThanOrEqual(2)
  })
})

/* ------------------- ящики і каса як підзвіт (21 §2, §3, §7) ------------------- */

/**
 * Числа в цих тестах — не круглі приклади, а канонічний день `21 §8.4`: Шипинки,
 * 04.08.2026. Наділ 800 = 341 пустих + 195 у людей + 264 у нас; у шухляді 15 416,10 ₴, з
 * них 1 616,10 за ягоду і 13 800,00 завдатків за ящики. Те саме число стоїть у сіді як
 * `cashCounts[0]`, тому тест, який його не назве, не доведе нічого.
 */
const standingOfPoint = (pointId: string, date: ISODate = TODAY) => {
  const st = useStore.getState()
  return crateStanding({
    pointId,
    date,
    allotments: st.crateAllotments,
    issues: st.crateIssues,
    returns: st.crateReturns,
    shipments: st.crateShipments,
    transfers: st.transfers,
  })
}

/**
 * `openedOn` тут написаний ЛІТЕРАЛОМ навмисно — це не копія константи стору, а другий
 * свідок: якби тест читав ту саму змінну, що й стор, він не міг би побачити її зсув.
 * Сам зсув ловить окремий тест через `countCash()`, який бере дату вже зі стору.
 */
const cashOfPoint = (pointId: string, date: ISODate = TODAY) => {
  const st = useStore.getState()
  return cashStanding({
    pointId,
    date,
    openedOn: CASH_BOOK_FROM,
    floats: st.cashFloats,
    receptions: st.receptions,
    payouts: st.payouts,
    transfers: st.transfers,
    issues: st.crateIssues,
    returns: st.crateReturns,
  })
}

describe('наділи: ящики і каса (UC-35)', () => {
  beforeEach(() => {
    useStore.getState().resetDemo()
    // Команди наділів і переказів — керівницькі (§7), тому пристрій тут під роллю власника.
    // «Прийняв» і «Не сходиться» — навпаки, дії ТОЧКИ, тому перед ними роль перемикається.
    useStore.setState({ role: 'owner' })
  })

  it('нове число наділу — це НОВИЙ запис: було 6 записів і 800 діючих, стало 7 і 900', () => {
    const before = useStore.getState().crateAllotments
    expect(before.length).toBe(6)
    expect(standingOfPoint('p1').allotment).toBe(800)
    const doc = useStore.getState().setCrateAllotment({
      pointId: 'p1',
      units: 900,
      effectiveFrom: TODAY,
      reason: 'Більший сезон: 15.07 відвантажили 712 ящиків за день',
    })
    expect(doc?.units).toBe(900)
    expect(doc?.setBy).toBe('Керівник')
    const after = useStore.getState().crateAllotments
    expect(after.length).toBe(7)
    // старий запис лишився недоторканим — саме тому це історія, а не поле на точці
    expect(after[0].units).toBe(600)
    expect(after[1].units).toBe(800)
    expect(standingOfPoint('p1').allotment).toBe(900)
  })

  it('баланс від зміни наділу НЕ перераховується: у людей лишається 195, у нас 264', () => {
    const before = standingOfPoint('p1')
    useStore.getState().setCrateAllotment({
      pointId: 'p1',
      units: 300,
      effectiveFrom: TODAY,
      reason: 'Перевірка того, що зменшення наділу не чіпає жодного документа',
    })
    const after = standingOfPoint('p1')
    expect([before.inField, before.atBase]).toEqual([195, 264])
    expect([after.inField, after.atBase]).toEqual([195, 264])
    // 300 − 195 − 264 = −159: точка одразу в мінусі, і це видно числом, а не забороною
    expect(after.onHand).toBe(-159)
  })

  it('зміна діючого наділу без причини не пише нічого: записів як було 6', () => {
    const st = useStore.getState()
    expect(st.setCrateAllotment({ pointId: 'p1', units: 900, effectiveFrom: TODAY })).toBeUndefined()
    expect(st.setCrateAllotment({ pointId: 'p1', units: 900, effectiveFrom: TODAY, reason: '  ' })).toBeUndefined()
    expect(useStore.getState().crateAllotments.length).toBe(6)
  })

  it('дробовий і відʼємний наділ ящиків не пишеться: записів як було 6', () => {
    const st = useStore.getState()
    const reason = 'Свідома спроба записати кількість, якої не буває у ящиках'
    expect(st.setCrateAllotment({ pointId: 'p1', units: 12.5, effectiveFrom: TODAY, reason })).toBeUndefined()
    expect(st.setCrateAllotment({ pointId: 'p1', units: -5, effectiveFrom: TODAY, reason })).toBeUndefined()
    expect(useStore.getState().crateAllotments.length).toBe(6)
  })

  it('наділ каси 500 000 → 600 000 новим записом; NaN не пишеться зовсім', () => {
    expect(cashOfPoint('p1').float).toBe(500_000)
    const doc = useStore.getState().setCashFloat({
      pointId: 'p1',
      amount: 600_000,
      effectiveFrom: TODAY,
      reason: 'Зміряно: 13 днів із 39 видали більше за наділ, максимум 493 735 ₴',
    })
    expect(doc?.amount).toBe(600_000)
    expect(cashOfPoint('p1').float).toBe(600_000)
    expect(useStore.getState().cashFloats.length).toBe(7)
    // round2(NaN) дає 0 — без відмови в сторі наділ тихо став би 0,00 ₴
    expect(
      useStore.getState().setCashFloat({
        pointId: 'p1',
        amount: Number.NaN,
        effectiveFrom: TODAY,
        reason: 'Порожнє поле вводу, яке дало NaN замість числа',
      }),
    ).toBeUndefined()
    expect(useStore.getState().cashFloats.length).toBe(7)
  })
})

describe('видача ящиків (UC-18, UC-19, I62)', () => {
  beforeEach(() => useStore.getState().resetDemo())

  it('20 ящиків за кошти: 2 400,00 ₴ у касу, пустих 341 → 321, у людей 195 → 215', () => {
    // s7 — та сама людина, що в UC-18: у неї вже 40 ящиків і 4 800,00 ₴ нашого завдатку
    const before = standingOfPoint('p1')
    expect([before.allotment, before.onHand, before.inField]).toEqual([800, 341, 195])
    expect(crateBalance('s7', useStore.getState().crateIssues, useStore.getState().crateReturns)).toMatchObject({
      units: 40,
      depositHeld: 4_800,
    })
    const doc = useStore.getState().issueCrates({ pointId: 'p1', supplierId: 's7', units: 20 })
    expect(doc?.mode).toBe('deposit')
    expect(doc?.depositPerUnit).toBe(120)
    expect(doc?.depositTaken).toBe(2_400)
    expect(doc?.receiptNo).toBeUndefined()
    const after = standingOfPoint('p1')
    expect([after.onHand, after.inField]).toEqual([321, 215])
    // каса за ящики 13 800,00 + 2 400,00; каса за ягоду не зрушила
    expect(cashOfPoint('p1').crateCash).toBe(16_200)
    expect(cashOfPoint('p1').berryCash).toBe(1_616.1)
    expect(cashOfPoint('p1').expectedCash).toBe(17_816.1)
  })

  it('80 ящиків — за розписку: завдаток 0,00 і каса за ящики лишається 13 800,00', () => {
    const doc = useStore.getState().issueCrates({
      pointId: 'p1',
      supplierId: 's7',
      units: 80,
      receiptNo: 'Р-0002',
    })
    expect(doc?.mode).toBe('receipt')
    expect(doc?.depositPerUnit).toBe(0)
    expect(doc?.depositTaken).toBe(0)
    expect(doc?.receiptNo).toBe('Р-0002')
    expect(cashOfPoint('p1').crateCash).toBe(13_800)
    // ящики пішли, а грошового покриття немає взагалі: у людей 195 + 80
    expect(standingOfPoint('p1').inField).toBe(275)
  })

  it('перемикання руками сильніше за поріг: 20 за розписку дає завдаток 0,00', () => {
    const doc = useStore.getState().issueCrates({
      pointId: 'p1',
      supplierId: 's7',
      units: 20,
      mode: 'receipt',
      receiptNo: 'Р-0003',
    })
    expect(doc?.mode).toBe('receipt')
    expect(doc?.depositTaken).toBe(0)
    expect(cashOfPoint('p1').crateCash).toBe(13_800)
  })

  it('I62: на точці 341 порожній ящик — 500 видати нема з чого, видач як було 15', () => {
    const st = useStore.getState()
    expect(standingOfPoint('p1').onHand).toBe(341)
    expect(st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 500 })).toBeUndefined()
    // 342 — рівно на один більше за наявні: межа перевіряється, а не «приблизно»
    expect(st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 342 })).toBeUndefined()
    expect(st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 0 })).toBeUndefined()
    expect(useStore.getState().crateIssues.length).toBe(15)
    // а 341 — можна: відмова саме на межі, не за один крок до неї
    expect(st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 341 })?.units).toBe(341)
    expect(standingOfPoint('p1').onHand).toBe(0)
  })

  it('на точці без наділу ящиків не видають узагалі: onHand === null, видач 15', () => {
    // p6 — пункт із реєстру, який ще не відкрився: наділу йому не призначали
    expect(standingOfPoint('p6').onHand).toBeNull()
    expect(useStore.getState().issueCrates({ pointId: 'p6', supplierId: 's7', units: 1 })).toBeUndefined()
    expect(useStore.getState().crateIssues.length).toBe(15)
  })

  it('без Чешки в довіднику видача за кошти не проходить: завдаток 0 при mode deposit заборонений', () => {
    // довідник тари приїжджає з localStorage, і саме там його правлять руками
    useStore.setState({ tareTypes: [] })
    expect(useStore.getState().issueCrates({ pointId: 'p1', supplierId: 's7', units: 20 })).toBeUndefined()
    // за розписку — можна: там завдаток дорівнює 0 за правилом, а не через порожній довідник
    expect(useStore.getState().issueCrates({ pointId: 'p1', supplierId: 's7', units: 80 })?.depositTaken).toBe(0)
    expect(useStore.getState().crateIssues.length).toBe(16)
  })
})

describe('повернення ящиків (UC-20, I64, I59)', () => {
  beforeEach(() => useStore.getState().resetDemo())

  it('часткове повернення 7 із 40: до видачі 840,00 ₴, лишається 33 ящ. і 3 960,00 ₴', () => {
    const doc = useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's7', units: 7 })
    expect(doc?.depositRefund).toBe(840)
    // FIFO: гаситься НАЙСТАРІША видача цієї людини, і за ЇЇ завдатком
    expect(doc?.allocations).toEqual([{ issueId: 'ci7', units: 7, perUnit: 120, amount: 840 }])
    const balance = crateBalance('s7', useStore.getState().crateIssues, useStore.getState().crateReturns)
    expect(balance.units).toBe(33)
    expect(balance.depositHeld).toBe(3_960)
    // каса за ящики 13 800,00 − 840,00; у людей 195 − 7
    expect(cashOfPoint('p1').crateCash).toBe(12_960)
    expect(standingOfPoint('p1').inField).toBe(188)
    expect(standingOfPoint('p1').onHand).toBe(348)
  })

  it('I64: людина має 40 — повернути 41 не можна, повернень як було 2', () => {
    const st = useStore.getState()
    expect(st.returnCrates({ pointId: 'p1', supplierId: 's7', units: 41 })).toBeUndefined()
    expect(st.returnCrates({ pointId: 'p1', supplierId: 's7', units: 100 })).toBeUndefined()
    // s1 уже повернула всі 30: у неї на балансі 0, і повертати нічого
    expect(st.returnCrates({ pointId: 'p1', supplierId: 's1', units: 1 })).toBeUndefined()
    expect(useStore.getState().crateReturns.length).toBe(2)
    // рівно 40 — можна
    expect(st.returnCrates({ pointId: 'p1', supplierId: 's7', units: 40 })?.depositRefund).toBe(4_800)
  })

  it('I66: повернення ящиків, узятих за розписку, дає 0,00 ₴ — грошей не брали', () => {
    // s5 — рядок журналу на 80 ящиків, єдиний за розписку з п'ятнадцяти
    const doc = useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's5', units: 80 })
    expect(doc?.depositRefund).toBe(0)
    expect(doc?.allocations).toEqual([{ issueId: 'ci5', units: 80, perUnit: 0, amount: 0 }])
    // каса за ящики не зрушила: 13 800,00 як було
    expect(cashOfPoint('p1').crateCash).toBe(13_800)
    expect(standingOfPoint('p1').inField).toBe(115)
  })

  it('завдаток, узятий ДО відкриття книги, лежить у шухляді: 1 200,00, а не 0,00', () => {
    // Виправлено після рецензії хвилі 2. Ягода згортається від дня відкриття книги, бо на
    // той день у неї вже є підсумок — наділ. У завдатків підсумку немає: гроші, взяті
    // 10.07, ФІЗИЧНО лежать у шухляді 04.08, поки людина не принесла ящики назад.
    useStore.setState({
      crateIssues: [
        {
          id: 'ci_old',
          date: '2026-07-10',
          time: '09:00',
          pointId: 'p1',
          supplierId: 's7',
          units: 10,
          mode: 'deposit',
          depositPerUnit: 120,
          depositTaken: 1_200,
          operatorId: 'Оксана Г.',
        },
      ],
      crateReturns: [],
    })
    expect(cashOfPoint('p1').crateCash).toBe(1_200)
    expect(crateBalance('s7', useStore.getState().crateIssues, useStore.getState().crateReturns).units).toBe(10)
    // і повернення проходить: гроші за ці ящики в нас є
    expect(useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's7', units: 10 })).toBeDefined()
    expect(useStore.getState().crateReturns[0].depositRefund).toBe(1_200)
  })

  it('I59: повернення впирається в касу за ЯЩИКИ ТІЄЇ точки — Q-25, 1 200,00 проти 0,00', () => {
    // Людина взяла ящики на Гайовому — гроші зайшли в шухляду Гайового. Вертає на
    // Шипинках, де за ящики не брали нічого. Віддати нема з чого, і це не помилка вводу,
    // а наслідок Q-25: у стенограмі такого випадку немає взагалі.
    useStore.setState({
      crateIssues: [
        {
          id: 'ci_p3',
          date: '2026-07-30',
          time: '09:00',
          pointId: 'p3',
          supplierId: 's7',
          units: 10,
          mode: 'deposit',
          depositPerUnit: 120,
          depositTaken: 1_200,
          operatorId: 'Ігор В.',
        },
      ],
      crateReturns: [],
    })
    expect(cashOfPoint('p3').crateCash).toBe(1_200)
    expect(cashOfPoint('p1').crateCash).toBe(0)
    // ящики в людини є — блокує саме порожня каса за ящики на ЦІЙ точці
    expect(crateBalance('s7', useStore.getState().crateIssues, useStore.getState().crateReturns).units).toBe(10)
    expect(useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's7', units: 10 })).toBeUndefined()
    expect(useStore.getState().crateReturns.length).toBe(0)
    // а на своїй точці те саме повернення проходить
    expect(useStore.getState().returnCrates({ pointId: 'p3', supplierId: 's7', units: 10 })).toBeDefined()
  })

  it('порожня каса за ЯГОДУ поверненню не заважає: berryCash 0,00, а 840,00 ₴ віддано', () => {
    // 1102 дослівно: «не може бути такого, що зараз коштів немає в касі, ну, ми маємо віддати»
    useStore.setState({ cashFloats: [], transfers: [] })
    expect(cashOfPoint('p1').berryCash).toBeLessThan(0)
    expect(useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's7', units: 7 })?.depositRefund).toBe(840)
  })
})

describe('вечірнє відправлення (UC-21, I63)', () => {
  beforeEach(() => useStore.getState().resetDemo())

  it('з ягодою 173 із 3 квитанцій рахує рушій; людина вводить лише бій 2', () => {
    const doc = useStore.getState().postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 2 })
    expect(doc?.withBerryUnits).toBe(173)
    expect(doc?.receptionCount).toBe(3)
    expect(doc?.brokenUnits).toBe(2)
    // сід уже має відправлення за сьогодні (cs7), тому «у нас» росте на 173 + 2
    expect(standingOfPoint('p1').atBase).toBe(264 + 175)
    expect(useStore.getState().crateShipments.length).toBe(33)
  })

  it('знімок не переписується заднім числом: 173 лишається 173 і після 4-ї квитанції', () => {
    const doc = useStore.getState().postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 0 })
    expect(doc?.withBerryUnits).toBe(173)
    const st = useStore.getState()
    const berry = st.berries[0]
    st.addVisit({
      date: TODAY,
      pointId: 'p1',
      supplierId: 's7',
      operator: 'Оксана Г.',
      carriedIn: 0,
      paid: 0,
      lines: [
        {
          berryId: berry.id,
          gross: 61.2,
          pallet: 0,
          tare: [{ tareId: 'tr_cheshka', count: 10 }],
          tareWeight: 12,
          net: 49.2,
          price: 100,
          bonus: 0,
          amount: 4_920,
        },
      ],
    })
    const saved = useStore.getState().crateShipments.find((x) => x.id === doc?.id)
    expect(saved?.withBerryUnits).toBe(173)
    expect(saved?.receptionCount).toBe(3)
    // а сьогоднішній день уже дає інший знімок — саме цю різницю I63 і показує як warn
    expect(useStore.getState().postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 0 })).toMatchObject({
      withBerryUnits: 183,
      receptionCount: 4,
    })
  })

  it('бій дробом або мінусом не пишеться: відправлень як було 32', () => {
    const st = useStore.getState()
    expect(st.postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 1.5 })).toBeUndefined()
    expect(st.postShipment({ pointId: 'p1', date: TODAY, brokenUnits: -1 })).toBeUndefined()
    expect(useStore.getState().crateShipments.length).toBe(32)
    // нуль — валідне значення: «ламані не кожен день можуть бути» (993)
    expect(st.postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 0 })?.brokenUnits).toBe(0)
  })
})

describe('перекази база → точка (UC-22, UC-36, UC-37, I68, I69)', () => {
  beforeEach(() => {
    useStore.getState().resetDemo()
    // Команди наділів і переказів — керівницькі (§7), тому пристрій тут під роллю власника.
    // «Прийняв» і «Не сходиться» — навпаки, дії ТОЧКИ, тому перед ними роль перемикається.
    useStore.setState({ role: 'owner' })
  })

  it("переказ у стані 'sent' не рухає ні касу, ні наділ: 1 616,10 ₴ і 341 ящик як були", () => {
    const before = cashOfPoint('p1')
    expect(before.berryCash).toBe(1_616.1)
    expect(before.floatShortfall).toBe(498_383.9)
    const doc = useStore.getState().sendTransfer({
      pointId: 'p1',
      crates: 40,
      cash: 150_000,
      carrier: 'Перевізник Р.',
    })
    expect(doc?.status).toBe('sent')
    expect(doc?.sentBy).toBe('Керівник')
    const after = cashOfPoint('p1')
    expect(after.berryCash).toBe(1_616.1)
    expect(after.cashIn).toBe(before.cashIn)
    expect(standingOfPoint('p1').onHand).toBe(341)
  })

  it("після «Прийняв» той самий переказ дає 151 616,10 ₴ і «не хватає» 348 383,90", () => {
    const sent = useStore.getState().sendTransfer({
      pointId: 'p1',
      crates: 40,
      cash: 150_000,
      carrier: 'Перевізник Р.',
    })
    useStore.setState({ role: 'operator' })
    const accepted = useStore.getState().acceptTransfer(sent!.id)
    expect(accepted?.status).toBe('accepted')
    expect(accepted?.acceptedBy).toBe('Оксана Г.')
    const after = cashOfPoint('p1')
    expect(after.berryCash).toBe(151_616.1)
    expect(after.floatShortfall).toBe(348_383.9)
    // 40 порожніх повернулися на точку: «у нас» 264 − 40, пустих 341 + 40
    expect(standingOfPoint('p1').atBase).toBe(224)
    expect(standingOfPoint('p1').onHand).toBe(381)
  })

  it('прийняти двічі не можна: 151 616,10 ₴ лишається 151 616,10', () => {
    const sent = useStore.getState().sendTransfer({
      pointId: 'p1',
      crates: 40,
      cash: 150_000,
      carrier: 'Перевізник Р.',
    })
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(sent!.id)
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().acceptTransfer(sent!.id)).toBeUndefined()
    expect(cashOfPoint('p1').berryCash).toBe(151_616.1)
    // і неіснуючий id теж нічого не рухає
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().acceptTransfer('tf_немає')).toBeUndefined()
  })

  it("«Не сходиться» не рухає нічого: 20 ящиків проти нарахованих 18, каса p5 без змін", () => {
    const before = cashOfPoint('p5')
    const sent = useStore.getState().sendTransfer({
      pointId: 'p5',
      crates: 20,
      cash: 11_787.77,
      carrier: 'Перевізник Р.',
    })
    useStore.setState({ role: 'operator' })
    const doc = useStore.getState().disputeTransfer(sent!.id, {
      reportedCrates: 18,
      reportedCash: 11_787.77,
      note: 'Порахували при перевізнику: приїхало на два менше',
    })
    expect(doc?.status).toBe('disputed')
    expect(doc?.reportedCrates).toBe(18)
    expect(cashOfPoint('p5').berryCash).toBe(before.berryCash)
    expect(cashOfPoint('p5').cashIn).toBe(before.cashIn)
    // заявлений переказ уже не приймають кнопкою «Прийняв» — його закриває керівник
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().acceptTransfer(sent!.id)).toBeUndefined()
  })

  it('I69: приймальник переказ не сторнує — tf23 лишається disputed', () => {
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().voidTransfer('tf23', 'привезли на два менше', 'Оксана Г.')).toBeUndefined()
    expect(useStore.getState().transfers.find((t) => t.id === 'tf23')?.status).toBe('disputed')
  })

  it('UC-36: сторно — це слід на старому документі плюс НОВИЙ із correctionOf, а не правка', () => {
    useStore.setState({ role: 'owner' })
    const before = useStore.getState().transfers.length
    expect(before).toBe(23)
    // без причини сторно не проходить — як і в voidReweigh
    expect(useStore.getState().voidTransfer('tf23', '   ', 'Керівник')).toBeUndefined()
    const voided = useStore.getState().voidTransfer('tf23', 'Перерахували при перевізнику: 18, не 20', 'Керівник')
    expect(voided?.status).toBe('void')
    expect(voided?.voidReason).toBe('Перерахували при перевізнику: 18, не 20')
    // числа СТАРОГО документа не змінилися: 20 ящиків і 11 787,77 ₴ як були
    expect([voided?.crates, voided?.cash]).toEqual([20, 11_787.77])
    const fixed = useStore.getState().sendTransfer({
      pointId: 'p5',
      crates: 18,
      cash: 11_787.77,
      carrier: 'Перевізник Р.',
      correctionOf: 'tf23',
    })
    expect(fixed?.correctionOf).toBe('tf23')
    expect(fixed?.id).not.toBe('tf23')
    expect(useStore.getState().transfers.length).toBe(before + 1)
    const acceptedBefore = useStore.getState().transfers.filter(
      (t) => t.status === 'accepted' && t.pointId === 'p5',
    ).length
    expect(acceptedBefore).toBe(5)
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(fixed!.id)
    // і аж тепер ті 18 ящиків повернулися на точку — шостим прийнятим переказом
    expect(useStore.getState().transfers.filter((t) => t.status === 'accepted' && t.pointId === 'p5').length).toBe(6)
  })

  it('відʼємний і дробовий переказ не пишеться: переказів як було 23', () => {
    const st = useStore.getState()
    expect(st.sendTransfer({ pointId: 'p1', crates: -1, cash: 100, carrier: 'Перевізник Р.' })).toBeUndefined()
    expect(st.sendTransfer({ pointId: 'p1', crates: 1.5, cash: 100, carrier: 'Перевізник Р.' })).toBeUndefined()
    expect(st.sendTransfer({ pointId: 'p1', crates: 1, cash: -100, carrier: 'Перевізник Р.' })).toBeUndefined()
    expect(st.sendTransfer({ pointId: 'p1', crates: 1, cash: Number.NaN, carrier: 'Перевізник Р.' })).toBeUndefined()
    expect(useStore.getState().transfers.length).toBe(23)
  })
})

describe('зміна і перерахунок каси (UC-22, I70)', () => {
  beforeEach(() => useStore.getState().resetDemo())

  it('перерахунок серед дня бачить ту саму очікувану суму, що й сід: 15 416,10 ₴', () => {
    // Цей тест — єдине місце, де CASH_BOOK_OPEN стору перевіряється проти сіду: очікувану
    // суму рахує САМ стор своєю датою відкриття книги, а 15 416,10 записав сід своєю.
    const seeded = useStore.getState().cashCounts[0]
    expect(seeded.expectedAtCount).toBe(15_416.1)
    const doc = useStore.getState().countCash({ shiftId: 'sf2', countedCash: 15_416.1 })
    expect(doc?.expectedAtCount).toBe(15_416.1)
    expect(doc?.discrepancy).toBe(0)
    expect(doc?.countedBy).toBe('Оксана Г.')
    expect(useStore.getState().cashCounts.length).toBe(2)
  })

  it('недостача фіксується числом і нічого не виправляє: −416,10 ₴ при 15 000,00 порахованих', () => {
    const doc = useStore.getState().countCash({ shiftId: 'sf2', countedCash: 15_000, note: 'Перерахували о 16:00' })
    expect(doc?.countedCash).toBe(15_000)
    expect(doc?.expectedAtCount).toBe(15_416.1)
    expect(doc?.discrepancy).toBe(-416.1)
    // очікувана сума після перерахунку та сама: перерахунок фіксує факт, а не гасить його
    expect(cashOfPoint('p1').expectedCash).toBe(15_416.1)
  })

  it('перерахунок на закритій зміні не пишеться: перерахунків як був 1', () => {
    const st = useStore.getState()
    expect(st.shifts.find((x) => x.id === 'sf1')?.status).toBe('closed')
    expect(st.countCash({ shiftId: 'sf1', countedCash: 31_084.94 })).toBeUndefined()
    expect(st.countCash({ shiftId: 'sf_немає', countedCash: 1 })).toBeUndefined()
    expect(useStore.getState().cashCounts.length).toBe(1)
  })

  it('закриття без розбіжності закриває сам приймальник: 15 416,10 ₴ і статус closed', () => {
    const doc = useStore.getState().closeShift({ shiftId: 'sf2', countedCash: 15_416.1 })
    expect(doc?.countedCash).toBe(15_416.1)
    expect(doc?.discrepancy).toBe(0)
    expect(doc?.status).toBe('closed')
    expect(doc?.closedBy).toBe('Оксана Г.')
  })

  it('розбіжність −416,10 ₴ віддає зміну керівникові: awaiting_explanation і closedBy порожній', () => {
    const doc = useStore.getState().closeShift({
      shiftId: 'sf2',
      countedCash: 15_000,
      explanation: 'Перерахували двічі, різниця лишилась',
    })
    expect(doc?.discrepancy).toBe(-416.1)
    expect(doc?.status).toBe('awaiting_explanation')
    expect(doc?.closedBy).toBeUndefined()
    // закрити її вдруге не можна: вона вже не 'open'
    expect(useStore.getState().closeShift({ shiftId: 'sf2', countedCash: 15_416.1 })).toBeUndefined()
  })

  it('друга відкрита зміна на тій самій точці не відкривається: змін як було 2', () => {
    const st = useStore.getState()
    expect(st.openShift({ pointId: 'p1', operatorId: 'Оксана Г.', openingFloat: 460_670.02 })).toBeUndefined()
    expect(useStore.getState().shifts.length).toBe(2)
    // на точці без відкритої зміни — відкривається, і openingFloat це ПЕРЕРАХУНОК людини
    const doc = useStore.getState().openShift({ pointId: 'p2', operatorId: 'Тарас Л.', openingFloat: 12_345.67 })
    expect(doc?.openingFloat).toBe(12_345.67)
    expect(doc?.status).toBe('open')
    expect(useStore.getState().shifts.length).toBe(3)
  })
})

/**
 * ЧОМУ ТУТ ОКРЕМИЙ ІНСТАНС СТОРУ. `persist` чіпляє `api.persist` ЛИШЕ тоді, коли сховище
 * створилося: `createJSONStorage(() => window.localStorage)` у vitest-середовищі `node`
 * кидає, повертає `undefined`, і zustand іде раннім `return` (`middleware.mjs:346-357`).
 * Тобто без цієї підстановки `useStore.persist` — `undefined`, і `merge` не викликати
 * взагалі: єдина недовірена межа застосунку лишилась би без жодного тесту, доводжена лише
 * розбором AST у `ratchet:persist`.
 *
 * `vi.resetModules()` + динамічний імпорт дають СВІЖИЙ модуль стору вже зі сховищем; він
 * навмисно не той самий, що `useStore` вгорі файлу, тому ці тести ні на що не впливають.
 */
async function persistedStore() {
  const mem = new Map<string, string>()
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v)
    },
    removeItem: (k: string) => {
      mem.delete(k)
    },
  }
  vi.stubGlobal('window', { localStorage: storage })
  vi.stubGlobal('localStorage', storage)
  vi.resetModules()
  const mod = await import('./store')
  return mod.useStore
}

describe('персист v6', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('ключ сховища — yagoda-crm-demo-v6, і partialize віддає 21 ключ разом із вісьмома новими', async () => {
    const store = await persistedStore()
    const opts = store.persist.getOptions()
    expect(opts.name).toBe('yagoda-crm-demo-v6')
    expect(opts.version).toBe(6)
    const saved = Object.keys(opts.partialize!(store.getState()) as unknown as Record<string, unknown>)
    expect(saved.length).toBe(21)
    for (const k of [
      'crateAllotments',
      'cashFloats',
      'crateIssues',
      'crateReturns',
      'crateShipments',
      'transfers',
      'shifts',
      'cashCounts',
    ]) {
      expect(saved, k).toContain(k)
    }
  })

  it('порожній payload не кидає і віддає свіжий сід: 15 видач, 6 наділів, 23 перекази', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const current = store.getState()
    // undefined приходить на свіжому браузері і на КОЖНОМУ бампі версії (migrate → undefined),
    // null — це вже правлений payload; дефолт параметра зривається тільки на першому
    for (const payload of [undefined, null, {}]) {
      const merged = merge(payload, current) as typeof current
      expect(merged.crateIssues.length, String(payload)).toBe(15)
      expect(merged.crateAllotments.length, String(payload)).toBe(6)
      expect(merged.transfers.length, String(payload)).toBe(23)
      expect(merged.cashCounts.length, String(payload)).toBe(1)
    }
  })

  it('зіпсований масив у payload замінюється сідом, а не тече в рушій: 15 видач замість рядка', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const current = store.getState()
    const merged = merge(
      {
        crateIssues: 'зіпсовано',
        crateReturns: 7,
        crateShipments: null,
        transfers: { нема: true },
        shifts: 'ні',
        cashCounts: 0,
        crateAllotments: false,
        cashFloats: 'нема',
      },
      current,
    ) as typeof current
    expect(merged.crateIssues.length).toBe(15)
    expect(merged.crateReturns.length).toBe(2)
    expect(merged.crateShipments.length).toBe(32)
    expect(merged.transfers.length).toBe(23)
    expect(merged.shifts.length).toBe(2)
    expect(merged.cashCounts.length).toBe(1)
    expect(merged.crateAllotments.length).toBe(6)
    expect(merged.cashFloats.length).toBe(6)
  })

  it('справжній масив із payload проходить: 0 видач замість 15', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const merged = merge({ crateIssues: [] }, store.getState()) as ReturnType<typeof store.getState>
    expect(merged.crateIssues.length).toBe(0)
    // решта семи ключів при цьому лишається сідовою
    expect(merged.crateReturns.length).toBe(2)
  })
})

/**
 * Прогалини, знайдені мутаційною рецензією хвилі 2. Двадцять пʼять мутацій вижили на
 * сорока зелених тестах — і це та сама конфігурація, від якої застерігає CLAUDE.md:
 * код і тести до нього писала одна рука, тому тест повторював реалізацію.
 */
describe('прогалини мутаційної рецензії (стор)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
    // Команди наділів і переказів — керівницькі (§7), тому пристрій тут під роллю власника.
    // «Прийняв» і «Не сходиться» — навпаки, дії ТОЧКИ, тому перед ними роль перемикається.
    useStore.setState({ role: 'owner' })
  })

  const sendOne = () =>
    useStore.getState().sendTransfer({ pointId: 'p1', crates: 40, cash: 150_000, carrier: 'Перевізник Р.' })!

  it('СТОРНОВАНИЙ переказ прийняти не можна: статус лишається void', () => {
    const doc = sendOne()
    useStore.setState({ role: 'owner' })
    useStore.getState().voidTransfer(doc.id, 'помилка суми', 'Керівник')
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().acceptTransfer(doc.id)).toBeUndefined()
    expect(useStore.getState().transfers.find((t) => t.id === doc.id)!.status).toBe('void')
  })

  it('ПРИЙНЯТИЙ переказ не можна перекинути в «не сходиться» — 150 000 лишаються в касі', () => {
    const doc = sendOne()
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(doc.id)
    const before = cashOfPoint('p1').cashIn
    useStore.setState({ role: 'operator' })
    expect(
      useStore.getState().disputeTransfer(doc.id, { reportedCrates: 38, reportedCash: 140_000, note: 'менше' }),
    ).toBeUndefined()
    expect(useStore.getState().transfers.find((t) => t.id === doc.id)!.status).toBe('accepted')
    expect(cashOfPoint('p1').cashIn).toBe(before)
  })

  it('перехід стану дає НОВИЙ обʼєкт: старий примірник лишається у стані sent', () => {
    const doc = sendOne()
    const before = useStore.getState().transfers.find((t) => t.id === doc.id)!
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(doc.id)
    const after = useStore.getState().transfers.find((t) => t.id === doc.id)!
    expect(before.status).toBe('sent')
    expect(after.status).toBe('accepted')
    expect(after).not.toBe(before)
  })

  it('наділ ящиків на ТУ САМУ дату ВСТАВЛЯЄТЬСЯ, а не переписується: 900 перемагає 800', () => {
    const st = useStore.getState()
    const before = st.crateAllotments.length
    st.setCrateAllotment({ pointId: 'p1', units: 800, effectiveFrom: '2026-07-15', reason: 'більший сезон' })
    st.setCrateAllotment({ pointId: 'p1', units: 900, effectiveFrom: '2026-07-15', reason: 'ще більший сезон' })
    expect(useStore.getState().crateAllotments.length).toBe(before + 2)
    expect(standingOfPoint('p1').allotment).toBe(900)
  })

  it('наділ каси на ТУ САМУ дату теж вставляється: 600 000 перемагає 500 000', () => {
    const st = useStore.getState()
    const before = st.cashFloats.length
    st.setCashFloat({ pointId: 'p1', amount: 600_000, effectiveFrom: '2026-07-10', reason: 'пікові дні' })
    expect(useStore.getState().cashFloats.length).toBe(before + 1)
    expect(cashOfPoint('p1').float).toBe(600_000)
  })

  it('наділ каси без причини не змінюється, навіть на нову дату', () => {
    const before = useStore.getState().cashFloats.length
    expect(
      useStore.getState().setCashFloat({ pointId: 'p1', amount: 600_000, effectiveFrom: '2026-08-04' }),
    ).toBeUndefined()
    // `undefined` каже лише «нам нічого не повернули». Друге твердження — про СТАН: команда,
    // яка вставила б запис і повернула undefined, першим рядком не ловилася б узагалі.
    expect(useStore.getState().cashFloats.length).toBe(before)
    expect(cashOfPoint('p1').float).toBe(500_000)
  })

  it('відʼємний наділ каси не приймається: −1,00 ₴ це відмова', () => {
    const before = useStore.getState().cashFloats.length
    expect(
      useStore.getState().setCashFloat({ pointId: 'p1', amount: -1, effectiveFrom: '2026-08-04', reason: 'помилка' }),
    ).toBeUndefined()
    expect(useStore.getState().cashFloats.length).toBe(before)
    expect(cashOfPoint('p1').float).toBe(500_000)
  })

  it('перерахунок не пишеться на зміну, що вже пішла до керівника', () => {
    const st = useStore.getState()
    const shift = st.openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: 10_000 })!
    st.closeShift({ shiftId: shift.id, countedCash: 1 })
    expect(useStore.getState().shifts.find((s) => s.id === shift.id)!.status).toBe('awaiting_explanation')
    expect(useStore.getState().countCash({ shiftId: shift.id, countedCash: 10_000 })).toBeUndefined()
  })

  it('після закритої зміни точка відкриває наступну — закрита її не блокує', () => {
    const st = useStore.getState()
    const first = st.openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: 10_000 })!
    const expected = cashOfPoint('p2').expectedCash
    st.closeShift({ shiftId: first.id, countedCash: expected })
    expect(useStore.getState().shifts.find((s) => s.id === first.id)!.status).toBe('closed')
    expect(useStore.getState().openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: expected })).toBeDefined()
  })

  it('без Чешки в довіднику видача за кошти не проходить, хоч інша тара є', () => {
    useStore.setState({ tareTypes: [{ id: 'tr_lubianka', name: 'Лубʼянка', weight: 0.3, price: 50 }] })
    const before = useStore.getState().crateIssues.length
    const cash = cashOfPoint('p1').crateCash
    expect(useStore.getState().issueCrates({ pointId: 'p1', supplierId: 's7', units: 10 })).toBeUndefined()
    // Ціни завдатку взяти нема звідки, тому документа не має бути ЗОВСІМ: видача з
    // `depositPerUnit: undefined` пройшла б повз перший рядок і зіпсувала б касу за ящики.
    expect(useStore.getState().crateIssues.length).toBe(before)
    expect(cashOfPoint('p1').crateCash).toBe(cash)
  })

  it('баланс людини МЕРЕЖЕВИЙ: узяла 10 на p1 і 20 на p3 — повертає 15 на p1', () => {
    const st = useStore.getState()
    // Чистий аркуш: у сіді на цій людині ящиків немає, тому числа в тесті — саме її.
    useStore.setState({ crateIssues: [], crateReturns: [] })
    // За розписку, щоб перевірка каси за ящики не заважала бачити саме баланс людини.
    st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 10, mode: 'receipt', receiptNo: 'Р-1' })
    st.issueCrates({ pointId: 'p3', supplierId: 's7', units: 20, mode: 'receipt', receiptNo: 'Р-2' })
    expect(crateBalance('s7', useStore.getState().crateIssues, useStore.getState().crateReturns).units).toBe(30)
    const doc = useStore.getState().returnCrates({ pointId: 'p1', supplierId: 's7', units: 15 })
    expect(doc).toBeDefined()
    expect(doc!.depositRefund).toBe(0)
  })
})

describe('персист: прогалини рецензії', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('відкрита зміна і несинхронізована квитанція зберігаються, а не губляться', async () => {
    const store = await persistedStore()
    store.setState({
      shifts: [
        {
          id: 'sh_open',
          pointId: 'p1',
          operatorId: 'Оксана Г.',
          date: TODAY,
          openedTime: '08:00',
          openingFloat: 1_000,
          status: 'open',
        },
      ],
      receptions: [{ ...store.getState().receptions[0], id: 'rc_offline', synced: false }],
    })
    const saved = store.persist.getOptions().partialize!(store.getState()) as unknown as Record<string, unknown>
    expect((saved.shifts as unknown[]).length).toBe(1)
    expect((saved.receptions as { id: string }[]).some((r) => r.id === 'rc_offline')).toBe(true)
  })

  it('збережені перекази СПРАВДІ відновлюються, а не підміняються свіжим сідом', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const kept = [
      {
        id: 'tf_kept',
        date: TODAY,
        pointId: 'p1',
        crates: 7,
        cash: 123.45,
        carrier: 'Перевізник Р.',
        sentBy: 'Керівник',
        sentTime: '18:00',
        status: 'sent',
      },
    ]
    const merged = merge({ transfers: kept }, store.getState()) as { transfers: { id: string }[] }
    expect(merged.transfers).toHaveLength(1)
    expect(merged.transfers[0].id).toBe('tf_kept')
  })

  it('зіпсовані виплати падають у СВІЖИЙ СІД, а не в порожнечу', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const merged = merge({ payouts: 'зламано' }, store.getState()) as { payouts: unknown[] }
    expect(merged.payouts.length).toBeGreaterThan(0)
    expect(merged.payouts).toEqual(store.getState().payouts)
  })

  it('налаштування з битою верхньою межею дод. ціни не приймаються', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const merged = merge({ settings: { surchargeMin: -30, surchargeMax: 'багато' } }, store.getState()) as {
      settings: { surchargeMax: number }
    }
    expect(merged.settings.surchargeMax).toBe(store.getState().settings.surchargeMax)
  })
})

describe('прогалини критика (стор)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
    // Команди наділів і переказів — керівницькі (§7), тому пристрій тут під роллю власника.
    // «Прийняв» і «Не сходиться» — навпаки, дії ТОЧКИ, тому перед ними роль перемикається.
    useStore.setState({ role: 'owner' })
  })

  it('UC-36 A2: точка натиснула «Прийняв» помилково — сторнує КЕРІВНИК', () => {
    const doc = useStore
      .getState()
      .sendTransfer({ pointId: 'p1', crates: 40, cash: 150_000, carrier: 'Перевізник Р.' })!
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(doc.id)
    expect(cashOfPoint('p1').cashIn).toBeGreaterThan(0)
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().voidTransfer(doc.id, 'точка прийняла помилково', 'Керівник')).toBeDefined()
    expect(useStore.getState().transfers.find((t) => t.id === doc.id)!.status).toBe('void')
  })

  it('сторно недоступне з пристрою приймальника, навіть якщо підписатися керівником', () => {
    const doc = useStore
      .getState()
      .sendTransfer({ pointId: 'p1', crates: 40, cash: 150_000, carrier: 'Перевізник Р.' })!
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().voidTransfer(doc.id, 'спроба', 'Керівник')).toBeUndefined()
    expect(useStore.getState().transfers.find((t) => t.id === doc.id)!.status).toBe('sent')
  })

  it('відправлення за ВЧОРА бере вчорашні квитанції: 89 ящиків, а не сьогоднішні 173', () => {
    // «ми можемо додати за позавчора, вчора і за сьогодні» (984) — відправлення за минулий
    // день це норма, а не виняток, і знімок мусить бути того дня, за який відвантажують.
    const doc = useStore.getState().postShipment({ pointId: 'p1', date: '2026-08-03', brokenUnits: 0 })
    expect(doc).toBeDefined()
    expect(doc!.date).toBe('2026-08-03')
    expect(doc!.withBerryUnits).toBe(89)
    expect(doc!.withBerryUnits).not.toBe(173)
  })
})

/**
 * §7 «Права: рівно дві ролі». Гейти стоять у сторі, а не лише в UI, з тієї самої причини,
 * що й `voidTransfer`: `setBy`/`sentBy` прибиті до OWNER, тому без перевірки документ
 * приймальника стверджував би, що його ухвалив керівник. Брехня в підписі гірша за
 * відсутність підпису.
 */
describe('права: керівницькі команди з пристрою приймальника', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
    useStore.setState({ role: 'operator' })
  })

  it('приймальник не змінює наділ ящиків: 6 записів як було', () => {
    const before = useStore.getState().crateAllotments.length
    expect(
      useStore.getState().setCrateAllotment({ pointId: 'p1', units: 900, effectiveFrom: TODAY, reason: 'спроба' }),
    ).toBeUndefined()
    expect(useStore.getState().crateAllotments.length).toBe(before)
  })

  it('приймальник не змінює наділ каси: діючий лишається 500 000,00', () => {
    expect(
      useStore.getState().setCashFloat({ pointId: 'p1', amount: 900_000, effectiveFrom: TODAY, reason: 'спроба' }),
    ).toBeUndefined()
    expect(cashOfPoint('p1').float).toBe(500_000)
  })

  it('приймальник не відправляє собі переказ: у касі лишається 1 616,10 ₴', () => {
    const before = useStore.getState().transfers.length
    expect(
      useStore.getState().sendTransfer({ pointId: 'p1', crates: 0, cash: 500_000, carrier: 'Перевізник Р.' }),
    ).toBeUndefined()
    expect(useStore.getState().transfers.length).toBe(before)
    expect(cashOfPoint('p1').berryCash).toBe(1_616.1)
  })

  it('а приймати переказ і видавати ящики приймальник МОЖЕ — це його робота (§7)', () => {
    useStore.setState({ role: 'owner' })
    const doc = useStore
      .getState()
      .sendTransfer({ pointId: 'p1', crates: 40, cash: 150_000, carrier: 'Перевізник Р.' })!
    useStore.setState({ role: 'operator' })
    useStore.setState({ role: 'operator' })
    expect(useStore.getState().acceptTransfer(doc.id)).toBeDefined()
    expect(useStore.getState().issueCrates({ pointId: 'p1', supplierId: 's7', units: 5 })).toBeDefined()
  })
})

/**
 * `G12` / `I58` — єдиний block на готівку в цих фазах. Три з пʼятьох рецензентів знайшли
 * незалежно, що `checkBerryPayout()` існувала, була протестована і НЕ ВИКЛИКАЛАСЯ ЗВІДКИ:
 * приймальник міг вивести касу за ягоду скільки завгодно в мінус, а екран лише фарбував
 * число червоним постфактум. Це прямий наслідок C10 — тієї самої клітинки на −118 089 ₴,
 * проти якої будується весь продукт.
 */
describe('G12: виплата впирається в касу за ягоду', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
  })

  it('на Шипинках у книзі 1 616,10 ₴ — виплата 42 500,00 не проходить і НЕ пишеться', () => {
    expect(cashOfPoint('p1').berryCash).toBe(1_616.1)
    const before = useStore.getState().payouts.length
    const supplierId = useStore.getState().receptions.find((r) => r.pointId === 'p1' && r.debt > 0)!
      .supplierId
    expect(
      useStore.getState().addPayout({
        date: TODAY,
        pointId: 'p1',
        supplierId,
        amount: 42_500,
        operator: 'Оксана Г.',
      }),
    ).toBeUndefined()
    expect(useStore.getState().payouts.length).toBe(before)
    expect(cashOfPoint('p1').berryCash).toBe(1_616.1)
  })

  it('візит, який виводить із шухляди більше, ніж у ній є, не створює жодної квитанції', () => {
    const before = useStore.getState().receptions.length
    const res = useStore.getState().addVisit({
      date: TODAY,
      pointId: 'p1',
      supplierId: useStore.getState().suppliers[0].id,
      operator: 'Оксана Г.',
      carriedIn: 0,
      paid: 10_000,
      lines: [
        {
          berryId: 'v_mal_v',
          gross: 72.6,
          pallet: 0,
          tare: [{ tareId: 'tr_cheshka', count: 1 }],
          tareWeight: 1.2,
          net: 71.43,
          price: 140,
          bonus: 0,
          amount: 10_000,
        },
      ],
    })
    expect(res).toBeUndefined()
    expect(useStore.getState().receptions.length).toBe(before)
  })

  it('рівно те, що є в касі, видати МОЖНА: 1 616,10 проходить', () => {
    const supplierId = useStore.getState().receptions.find((r) => r.pointId === 'p1' && r.debt > 0)!
      .supplierId
    expect(
      useStore.getState().addPayout({
        date: TODAY,
        pointId: 'p1',
        supplierId,
        amount: 1_616.1,
        operator: 'Оксана Г.',
      }),
    ).toBeDefined()
    expect(cashOfPoint('p1').berryCash).toBe(0)
  })

  it('після прийнятого переказу та сама виплата проходить: 150 000 → 42 500 можна', () => {
    useStore.setState({ role: 'owner' })
    const tf = useStore
      .getState()
      .sendTransfer({ pointId: 'p1', crates: 0, cash: 150_000, carrier: 'Перевізник Р.' })!
    useStore.setState({ role: 'operator' })
    useStore.setState({ role: 'operator' })
    useStore.getState().acceptTransfer(tf.id)
    expect(cashOfPoint('p1').berryCash).toBe(151_616.1)
    const supplierId = useStore.getState().receptions.find((r) => r.pointId === 'p1' && r.debt > 0)!
      .supplierId
    expect(
      useStore.getState().addPayout({
        date: TODAY,
        pointId: 'p1',
        supplierId,
        amount: 42_500,
        operator: 'Оксана Г.',
      }),
    ).toBeDefined()
  })

  it('завдатки за ящики виплату за ягоду НЕ фінансують: 15 416,10 у шухляді, а видати можна 1 616,10', () => {
    const cash = cashOfPoint('p1')
    expect(cash.expectedCash).toBe(15_416.1)
    expect(cash.crateCash).toBe(13_800)
    const supplierId = useStore.getState().receptions.find((r) => r.pointId === 'p1' && r.debt > 0)!
      .supplierId
    expect(
      useStore
        .getState()
        .addPayout({ date: TODAY, pointId: 'p1', supplierId, amount: 5_000, operator: 'Оксана Г.' }),
    ).toBeUndefined()
  })
})

/**
 * ЩАСЛИВА ГІЛКА МЕЖІ ПЕРСИСТУ — усі вісім нових ключів, а не два.
 *
 * Знайдено рецензією і відтворено мутацією: якщо звуження віддає `current` в ОБИДВА боки
 * (тобто мовчки викидає все, що людина ввела за день, і підставляє свіжий сід), то
 * 6 із 8 ключів проходили і повний набір тестів, і `ratchet:persist` — у ВСІХ восьми
 * випадках храповик лишався зеленим. Він перевіряє, що звуження НАПИСАНЕ, а не що воно
 * ПРАЦЮЄ; smoke теж не побачить, бо браузер щоразу починає з порожнім localStorage.
 *
 * Тому тут стверджується саме тотожність: із `merge` виходить РІВНО те, що прийшло в
 * payload, а не значення зі свіжого сіду.
 */
describe('персист: збережене справді відновлюється (усі вісім ключів)', () => {
  afterAll(() => vi.unstubAllGlobals())

  it('кожен із восьми нових ключів повертається з payload, а не із сіду', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const fresh = store.getState() as unknown as Record<string, unknown[]>

    /** По одному розпізнаваному запису на ключ: числа навмисно неможливі для сіду. */
    const kept: Record<string, unknown[]> = {
      crateAllotments: [
        { id: 'ka', pointId: 'p1', units: 777, effectiveFrom: TODAY, setBy: 'Керівник', setDate: TODAY, setTime: '07:07' },
      ],
      cashFloats: [
        { id: 'kf', pointId: 'p1', amount: 777_777, effectiveFrom: TODAY, setBy: 'Керівник', setDate: TODAY, setTime: '07:07' },
      ],
      crateIssues: [
        { id: 'ki', date: TODAY, time: '07:07', pointId: 'p1', supplierId: 's1', units: 777, mode: 'deposit', depositPerUnit: 120, depositTaken: 93_240, operatorId: 'О.' },
      ],
      crateReturns: [
        { id: 'kr', date: TODAY, time: '07:07', pointId: 'p1', supplierId: 's1', units: 7, allocations: [], depositRefund: 0, operatorId: 'О.' },
      ],
      crateShipments: [
        { id: 'ks', date: TODAY, pointId: 'p1', withBerryUnits: 777, receptionCount: 7, brokenUnits: 7, operatorId: 'О.', postedDate: TODAY, postedTime: '07:07' },
      ],
      transfers: [
        { id: 'kt', date: TODAY, pointId: 'p1', crates: 777, cash: 777.77, carrier: 'П.', sentBy: 'Керівник', sentTime: '07:07', status: 'sent' },
      ],
      shifts: [
        { id: 'kh', pointId: 'p1', operatorId: 'О.', date: TODAY, openedTime: '07:07', openingFloat: 777, status: 'open' },
      ],
      cashCounts: [
        { id: 'kc', shiftId: 'kh', pointId: 'p1', date: TODAY, at: '07:07', countedCash: 777, expectedAtCount: 777, discrepancy: 0, countedBy: 'О.' },
      ],
    }

    for (const [key, value] of Object.entries(kept)) {
      const merged = merge({ [key]: value }, fresh as never) as unknown as Record<string, unknown[]>
      // саме payload — і не сід
      expect(merged[key], `${key}: payload мусить пережити merge`).toEqual(value)
      expect(merged[key], `${key}: сідове значення не має підмінити payload`).not.toEqual(fresh[key])
    }
  })

  it('зіпсований payload на кожному з восьми ключів падає у СВІЖИЙ СІД, а не в порожнечу', async () => {
    const store = await persistedStore()
    const merge = store.persist.getOptions().merge!
    const fresh = store.getState() as unknown as Record<string, unknown[]>
    for (const key of [
      'crateAllotments',
      'cashFloats',
      'crateIssues',
      'crateReturns',
      'crateShipments',
      'transfers',
      'shifts',
      'cashCounts',
    ]) {
      const merged = merge({ [key]: 'зламано' }, store.getState()) as unknown as Record<string, unknown[]>
      expect(merged[key], key).toEqual(fresh[key])
    }
  })
})

/**
 * Сторно ящикових документів і вихід зі зміни, що чекала пояснення. Три з пʼятьох
 * рецензентів назвали це незалежно: поля `voidedDate` існували в типах, рушій по них
 * фільтрував, тести їх покривали — а СТАВИТИ їх не було чим, і `awaiting_explanation`
 * був глухим кутом назавжди.
 */
describe('сторно ящикових документів і закриття зміни керівником', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
  })

  it('UC-21 A4: друге відправлення дня можна сторнувати — 264 у нас, а не 439', () => {
    const st = useStore.getState()
    const dup = st.postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 0 })!
    expect(standingOfPoint('p1').atBase).toBe(264 + 173)
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().voidCrateShipment(dup.id, 'провели двічі')).toBeDefined()
    expect(standingOfPoint('p1').atBase).toBe(264)
    // документ НЕ зник — він лишився зі слідом
    const kept = useStore.getState().crateShipments.find((x) => x.id === dup.id)!
    expect(kept.voidedBy).toBe('Керівник')
    expect(kept.voidReason).toBe('провели двічі')
  })

  it('помилкова видача сторнується: 195 у людей і 13 800,00 ₴ повертаються', () => {
    const st = useStore.getState()
    const wrong = st.issueCrates({ pointId: 'p1', supplierId: 's7', units: 30 })!
    expect(standingOfPoint('p1').inField).toBe(225)
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().voidCrateIssue(wrong.id, 'вписали 30 замість 3')).toBeDefined()
    expect(standingOfPoint('p1').inField).toBe(195)
    expect(cashOfPoint('p1').crateCash).toBe(13_800)
  })

  it('приймальник сторнувати не може, і причина обовʼязкова', () => {
    const doc = useStore.getState().postShipment({ pointId: 'p1', date: TODAY, brokenUnits: 0 })!
    expect(useStore.getState().voidCrateShipment(doc.id, 'спроба')).toBeUndefined()
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().voidCrateShipment(doc.id, '   ')).toBeUndefined()
    expect(useStore.getState().voidCrateShipment(doc.id, 'причина')).toBeDefined()
    // вдруге той самий документ не сторнується
    expect(useStore.getState().voidCrateShipment(doc.id, 'ще раз')).toBeUndefined()
  })

  it('зміна з розбіжністю −10 000,00 виходить із глухого кута лише через керівника', () => {
    const shift = useStore
      .getState()
      .openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: 10_000 })!
    useStore.getState().closeShift({ shiftId: shift.id, countedCash: 1 })
    const stuck = useStore.getState().shifts.find((s) => s.id === shift.id)!
    expect(stuck.status).toBe('awaiting_explanation')
    // приймальник не закриває
    expect(useStore.getState().settleShift(shift.id, 'знайшли')).toBeUndefined()
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().settleShift(shift.id, '   ')).toBeUndefined()
    const done = useStore.getState().settleShift(shift.id, 'знайшли по камерах: передали зайве')!
    expect(done.status).toBe('closed')
    expect(done.closedBy).toBe('Керівник')
    // РОЗБІЖНІСТЬ НЕ ЗНИКЛА — вона лишилася в документі
    expect(done.discrepancy).toBe(stuck.discrepancy)
  })

  it('відкриту зміну «закрити поясненням» не можна — спершу перерахунок', () => {
    const shift = useStore
      .getState()
      .openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: 10_000 })!
    useStore.setState({ role: 'owner' })
    expect(useStore.getState().settleShift(shift.id, 'без перерахунку')).toBeUndefined()
    // Зміна мусить лишитися ВІДКРИТОЮ: «закрито поясненням» без перерахунку означало б
    // зміну, яку ніхто не рахував, зі статусом «розібралися».
    const after = useStore.getState().shifts.find((s) => s.id === shift.id)!
    expect(after.status).toBe('open')
    expect(after.closedBy).toBeUndefined()
  })
})

describe('валідація чисел і дат у командах', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date(`${TODAY}T12:30:00`))
    useStore.getState().resetDemo()
    useStore.setState({ role: 'owner' })
  })

  it('наділ із датою не-ISO не пишеться: 6 записів як було', () => {
    const before = useStore.getState().crateAllotments.length
    expect(
      useStore.getState().setCrateAllotment({ pointId: 'p1', units: 900, effectiveFrom: 'завтра', reason: 'спроба' }),
    ).toBeUndefined()
    expect(useStore.getState().crateAllotments.length).toBe(before)
  })

  it('відправлення майбутнім днем не пишеться', () => {
    const before = useStore.getState().crateShipments.length
    expect(useStore.getState().postShipment({ pointId: 'p1', date: '2027-01-01', brokenUnits: 3 })).toBeUndefined()
    expect(useStore.getState().crateShipments.length).toBe(before)
    expect(useStore.getState().crateShipments.some((s) => s.date > TODAY)).toBe(false)
  })

  it('зміна не відкривається з NaN і з мінусом', () => {
    const before = useStore.getState().shifts.length
    expect(
      useStore.getState().openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: Number.NaN }),
    ).toBeUndefined()
    expect(
      useStore.getState().openShift({ pointId: 'p2', operatorId: 'Тарас Б.', openingFloat: -50_000 }),
    ).toBeUndefined()
    // Жодної нової зміни, і в жодній наявній немає NaN: `openingFloat: NaN` пройшов би в
    // документ мовчки, а на екрані став би «NaN ₴» аж на перерахунку.
    expect(useStore.getState().shifts.length).toBe(before)
    expect(useStore.getState().shifts.every((s) => Number.isFinite(s.openingFloat))).toBe(true)
  })

  it('заявка «не сходиться» без коментаря не пишеться', () => {
    const doc = useStore
      .getState()
      .sendTransfer({ pointId: 'p1', crates: 40, cash: 150_000, carrier: 'Перевізник Р.' })!
    useStore.setState({ role: 'operator' })
    expect(
      useStore.getState().disputeTransfer(doc.id, { reportedCrates: 38, reportedCash: 150_000, note: '  ' }),
    ).toBeUndefined()
    expect(useStore.getState().transfers.find((t) => t.id === doc.id)!.status).toBe('sent')
  })
})
