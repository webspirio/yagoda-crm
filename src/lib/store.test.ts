import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from './store'
import { TODAY } from './seed'

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
