import * as React from 'react'
import { Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { maskDecimalInput, parseNumeric, round2 } from '@/lib/calc'
import { longDate, uah, uahAuto } from '@/lib/format'
import { SEASON_START, TODAY } from '@/lib/seed'
import { useStore } from '@/lib/store'
import type { CashStanding } from '@/lib/calc'
import type { CashFloat, ISODate } from '@/lib/types'

/**
 * Наділ каси точки (`21 §2.2`, `§7`: «Змінити наділ каси — ні / так, із причиною», 1164).
 *
 * ЦЬОГО ЕКРАНА НЕ ІСНУВАЛО ВЗАГАЛІ, І САМЕ ЦЕ ЧИСЛО — ГОЛОВНЕ ПИТАННЯ ФАЗИ. `Q-21`:
 * справжній наділ Шипинок (145 453 ₴) не покривав **13 днів із 39**, максимум видачі —
 * 493 735 ₴. Демо ставить 500 000 з 10.07, але «справжнє число має назвати клієнт», і
 * від нього залежить, чи буде каса інструментом («не вистачає готівки — дзвони на базу»),
 * чи щоденною перешкодою. Число, яке не можна змінити на екрані, не можна й обговорити з
 * клієнткою за цим екраном — тому воно тут.
 *
 * ТЕХНОЛОГІЯ ТА САМА, ЩО З ЯЩИКАМИ (1144), і файл навмисно дзеркалить `AllotmentDialog`:
 *
 * 1. **Наділ — ІСТОРІЯ, а не поле на точці.** Старий запис лишається, каса НЕ
 *    перераховується заднім числом, а діючий на дату обирає `effectiveAt()`. Учорашній
 *    екран показує вчорашній наділ.
 * 2. **Причина обовʼязкова рівно тоді, коли є що змінювати.** Перший наділ точки
 *    пояснювати нічому — попереднього рівня не було. Те саме правило стоїть у сторі
 *    (`setCashFloat`), і форма його повторює, а не вигадує.
 * 3. **Відмова стора видима.** `setCashFloat` віддає `undefined` на чужій ролі, на порожній
 *    причині й на не-числі — і на порожньому полі це не косметика: `round2(NaN)` дало б
 *    0,00 ₴, тобто наділ, якого ніхто не ставив, і «не хватає до наділу», яке сказало б, що
 *    база точці не винна нічого.
 */
export function CashFloatDialog({
  open,
  onOpenChange,
  pointId,
  pointName,
  standing,
  record,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  pointName: string
  standing: CashStanding
  record: CashFloat | null
}) {
  const cashFloats = useStore((s) => s.cashFloats)
  const setCashFloat = useStore((s) => s.setCashFloat)

  const [amountRaw, setAmountRaw] = React.useState('')
  const [from, setFrom] = React.useState<ISODate>(TODAY)
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setAmountRaw(standing.float === null ? '' : String(standing.float))
      setFrom(TODAY)
      setReason('')
    }
  }, [open, standing.float])

  const amount = parseNumeric(amountRaw)
  const hasAny = cashFloats.some((f) => f.pointId === pointId)
  const needReason = hasAny && !reason.trim()
  const valid = amountRaw.trim() !== '' && Number.isFinite(amount) && amount >= 0
  const canSubmit = valid && !needReason
  // Рахуємо ТУТ, у змінній, і через `round2` — у дужках форматера арифметики не буває.
  const owedAfter = round2(amount - standing.berryCash)
  const alreadyOver = valid && owedAfter < -0.009

  function submit() {
    const doc = setCashFloat({ pointId, amount, effectiveFrom: from, reason: reason.trim() })
    if (!doc) {
      toast.error('Наділ каси не змінено', {
        description: 'Наділ каси ставить лише керівник, сумою від нуля, і зміна наявного потребує причини.',
      })
      return
    }
    onOpenChange(false)
    toast.success(`Наділ каси — ${uahAuto(doc.amount)}`, {
      description: `${pointName}, діє з ${longDate(doc.effectiveFrom)}. Старий запис лишився в історії.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Наділ каси — {pointName}</DialogTitle>
          <DialogDescription>
            {record
              ? `Діючий: ${uahAuto(record.amount)} з ${longDate(record.effectiveFrom)} · ${record.setBy}`
              : 'Цій точці наділу каси ще не призначали.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="float-amount">Скільки грошей, ₴</Label>
              <Input
                id="float-amount"
                value={amountRaw}
                onChange={(e) => setAmountRaw(maskDecimalInput(e.target.value, 2))}
                inputMode="decimal"
                className="h-11 w-40 font-mono text-lg"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="float-from">Діє з</Label>
              <Input
                id="float-from"
                type="date"
                value={from}
                min={SEASON_START}
                onChange={(e) => {
                  const d = e.target.value
                  if (d) setFrom(d)
                }}
                className="h-11 w-[150px] font-mono"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="float-reason">Причина</Label>
            <Input
              id="float-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="наділу не хватало на 13 днів із 39"
              className="h-11"
            />
            {needReason ? (
              <p className="text-xs text-destructive">
                Зміна наявного наділу без причини не зберігається — саме вона й лишається в
                історії замість переписаного числа.
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">У касі за ягоду зараз</span>
              <span className="shrink-0 font-mono tabular-nums">
                {uah(standing.berryCash, { decimals: 2 })}
              </span>
            </div>
            <div className="mt-1 flex items-baseline justify-between gap-4">
              <span className="text-muted-foreground">Не хвататиме до наділу</span>
              <span className="shrink-0 font-mono font-semibold tabular-nums">
                {valid ? uah(owedAfter, { decimals: 2 }) : '—'}
              </span>
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Каса не перераховується: змінюється лише сума, від якої рахують, «не хватає до
            наділу». Старий наділ лишається в історії, і вчорашній екран покаже вчорашній.
          </p>

          {alreadyOver ? (
            <p className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]">
              У касі вже більше, ніж цей наділ. Заборгованості перед точкою не буде взагалі —
              заборонити цього не можна: наділ управлінське рішення.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <Wallet className="size-4" />
            Зберегти наділ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
