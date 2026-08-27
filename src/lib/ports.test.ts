import { describe, expect, it } from 'vitest'
import { useStore } from './store'
import type { AuthCommands, Commands, DomainSnapshot, Queries } from './ports'

/**
 * Кожна команда з контракту існує в сторі як функція.
 *
 * `Record<keyof Commands, true>`, а не масив рядків, — з тієї самої причини, що вже
 * записана нижче для `DomainSnapshot`: масив ніщо не звіряло з інтерфейсом, і він
 * ВІДСТАВ. Зміряно 27.08.2026: `Commands` оголошував 31 метод, список пінив 27, а
 * непінованими були рівно ті чотири, у яких найдорожча відмова — `settleShift`,
 * `voidCrateIssue`, `voidCrateReturn`, `voidCrateShipment`. Тобто стор міг втратити
 * будь-яке зі сторно ящиків, і жоден тест не сказав би й слова. Тепер дрейф ловиться в
 * обидва боки й на КОМПІЛЯЦІЇ: додали метод у `Commands` і забули тут — червоно;
 * прибрали звідси — червоно.
 */
const COMMANDS: Record<keyof Commands, true> = {
  addSupplier: true,
  updateSupplier: true,
  updateTareType: true,
  updateSettings: true,
  setPrice: true,
  setPriceEverywhere: true,
  addVisit: true,
  addPayout: true,
  addReweigh: true,
  voidReweigh: true,
  addExpense: true,
  removeExpense: true,
  setExpensePolicy: true,
  /* ---- ящики і каса як підзвіт (21 §2): шістнадцять команд, усі тільки INSERT ---- */
  setCrateAllotment: true,
  setCashFloat: true,
  issueCrates: true,
  returnCrates: true,
  postShipment: true,
  sendTransfer: true,
  acceptTransfer: true,
  disputeTransfer: true,
  voidTransfer: true,
  /* Ці чотири інтерфейс оголошував, а список НЕ пінив — саме їх і знайшов новий Record */
  voidCrateIssue: true,
  voidCrateReturn: true,
  voidCrateShipment: true,
  settleShift: true,
  openShift: true,
  countCash: true,
  closeShift: true,
  syncAll: true,
  resetDemo: true,
}
const QUERIES: Record<keyof Queries, true> = { priceFor: true, priceHistory: true }
/**
 * Дві команди сесії — окремим `Record`, бо вони й у контракті окремим інтерфейсом
 * (`AuthCommands`): `Commands` — це документи, а вхід документа не створює. Форма та сама,
 * тому дрейф ловиться так само в обидва боки й на КОМПІЛЯЦІЇ.
 */
const AUTH: Record<keyof AuthCommands, true> = { signIn: true, signOut: true }
const DOMAIN = [
  'points',
  'berries',
  'tareTypes',
  'suppliers',
  'prices',
  'receptions',
  'payouts',
  'reweighs',
  'expenses',
  'policies',
  'crateAllotments',
  'cashFloats',
  'crateIssues',
  'crateReturns',
  'crateShipments',
  'transfers',
  'shifts',
  'cashCounts',
  'settings',
  'products',
  'users',
  'config',
] as const

describe('контракт store ↔ ports', () => {
  it('усі команди й запити на місці', () => {
    const st = useStore.getState()
    const names = [
      ...(Object.keys(COMMANDS) as (keyof Commands)[]),
      ...(Object.keys(QUERIES) as (keyof Queries)[]),
      ...(Object.keys(AUTH) as (keyof AuthCommands)[]),
    ]
    // 31 команда + 2 запити + 2 команди сесії. Число тут навмисно: якщо літерали колись
    // звузять разом, `tsc` промовчить, а цей рядок — ні. Було 33 до фази 4.
    expect(names.length).toBe(35)
    for (const k of names) expect(typeof st[k], k).toBe('function')
  })

  it('серверна частина снапшоту серіалізовна', () => {
    const st = useStore.getState()
    for (const k of DOMAIN) {
      // якщо тут з'явиться Date, Map або функція — бекенд це не перекладе в JSON
      expect(() => JSON.parse(JSON.stringify(st[k]))).not.toThrow()
      expect(JSON.parse(JSON.stringify(st[k])), k).toEqual(st[k])
    }
  })

  /**
   * Межа «моє / спільне» — на компіляції, не на рантаймі.
   *
   * Попередня версія цього тесту (дослівно з docs/17 §D п.6) стверджувала
   * `expect(DOMAIN).not.toContain('role')` — тобто що масив, написаний трьома рядками
   * вище в цьому ж файлі, не містить рядка, якого туди не писали. Він не міг впасти
   * НІКОЛИ і про `DomainSnapshot` не казав нічого.
   *
   * `Record<keyof DomainSnapshot, true>` ловить дрейф в ОБА боки: додали ключ у
   * `DomainSnapshot` і забули тут — червоно; прибрали звідси — червоно. А якщо в
   * `DomainSnapshot` колись потрапить `role`, `route` чи `online`, цей літерал
   * вимагатиме їх дописати — і саме там буде видно, що пристроєве поїхало в спільне.
   * Два ноутбуки інакше почали б перезаписувати одне одному роль.
   */
  it('снапшот складається РІВНО з тих ключів, які перелічує DOMAIN', () => {
    const keys: Record<keyof DomainSnapshot, true> = {
      points: true,
      berries: true,
      tareTypes: true,
      suppliers: true,
      prices: true,
      receptions: true,
      payouts: true,
      reweighs: true,
      expenses: true,
      policies: true,
      crateAllotments: true,
      cashFloats: true,
      crateIssues: true,
      crateReturns: true,
      crateShipments: true,
      transfers: true,
      shifts: true,
      cashCounts: true,
      settings: true,
      products: true,
      users: true,
      config: true,
    }
    expect(Object.keys(keys).sort()).toEqual([...DOMAIN].sort())
  })
})
