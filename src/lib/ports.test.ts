import { describe, expect, it } from 'vitest'
import { useStore } from './store'
import type { DomainSnapshot } from './ports'

/** Кожна команда з контракту існує в сторі як функція. */
const COMMANDS = [
  'addSupplier',
  'updateSupplier',
  'updateTareType',
  'updateSettings',
  'setPrice',
  'setPriceEverywhere',
  'addVisit',
  'addPayout',
  'syncAll',
  'resetDemo',
] as const
const QUERIES = ['priceFor', 'priceHistory'] as const
const DOMAIN = [
  'points',
  'berries',
  'tareTypes',
  'suppliers',
  'prices',
  'receptions',
  'payouts',
  'settings',
] as const

describe('контракт store ↔ ports', () => {
  it('усі команди й запити на місці', () => {
    const st = useStore.getState()
    for (const k of [...COMMANDS, ...QUERIES]) expect(typeof st[k], k).toBe('function')
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
      settings: true,
    }
    expect(Object.keys(keys).sort()).toEqual([...DOMAIN].sort())
  })
})
