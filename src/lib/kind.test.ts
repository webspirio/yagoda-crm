import { describe, expect, it } from 'vitest'
import { KIND_LABEL, kindHint } from './kind'

describe('маркер постачальника', () => {
  it('підпис для кожного значення', () => {
    expect(KIND_LABEL.none).toBe('')
    expect(KIND_LABEL.wholesale).toBe('ОПТ')
    expect(KIND_LABEL.farmer).toBe('Фермер')
  })

  it('підказка — дослівно те, що попросив клієнт: «додайте», не «перевірте»', () => {
    expect(kindHint('wholesale')).toBe('Це оптовик. Додайте додаткову ціну.')
    expect(kindHint('farmer')).toBe('Це фермер. Додайте додаткову ціну.')
    expect(kindHint('none')).toBeUndefined()
  })
})
