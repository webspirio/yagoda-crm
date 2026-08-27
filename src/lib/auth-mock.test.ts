import { describe, expect, it } from 'vitest'
import { authenticate } from './auth-mock'
import type { User } from './types'

const STAMP = { date: '2026-08-04', time: '07:10' }

const USERS: User[] = [
  { id: 'u_owner', name: 'Керівник', role: 'owner', login: 'owner' },
  { id: 'u_p1', name: 'Оксана Г.', role: 'operator', pointId: 'p1', login: 'p1' },
]

describe('authenticate', () => {
  it('правильна пара — сесія на цю людину', () => {
    expect(authenticate(USERS, 'p1', '1111', STAMP)).toEqual({
      ok: true,
      session: { userId: 'u_p1', startedDate: STAMP.date, startedTime: STAMP.time },
    })
  })

  it('невідомий логін', () => {
    expect(authenticate(USERS, 'zzz', '1111', STAMP)).toEqual({ ok: false, reason: 'unknown-login' })
  })

  it('хибний секрет', () => {
    expect(authenticate(USERS, 'p1', '9999', STAMP)).toEqual({ ok: false, reason: 'wrong-secret' })
  })

  /*
   * Логін і секрет підійшли б реальній п. Оксані, але саме її запису в реєстрі немає — це
   * та сама відмінність, яку бачить сервер, коли токен видали, а профіль видалили: пара
   * зійшлася, облікового запису для неї немає.
   */
  it('пара зійшлася, а реєстр порожній — no-account', () => {
    expect(authenticate([], 'p1', '1111', STAMP)).toEqual({ ok: false, reason: 'no-account' })
  })

  it('логін нечутливий до регістру й крайніх пробілів', () => {
    expect(authenticate(USERS, '  P1  ', '1111', STAMP)).toEqual({
      ok: true,
      session: { userId: 'u_p1', startedDate: STAMP.date, startedTime: STAMP.time },
    })
    expect(authenticate(USERS, 'Owner', '1111', STAMP).ok).toBe(true)
  })

  /*
   * Секрет — ЧУТЛИВИЙ, на відміну від логіна. Пробіл усередині чи скраю пароля — це
   * законний символ пароля, і мовчки його зрізати означало б тихо змінювати те, що людина
   * набрала руками на точці.
   */
  it('секрет чутливий до пробілів — не обрізається й не нормалізується', () => {
    expect(authenticate(USERS, 'p1', ' 1111', STAMP)).toEqual({ ok: false, reason: 'wrong-secret' })
    expect(authenticate(USERS, 'p1', '1111 ', STAMP)).toEqual({ ok: false, reason: 'wrong-secret' })
  })
})
