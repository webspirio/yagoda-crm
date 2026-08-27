import * as React from 'react'
import { Boxes } from 'lucide-react'
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
import { maskDecimalInput, parseNumeric } from '@/lib/calc'
import { longDate, num } from '@/lib/format'
import { useStore } from '@/lib/store'
import { crateWord } from './helpers'
import type { CrateStanding } from '@/lib/calc'
import type { CrateAllotment, ISODate } from '@/lib/types'

/**
 * `UC-35` · Керівник змінює наділ 600 → 800. Дія КЕРІВНИЦЬКА (`21 §7`): приймальникові
 * кнопки, що її відкриває, не існує взагалі — не «є, але заблокована». Роль перевіряє ще
 * й сам стор, тому натиснути її в обхід екрана теж не вийде.
 *
 * Наділ — ІСТОРІЯ, а не поле на точці: старий запис лишається, баланс НЕ перераховується,
 * а діючий на дату обирає `effectiveAt()`. Це відповідь самої клієнтки на питання «а
 * може, просто відправимо ще 200 зверху?»: «я за те, щоб поняття фіксованої суми… їм
 * потрібно бачити очима візуально, від якої суми їм потрібно відштовхуватись. Плюс чи
 * мінус вони не розберуться» (1067–1070).
 *
 * Зменшити наділ нижче за те, що вже в людей і в дорозі, МОЖНА — це `warn`, не `block`:
 * наділ управлінське рішення, і заборонити керівникові його ухвалити система не має права.
 */
export function AllotmentDialog({
  open,
  onOpenChange,
  pointId,
  standing,
  record,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  standing: CrateStanding
  record: CrateAllotment | null
}) {
  const allotments = useStore((s) => s.crateAllotments)
  const setCrateAllotment = useStore((s) => s.setCrateAllotment)
  const config = useStore((s) => s.config)

  const [unitsRaw, setUnitsRaw] = React.useState('')
  const [from, setFrom] = React.useState<ISODate>(config.businessToday)
  const [reason, setReason] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setUnitsRaw(standing.allotment === null ? '' : String(standing.allotment))
      setFrom(config.businessToday)
      setReason('')
    }
  }, [open, standing.allotment, config.businessToday])

  const units = Math.trunc(parseNumeric(unitsRaw))
  // Причина обовʼязкова рівно тоді, коли є що змінювати: перший наділ точки пояснювати
  // нічому — попереднього рівня не було. Те саме правило стоїть у сторі.
  const hasAny = allotments.some((a) => a.pointId === pointId)
  const needReason = hasAny && !reason.trim()
  const goesNegative = units < standing.shortfall
  const canSubmit = unitsRaw.trim() !== '' && units >= 0 && !needReason

  function submit() {
    const doc = setCrateAllotment({ pointId, units, effectiveFrom: from, reason: reason.trim() })
    if (!doc) {
      toast.error('Наділ не змінено', {
        description: 'Наділ змінює лише керівник, і зміна наявного потребує причини.',
      })
      return
    }
    onOpenChange(false)
    toast.success(`Наділ — ${num(doc.units)} ${crateWord(doc.units)}`, {
      description: `Діє з ${longDate(doc.effectiveFrom)}. Старий запис лишився в історії.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Наділ ящиків</DialogTitle>
          <DialogDescription>
            {record
              ? `Діючий: ${num(record.units)} з ${longDate(record.effectiveFrom)} · ${record.setBy}`
              : 'Цій точці наділу ще не призначали.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="allot-units">Скільки ящиків</Label>
              <Input
                id="allot-units"
                value={unitsRaw}
                onChange={(e) => setUnitsRaw(maskDecimalInput(e.target.value, 0))}
                inputMode="numeric"
                className="h-11 w-32 font-mono text-lg"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="allot-from">Діє з</Label>
              <Input
                id="allot-from"
                type="date"
                value={from}
                min={config.seasonStart}
                onChange={(e) => {
                  const d = e.target.value
                  if (d) setFrom(d)
                }}
                className="h-11 w-[150px] font-mono"
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="allot-reason">Причина</Label>
            <Input
              id="allot-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="далі більший сезон, більше ягоди"
              className="h-11"
            />
            {needReason ? (
              <p className="text-xs text-destructive">
                Зміна наявного наділу без причини не зберігається — саме вона й лишається в
                історії замість переписаного числа.
              </p>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground">
            Баланс не перераховується: змінюється лише число, від якого рахують. Старий
            наділ лишається в історії, і вчорашній екран покаже вчорашній наділ.
          </p>

          {goesNegative ? (
            <p className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]">
              У людей {num(standing.inField)} і в нас {num(standing.atBase)} — при наділі{' '}
              {num(units)} точка одразу в мінусі. Заборонити цього не можна: наділ —
              управлінське рішення.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <Boxes className="size-4" />
            Зберегти наділ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
