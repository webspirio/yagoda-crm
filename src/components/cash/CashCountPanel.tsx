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
import { Eyebrow } from '@/components/common/bits'
import { maskDecimalInput, parseNumeric } from '@/lib/calc'
import { uah } from '@/lib/format'
import { OPERATORS, OWNER, TODAY } from '@/lib/seed'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { CashCount, ISODate, Shift } from '@/lib/types'

/** Копійка розбіжності — це вже розбіжність; нуль тут рівно один. */
const matched = (v: number) => Math.abs(v) < 0.005

/**
 * Перерахунок каси серед дня (`21 §Н17`, `§3.6`, `UC-22` кроки 4–5).
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
 */
export function CashCountPanel({
  pointId,
  date,
  isOperator,
}: {
  pointId: string
  date: ISODate
  /** керівницьких дій тут немає взагалі, але зміну відкриває саме той, хто рахує */
  isOperator: boolean
}) {
  const shifts = useStore((s) => s.shifts)
  const cashCounts = useStore((s) => s.cashCounts)
  const countCash = useStore((s) => s.countCash)
  const openShift = useStore((s) => s.openShift)
  const closeShift = useStore((s) => s.closeShift)

  const [countOpen, setCountOpen] = React.useState(false)
  const [counted, setCounted] = React.useState('')
  const [done, setDone] = React.useState<CashCount | null>(null)
  const [refused, setRefused] = React.useState(false)
  const [shiftOpen, setShiftOpen] = React.useState(false)
  const [morning, setMorning] = React.useState('')
  const [closeOpen, setCloseOpen] = React.useState(false)
  const [evening, setEvening] = React.useState('')
  const [closed, setClosed] = React.useState<Shift | null>(null)

  const shift = shifts.find((s) => s.pointId === pointId && s.date === date && s.status === 'open')
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
    if (!shift) return
    // Єдине число, яке вводить людина. Очікувану суму й розбіжність рахує стор рушієм —
    // тут їх ніхто не передає і передати не може.
    const doc = countCash({ shiftId: shift.id, countedCash: parseNumeric(counted) })
    // Стор відмовляє порожнім значенням, а не винятком (`ports.ts`). Мовчазна кнопка,
    // яка нічого не робить, — гірше за відмову, названу вголос.
    if (doc) setDone(doc)
    else setRefused(true)
  }

  const submitClose = () => {
    if (!shift) return
    // Те саме правило, що й у перерахунку: людина вводить ОДНЕ число, а очікуване й
    // розбіжність рахує стор. Порогів у v1 немає (`Q-23`), тому будь-яка розбіжність ≠ 0
    // лишає зміну в статусі «Очікує пояснення», і закриває її керівник (`06 §6` п. 5).
    const doc = closeShift({ shiftId: shift.id, countedCash: parseNumeric(evening) })
    if (doc) setClosed(doc)
  }

  const submitShift = () => {
    openShift({
      pointId,
      operatorId: OPERATORS[pointId] ?? OWNER,
      openingFloat: parseNumeric(morning),
    })
    setShiftOpen(false)
    setMorning('')
  }

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <Eyebrow className="mb-3">Перерахунок каси</Eyebrow>

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
        {shift ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setCountOpen(true)}>
              <Calculator className="size-4" />
              Перерахувати касу
            </Button>
            {isOperator && date === TODAY ? (
              <Button variant="outline" size="sm" onClick={() => setCloseOpen(true)}>
                Закрити зміну
              </Button>
            ) : null}
          </div>
        ) : isOperator && date === TODAY ? (
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
                  onChange={(e) => setEvening(maskDecimalInput(e.target.value, 2))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitClose()
                  }}
                  inputMode="decimal"
                  autoFocus
                  className="font-mono text-lg"
                />
              </label>
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
                  : 'Зміна НЕ закрита: вона пішла керівникові зі статусом «Очікує пояснення». Змінити цю цифру в програмі не можна — зателефонуйте на базу.'}
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
                  Зміну вже закрито — перерахунок нема до чого підчепити.
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
          if (!v) setShiftOpen(false)
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
                onChange={(e) => setMorning(maskDecimalInput(e.target.value, 2))}
                inputMode="decimal"
                autoFocus
                className="font-mono text-lg"
              />
            </label>
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
