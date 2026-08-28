import * as React from 'react'
import { Calculator, CheckCircle2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Eyebrow } from '@/components/common/bits'
import { maskDecimalInput, parseNumeric } from '@/lib/calc'
import { uah } from '@/lib/format'
import { useScope, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { CashCount, ISODate, Shift } from '@/lib/types'

/** Копійка розбіжності — це вже розбіжність; нуль тут рівно один. */
const matched = (v: number) => Math.abs(v) < 0.005

/**
 * Стан зміни словами. Ключ — `string`, а не `Shift['status']`, з тієї самої причини, що і
 * в `TransferStateBadge`: статус приїжджає з `localStorage`, і невідомий рядок мусить
 * надрукуватися, а не впасти на `.toUpperCase()` неіснуючого запису.
 */
const SHIFT_LABEL: Record<string, string> = {
  open: 'відкрита',
  awaiting_explanation: 'очікує пояснення керівника',
  closed: 'закрита',
}

function shiftLabel(status: Shift['status']) {
  const known: string | undefined = SHIFT_LABEL[status]
  return known ?? `стан невідомий: ${String(status)}`
}

/**
 * Перерахунок каси серед дня і зміна цього дня (`21 §Н17`, `§3.6`, `UC-22` кроки 4–5).
 *
 * ДВА ПРАВИЛА, ЯКІ ВИГЛЯДАЮТЬ ЯК ПРОТИРІЧЧЯ І НИМ НЕ Є. На самому екрані каси очікувана
 * сума видима ЗАВЖДИ — «в який-любий час вони могли би бачити це» (1203). А в цьому
 * вікні вона СХОВАНА, поки не введено факт (`06 §7.5`): якби система показала очікуване
 * до вводу, перерахунок перетворився б на переписування. Тому число з'являється тут лише
 * після «Порахував», і приходить воно зі знімка `CashCount.expectedAtCount`, а не з
 * поточного стану — пізніша подія дня не має права переписати вже показану розбіжність.
 *
 * РОЗБІЖНІСТЬ НІЧОГО НЕ ВИПРАВЛЯЄ. Поля для неї немає в жодної ролі (`I70`); екран каже
 * зателефонувати на базу — це дослівний переказ рядка 1222: «так як він нічого не може
 * змінити в програмі… І це він має набрати нас. І ми маємо це знайти».
 *
 * ЗМІНА ДНЯ ПОКАЗУЄТЬСЯ БУДЬ-ЯКОГО СТАТУСУ, І ЦЕ ГОЛОВНА ПРАВКА ЦЬОГО ФАЙЛА. Раніше пошук
 * стояв на `status === 'open'`, і наслідків було три, усі однаково погані. Перший: на
 * Гайовому зміна в сіді ЗАКРИТА, і панель писала «Зміни на цей день немає» — про день, у
 * якому зміна є, зведена і зійшлася. Другий: після власного закриття панель пропонувала
 * «Відкрити зміну», тобто вчила заводити ДРУГУ книгу на ту саму шухляду (стор таке
 * відмовляє лише поки перша `open`, а закритий день пускає — і тоді на день дві зміни).
 * Третій: текст обіцяв «пішла керівникові зі статусом Очікує пояснення», а побачити цю
 * зміну не міг НІХТО й НІДЕ — `awaiting_explanation` був глухим кутом на екрані так само,
 * як був ним у сторі до появи `settleShift`.
 *
 * Розбіжність при закритті НЕ ЗНИКАЄ і не підганяється (`06 §7.5` п. 4): вона лишається в
 * документі й друкується тут після закриття так само, як друкувалася до нього. Керівник
 * додає лише пояснення і свій підпис.
 */
export function CashCountPanel({ pointId, date }: { pointId: string; date: ISODate }) {
  const shifts = useStore((s) => s.shifts)
  const cashCounts = useStore((s) => s.cashCounts)
  const countCash = useStore((s) => s.countCash)
  const openShift = useStore((s) => s.openShift)
  const closeShift = useStore((s) => s.closeShift)
  const settleShift = useStore((s) => s.settleShift)
  const config = useStore((s) => s.config)
  // Роль — через `useScope()`, а не пропом: керівницьких дій приймальникові тут не
  // показують узагалі, і рішення про це має ухвалюватися в тому самому файлі, що їх малює.
  const { role } = useScope()
  const isOperator = role === 'operator'
  const isOwner = role === 'owner'

  const [countOpen, setCountOpen] = React.useState(false)
  const [counted, setCounted] = React.useState('')
  const [done, setDone] = React.useState<CashCount | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [shiftOpen, setShiftOpen] = React.useState(false)
  const [morning, setMorning] = React.useState('')
  const [shiftError, setShiftError] = React.useState('')
  const [closeOpen, setCloseOpen] = React.useState(false)
  const [evening, setEvening] = React.useState('')
  const [closed, setClosed] = React.useState<Shift | null>(null)
  const [closeRefused, setCloseRefused] = React.useState(false)
  const [settleText, setSettleText] = React.useState('')
  const [settleError, setSettleError] = React.useState('')

  // Зміна ДНЯ, будь-якого статусу. Друга змінна — та сама зміна, але лише поки вона
  // відкрита: `countCash` і `closeShift` вимагають саме `open`, і передати їм закриту
  // означало б показати кнопку, яка мовчки не працює.
  const shift = shifts.find((s) => s.pointId === pointId && s.date === date) ?? null
  const openOne = shift && shift.status === 'open' ? shift : null
  const counts = cashCounts
    .filter((c) => c.pointId === pointId && c.date === date)
    .sort((a, b) => a.at.localeCompare(b.at))

  const closeCount = () => {
    setCountOpen(false)
    setDone(null)
    setRefused(false)
    setCounted('')
  }

  const submitCount = () => {
    if (!openOne) return
    // Межа стоїть ТУТ, а не лише в `disabled` кнопки. Причина зміряна: `onKeyDown` кличе цю
    // функцію напряму, поле має `autoFocus`, а `maskDecimalInput(',')` дає '.', яке проходить
    // `trim() !== ''` — тобто одне рефлекторне Enter створювало незворотний `CashCount` із
    // нулем і розбіжністю на всю касу. Домашній зразок (`CostOfDayPage.addRow`) тримає
    // перевірку саме всередині, і тому Enter там безпечний.
    if (!Number.isFinite(parseNumeric(counted)) || counted.trim() === '' || parseNumeric(counted) <= 0) {
      setRefused(true)
      return
    }
    // Єдине число, яке вводить людина. Очікувану суму й розбіжність рахує стор рушієм —
    // тут їх ніхто не передає і передати не може.
    const doc = countCash({ shiftId: openOne.id, countedCash: parseNumeric(counted) })
    // Стор відмовляє порожнім значенням, а не винятком (`ports.ts`). Мовчазна кнопка,
    // яка нічого не робить, — гірше за відмову, названу вголос.
    if (doc) setDone(doc)
    else setRefused(true)
  }

  const submitClose = () => {
    if (!openOne) return
    // Те саме, і тут ціна помилки вища: закриття незворотне, а зміну зі статусом
    // «Очікує пояснення» закриває вже керівник, а не той, хто рахував.
    if (!Number.isFinite(parseNumeric(evening)) || evening.trim() === '' || parseNumeric(evening) <= 0) {
      setCloseRefused(true)
      return
    }
    // Те саме правило, що й у перерахунку: людина вводить ОДНЕ число, а очікуване й
    // розбіжність рахує стор. Порогів у v1 немає (`Q-23`), тому будь-яка розбіжність ≠ 0
    // лишає зміну в статусі «Очікує пояснення», і закриває її керівник (`06 §6` п. 5).
    const doc = closeShift({ shiftId: openOne.id, countedCash: parseNumeric(evening) })
    // «Мовчазна кнопка, яка нічого не робить, — гірше за відмову, названу вголос» —
    // правило з `submitCount` за сім рядків вище; тут його бракувало.
    if (doc) setClosed(doc)
    else setCloseRefused(true)
  }

  const submitShift = () => {
    // `openShift` повертає `undefined` на NaN, на відʼємній сумі і на другій відкритій
    // зміні тієї самої точки. До цієї правки жодну з трьох відмов не було видно.
    if (!Number.isFinite(parseNumeric(morning)) || morning.trim() === '' || parseNumeric(morning) < 0) {
      setShiftError('Уведіть суму, яку порахували в шухляді на ранок, — числом, не менше нуля.')
      return
    }
    // `operatorId` більше не передається: підпис під зміною — імʼя того, хто ЗАРАЗ за
    // компʼютером, і ставить його стор. До фази 4 сюди йшов приймальник точки з довідника,
    // тобто зміну можна було відкрити на чуже імʼя з будь-якого пристрою.
    const doc = openShift({ pointId, openingFloat: parseNumeric(morning) })
    if (!doc) {
      setShiftError(
        'Зміну не відкрито: або на цій точці вже є відкрита зміна (двох книг на одну шухляду не буває), або ця точка не ваша.',
      )
      return
    }
    setShiftOpen(false)
    setMorning('')
    setShiftError('')
  }

  const submitSettle = () => {
    if (!shift) return
    if (!settleText.trim()) {
      setSettleError('Пояснення обовʼязкове: саме воно лишається в документі поруч із розбіжністю.')
      return
    }
    const doc = settleShift(shift.id, settleText.trim())
    if (!doc) {
      setSettleError(
        'Зміну не закрито: це право керівника, і лише для зміни, яка чекає на пояснення.',
      )
      return
    }
    setSettleText('')
    setSettleError('')
  }

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <Eyebrow className="mb-3">Зміна і перерахунок каси</Eyebrow>

      {/* ---------- зміна цього дня, БУДЬ-ЯКОГО статусу ---------- */}
      {shift ? (
        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-sm font-medium">Зміна {shiftLabel(shift.status)}</span>
            <span className="font-mono text-xs text-muted-foreground">
              з {shift.openedTime}
              {shift.closedTime ? ` до ${shift.closedTime}` : ''}
            </span>
          </div>

          <div className="mt-2 flex flex-col gap-1 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">На ранок порахували</span>
              <span className="shrink-0 font-mono tabular-nums">
                {uah(shift.openingFloat, { decimals: 2 })}
              </span>
            </div>
            {shift.countedCash === undefined ? null : (
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-muted-foreground">На кінець дня порахували</span>
                <span className="shrink-0 font-mono tabular-nums">
                  {uah(shift.countedCash, { decimals: 2 })}
                </span>
              </div>
            )}
            {shift.discrepancy === undefined ? null : (
              <div
                className={cn(
                  'mt-1 flex items-center justify-between gap-4 rounded-lg px-3 py-2',
                  matched(shift.discrepancy)
                    ? 'bg-[var(--leaf)]/10 text-[var(--leaf)]'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {matched(shift.discrepancy) ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                  Розбіжність
                </span>
                <span className="shrink-0 font-mono font-semibold tabular-nums">
                  {uah(shift.discrepancy, { decimals: 2 })}
                </span>
              </div>
            )}
          </div>

          {shift.closedBy ? (
            <div className="mt-2 text-xs text-muted-foreground">закрив {shift.closedBy}</div>
          ) : null}
          {shift.explanation ? (
            <div className="mt-1 text-xs italic text-muted-foreground">«{shift.explanation}»</div>
          ) : null}
        </div>
      ) : null}

      {/* ---------- глухий кут, який тепер має вихід ---------- */}
      {shift && shift.status === 'awaiting_explanation' ? (
        isOwner ? (
          <div className="mb-4 rounded-lg bg-destructive/10 p-3">
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4 shrink-0" />
              Зміна чекає на ваше пояснення
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Закриття НЕ гасить розбіжності й не підганяє очікуваної суми: число лишається в
              документі й далі стоятиме тут. Додається лише те, що ви знайшли, і ваш підпис.
            </p>
            <Textarea
              value={settleText}
              onChange={(e) => {
                setSettleText(e.target.value)
                setSettleError('')
              }}
              rows={2}
              placeholder="що знайшли: виплату провели двічі, гроші на місці"
              className="mt-2 bg-background"
            />
            {settleError ? <p className="mt-1 text-xs text-destructive">{settleError}</p> : null}
            <Button
              size="sm"
              className="mt-2"
              onClick={submitSettle}
              disabled={!settleText.trim()}
            >
              Закрити зміну з поясненням
            </Button>
          </div>
        ) : (
          <p className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
            Зміна пішла керівникові зі статусом «Очікує пояснення». Змінити цю цифру в
            програмі не можна — зателефонуйте на базу: керівник знайде, де розійшлося, і
            закриє зміну сам.
          </p>
        )
      ) : null}

      {counts.length ? (
        <div className="flex flex-col gap-1.5">
          {counts.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Перерахунок о {c.at}
                {matched(c.discrepancy) ? (
                  <span className="ml-2 text-[var(--leaf)]">✓ зійшлося</span>
                ) : (
                  <span className="ml-2 text-destructive">⚠ не зійшлося</span>
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {uah(c.countedCash, { decimals: 2 })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Цього дня касу ще не перераховували.</p>
      )}

      <div className="mt-4">
        {openOne ? (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              Кнопка загорнута в `isOperator` тими самими дужками, що й дві сусідні. До
              28.08.2026 вона їх НЕ мала, а стор із фази 4 гейтить `countCash` роллю — тобто
              керівник бачив кнопку, вводив суму й отримував відмову, яка називала дві хибні
              причини («уведіть суму числом більшим за нуль… і лише поки зміна відкрита»),
              бо про роль там не сказано нічого. `06 §5.3`: UI лише ПОВТОРЮЄ рішення рушія.
              Кнопки немає, а не «є, але сіра» — те саме правило, що на «Касі точки».
            */}
            {isOperator ? (
              <Button variant="outline" size="sm" onClick={() => setCountOpen(true)}>
                <Calculator className="size-4" />
                Перерахувати касу
              </Button>
            ) : null}
            {isOperator && date === config.businessToday ? (
              <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                Закрити зміну
              </Button>
            ) : null}
          </div>
        ) : shift ? (
          /* Зміна дня вже є — «Відкрити зміну» тут не пропонують НІКОЛИ: друга книга на ту
             саму шухляду і є та помилка, заради якої цей рядок написаний. */
          <span className="text-xs leading-relaxed text-muted-foreground">
            Зміну цього дня вже зведено. Другої книги на ту саму шухляду не заводять, і
            перерахунок до закритої зміни не чіпляється.
          </span>
        ) : isOperator && date === config.businessToday ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShiftOpen(true)}>
              Відкрити зміну
            </Button>
            <span className="text-xs text-muted-foreground">
              перерахунок чіпляється до відкритої зміни
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            Зміни на цей день немає — перерахунок нема до чого підчепити.
          </span>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Рахувати можна скільки завгодно разів на день — кожен перерахунок лишається окремим
        записом і нічого не виправляє.
      </p>

      {/* ---------- вікно закриття зміни ---------- */}
      <Dialog
        open={closeOpen}
        onOpenChange={(v) => {
          if (!v) {
            setCloseOpen(false)
            setClosed(null)
            setEvening('')
            setCloseRefused(false)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Закрити зміну</DialogTitle>
          </DialogHeader>

          {closed === null ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                Порахуйте готівку в шухляді на кінець дня. Скільки має бути — не показуємо,
                поки не введете.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Скільки в шухляді, ₴</span>
                <Input
                  value={evening}
                  onChange={(e) => {
                    setEvening(maskDecimalInput(e.target.value, 2))
                    setCloseRefused(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitClose()
                  }}
                  inputMode="decimal"
                  autoFocus
                  className="font-mono text-lg"
                />
              </label>
              {closeRefused ? (
                <p className="text-xs text-destructive">
                  Уведіть суму, яку порахували в шухляді, — числом більшим за нуль.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-baseline justify-between gap-4 py-1">
                <span className="text-muted-foreground">Пораховано</span>
                <span className="font-mono tabular-nums">
                  {uah(closed.countedCash ?? 0, { decimals: 2 })}
                </span>
              </div>
              <div className="my-1 border-t border-border" />
              <div
                className={cn(
                  'flex items-center justify-between gap-4 rounded-lg px-3 py-2.5',
                  matched(closed.discrepancy ?? 0)
                    ? 'bg-[var(--leaf)]/10 text-[var(--leaf)]'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {matched(closed.discrepancy ?? 0) ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                  Розбіжність
                </span>
                <span className="font-mono tabular-nums">
                  {uah(closed.discrepancy ?? 0, { decimals: 2 })}
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {matched(closed.discrepancy ?? 0)
                  ? 'Зміна закрита. День зійшовся.'
                  : 'Зміна НЕ закрита: вона пішла керівникові зі статусом «Очікує пояснення» — і саме в цьому стані вона тепер стоїть у панелі за цим вікном, разом із розбіжністю. Змінити цю цифру в програмі не можна — зателефонуйте на базу.'}
              </p>
            </div>
          )}

          <DialogFooter>
            {closed === null ? (
              <>
                <Button variant="ghost" onClick={() => setCloseOpen(false)}>
                  Скасувати
                </Button>
                <Button onClick={submitClose} disabled={evening.trim() === ''}>
                  Закрити зміну
                </Button>
              </>
            ) : (
              <Button
                onClick={() => {
                  setCloseOpen(false)
                  setClosed(null)
                  setEvening('')
                }}
              >
                Готово
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- вікно перерахунку: очікуване сховане до вводу ---------- */}
      <Dialog
        open={countOpen}
        onOpenChange={(v) => {
          if (!v) closeCount()
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Перерахунок каси</DialogTitle>
          </DialogHeader>

          {done === null ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                Порахуйте готівку в шухляді й уведіть суму. Скільки має бути — не
                показуємо, поки не введете: інакше це вже не перерахунок.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Скільки в шухляді, ₴</span>
                <Input
                  value={counted}
                  onChange={(e) => setCounted(maskDecimalInput(e.target.value, 2))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitCount()
                  }}
                  inputMode="decimal"
                  autoFocus
                  className="font-mono text-lg"
                />
              </label>
              {refused ? (
                <p className="text-xs text-destructive">
                  Уведіть суму числом більшим за нуль — і лише поки зміна відкрита: до
                  закритої перерахунок не чіпляється.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-baseline justify-between gap-4 py-1">
                <span className="text-muted-foreground">Очікувано</span>
                <span className="font-mono tabular-nums">
                  {uah(done.expectedAtCount, { decimals: 2 })}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-1">
                <span className="text-muted-foreground">Пораховано</span>
                <span className="font-mono tabular-nums">
                  {uah(done.countedCash, { decimals: 2 })}
                </span>
              </div>
              <div className="my-1 border-t border-border" />
              <div
                className={cn(
                  'flex items-center justify-between gap-4 rounded-lg px-3 py-2.5',
                  matched(done.discrepancy)
                    ? 'bg-[var(--leaf)]/10 text-[var(--leaf)]'
                    : 'bg-destructive/10 text-destructive',
                )}
              >
                <span className="flex items-center gap-2 font-medium">
                  {matched(done.discrepancy) ? (
                    <CheckCircle2 className="size-4" />
                  ) : (
                    <TriangleAlert className="size-4" />
                  )}
                  Розбіжність
                </span>
                <span className="font-mono font-semibold tabular-nums">
                  {uah(done.discrepancy, { decimals: 2 })}
                </span>
              </div>
              {matched(done.discrepancy) ? null : (
                <p className="mt-2 text-xs leading-relaxed text-destructive">
                  Змінити цю цифру в програмі не можна. Зателефонуйте на базу — керівник
                  знайде, де розійшлося.
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {done === null ? (
              <>
                <Button variant="ghost" onClick={closeCount}>
                  Скасувати
                </Button>
                <Button onClick={submitCount} disabled={!counted.trim()}>
                  Порахував
                </Button>
              </>
            ) : (
              <Button onClick={closeCount}>Готово</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- відкриття зміни: те саме правило, що й у перерахунку ---------- */}
      <Dialog
        open={shiftOpen}
        onOpenChange={(v) => {
          if (!v) {
            setShiftOpen(false)
            setShiftError('')
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Відкрити зміну</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Порахуйте готівку в шухляді на ранок. Це ваш перерахунок, а не «скільки має
              бути» — суму система не підказує.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">У шухляді на ранок, ₴</span>
              <Input
                value={morning}
                onChange={(e) => {
                  setMorning(maskDecimalInput(e.target.value, 2))
                  setShiftError('')
                }}
                inputMode="decimal"
                autoFocus
                className="font-mono text-lg"
              />
            </label>
            {shiftError ? <p className="text-xs text-destructive">{shiftError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShiftOpen(false)}>
              Скасувати
            </Button>
            <Button onClick={submitShift} disabled={!morning.trim()}>
              Відкрити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
