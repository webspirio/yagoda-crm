import { describe, expect, it } from 'vitest'
import { actorName, canActOnPoint, roleOf, scopeAfterSignIn, sessionUser } from './auth'
import type { Session, User } from './types'

const OWNER: User = { id: 'u_owner', name: 'Керівник', role: 'owner', login: 'owner' }
const P1: User = { id: 'u_p1', name: 'Оксана Г.', role: 'operator', pointId: 'p1', login: 'p1' }
const P2: User = { id: 'u_p2', name: 'Тарас Б.', role: 'operator', pointId: 'p2', login: 'p2' }
const USERS = [OWNER, P1, P2]
const s = (userId: string): Session => ({
  userId,
  startedDate: '2026-08-04',
  startedTime: '07:10',
})

describe('sessionUser', () => {
  it('знаходить людину по userId', () => {
    expect(sessionUser(USERS, s('u_p1'))).toBe(P1)
  })

  it('немає сесії — немає людини', () => {
    expect(sessionUser(USERS, null)).toBeNull()
  })

  /*
   * Сесія на id, якого немає в реєстрі. Це те саме, що робить сервер із токеном видаленого
   * користувача, і ЄДИНА перевірка входу, результат якої не залежить від того, що людина
   * набрала. Захистом вона від цього не стає: реєстр лежить у тому самому браузері.
   */
  it('сесія на неіснуючий id — це відсутність сесії, а не «хтось»', () => {
    expect(sessionUser(USERS, s('u_zzz'))).toBeNull()
    expect(sessionUser([], s('u_p1'))).toBeNull()
  })
})

describe('actorName', () => {
  it('віддає імʼя з реєстру', () => {
    expect(actorName(USERS, s('u_p1'))).toBe('Оксана Г.')
    expect(actorName(USERS, s('u_owner'))).toBe('Керівник')
  })

  /*
   * `null`, а не запасний рядок. До фази 4 запасних підписів було ПʼЯТЬ: `point.name`,
   * `'Каса'`, `'Приймальник'`, назва ролі і — найгірший — `signerFor(…) ?? ownerName(…)`,
   * який виглядає як імʼя людини й тому невидимий очима. Команда без підпису мусить
   * ВІДМОВИТИ (22-tz §18.4).
   */
  it('без сесії не вигадує підпису', () => {
    expect(actorName(USERS, null)).toBeNull()
    expect(actorName(USERS, s('u_zzz'))).toBeNull()
  })
})

describe('roleOf', () => {
  it('читає роль із реєстру', () => {
    expect(roleOf(USERS, s('u_owner'))).toBe('owner')
    expect(roleOf(USERS, s('u_p1'))).toBe('operator')
  })

  // `null` деградує до найсуворішого: жодна перевірка `=== 'owner'` його не пропустить
  it('без сесії роль невідома, а не «приймальник»', () => {
    expect(roleOf(USERS, null)).toBeNull()
  })
})

describe('canActOnPoint', () => {
  it('керівник діє на будь-якій точці, включно з базою і зведенням', () => {
    expect(canActOnPoint(OWNER, 'p1')).toBe(true)
    expect(canActOnPoint(OWNER, 'base')).toBe(true)
    expect(canActOnPoint(OWNER, 'all')).toBe(true)
  })

  it('приймальник — тільки на своїй', () => {
    expect(canActOnPoint(P1, 'p1')).toBe(true)
    expect(canActOnPoint(P1, 'p2')).toBe(false)
    expect(canActOnPoint(P1, 'base')).toBe(false)
    expect(canActOnPoint(P1, 'all')).toBe(false)
  })

  it('немає людини — немає права', () => {
    expect(canActOnPoint(null, 'p1')).toBe(false)
  })

  /*
   * Приймальник без точки — зламані дані, а не «приймальник усіх точок». Дозволити тут усе
   * означало б, що зіпсований запис реєстру дає ШИРШІ права, ніж правильний.
   */
  it('приймальник без точки не діє ніде', () => {
    expect(canActOnPoint({ ...P1, pointId: undefined }, 'p1')).toBe(false)
  })
})

describe('scopeAfterSignIn', () => {
  it('керівник — усі точки і «Зведення»', () => {
    expect(scopeAfterSignIn(OWNER)).toEqual({ activePointId: 'all', route: { name: 'dashboard' } })
  })

  /*
   * Раніше тут стояв ЛІТЕРАЛ 'p1' (store.ts:239, setRole), тому «увійти приймальником»
   * завжди кидало на Шипинки, хто б це не був. Тест саме на другу точку.
   */
  it('приймальник — СВОЯ точка і «Прийомка»', () => {
    expect(scopeAfterSignIn(P2)).toEqual({ activePointId: 'p2', route: { name: 'reception' } })
  })
})
