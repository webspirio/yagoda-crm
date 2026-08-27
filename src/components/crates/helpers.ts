import { crateBalance } from '@/lib/calc'
import { num, plural } from '@/lib/format'
import type { CrateBalance } from '@/lib/calc'
import type { CrateIssue, CrateReturn, Supplier } from '@/lib/types'

/*
 * Слова і збірка рядків для розділу «Ящики». ЖОДНОЇ АРИФМЕТИКИ тут немає і бути не може:
 * і склад наділу, і баланс людини рахує `calc.ts`, а цей файл лише вибирає, кого показати
 * і яким словом це назвати. Причина та сама, з якої гроші рахує рушій: два місця, де
 * рахують ящики, рано чи пізно розійдуться на одиницю — і ніхто не побачить, яке з них праве.
 *
 * Компонентів тут немає навмисно: файл з компонентом і не-компонентом разом валить
 * `react/only-export-components`, а виняток на це правило храповиком закритий.
 */

/** «1 ящик · 2 ящики · 5 ящиків» */
export function crateWord(n: number) {
  return plural(n, 'ящик', 'ящики', 'ящиків')
}

/**
 * `I62` дослівно: «на точці зараз 341 порожній ящик» — прикметник відмінюється теж.
 *
 * `Math.abs` тут не косметика: пустих на точці буває МЕНШЕ НУЛЯ (наділ пробитий —
 * `CrateStandingBar` малює це червоним), і `plural(−307)` брав би `n % 10 = −7`, тобто
 * завжди останню форму. На «−1 порожніх ящиків» це видно одразу, а на «−21» — ні.
 */
export function emptyCrateWord(n: number) {
  return plural(Math.abs(n), 'порожній ящик', 'порожні ящики', 'порожніх ящиків')
}

/** «11 осіб» у шапці таблиці «У ЛЮДЕЙ» */
export function personWord(n: number) {
  return plural(n, 'особа', 'особи', 'осіб')
}

/** «порахувала програма з 3 квитанцій» — після «з» завжди родовий */
export function receiptWord(n: number) {
  return plural(n, 'квитанції', 'квитанцій', 'квитанцій')
}

/**
 * Колонка «як брала». Слова — клієнтчині: «за кошти» і «розписка» (1081), не «депозит».
 * Людина може мати обидва способи одночасно (журнал клієнтки: 20 за кошти + 70 за
 * розписку), і тоді показуємо ОБА числа, а не найбільше з них: саме на цьому рядку
 * видно, що завдаток лежить не за всі її ящики.
 */
export function modeLabel(b: CrateBalance) {
  if (b.receipt === 0) return 'за кошти'
  if (b.deposit === 0) return 'розписка'
  return `за кошти ${num(b.deposit)} · розписка ${num(b.receipt)}`
}

export interface InFieldRow {
  supplier: Supplier
  balance: CrateBalance
}

/**
 * Хто зараз тримає ящики цієї точки. Відбір — по точці (брала ТУТ), а баланс — по ЛЮДИНІ:
 * рівно так, як його веде `crateBalance()` і як його читає команда `returnCrates()`. Це не
 * недогляд, а єдине джерело правди: якби таблиця рахувала свій, точковий баланс, вона
 * показувала б одне число, а вікно повернення — інше, і розійшлися б вони мовчки.
 *
 * Наслідок цього рішення видно на екрані, а не в коментарі: сума по людях і «у людей» зі
 * складу наділу — два різні підрахунки, і `InFieldTable` малює окремий рядок, якщо вони
 * не збіглися (людина повернула ящики не на тій точці, де брала).
 */
export function inFieldRows(
  pointId: string,
  suppliers: Supplier[],
  issues: CrateIssue[],
  returns: CrateReturn[],
): InFieldRow[] {
  const here = new Set(
    issues.filter((i) => i.pointId === pointId && !i.voidedDate).map((i) => i.supplierId),
  )
  return suppliers
    .filter((s) => here.has(s.id))
    .map((s) => ({ supplier: s, balance: crateBalance(s.id, issues, returns) }))
    .filter((r) => r.balance.units > 0)
    .sort(
      (a, b) =>
        b.balance.units - a.balance.units ||
        a.supplier.name.localeCompare(b.supplier.name, 'uk'),
    )
}
