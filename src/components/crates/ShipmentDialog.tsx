import * as React from 'react'
import { Truck } from 'lucide-react'
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
import { Eyebrow } from '@/components/common/bits'
import { crateShipmentDraft, maskDecimalInput, parseNumeric, shipmentTotal } from '@/lib/calc'
import { longDate, num } from '@/lib/format'
import { DEFAULT_TARE_ID } from '@/lib/seed'
import { useStore } from '@/lib/store'
import { crateWord, receiptWord } from './helpers'
import type { CrateStanding } from '@/lib/calc'
import type { ISODate } from '@/lib/types'

/**
 * Н16 · Вечірнє відправлення на базу (`21 §5`, `M43`).
 *
 * ПОЛЯ ВВОДУ ДЛЯ «З ЯГОДОЮ» ТУТ НЕМАЄ І НЕ БУДЕ (`I63`, §7: «немає поля в жодної ролі»).
 * «Не вони мають вносити, а тобто сама система, сама програма має вичитати… а от іменно
 * заламані ящики, то це, напевно, треба їм якось виділити строчку» (1115, 1117). Тому на
 * екрані рівно одне поле — бій, і нуль у ньому валідний: «ламані не кожен день можуть
 * бути» (993).
 *
 * Ящиком вважається РІВНО Чешка (рішення `Р-1`): лубʼянка, мішок і «Ящик» 2,0 кг із
 * довідника тари у відправлення не входять.
 */
export function ShipmentDialog({
  open,
  onOpenChange,
  pointId,
  date,
  standing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  date: ISODate
  standing: CrateStanding
}) {
  const receptions = useStore((s) => s.receptions)
  const shipments = useStore((s) => s.crateShipments)
  const postShipment = useStore((s) => s.postShipment)

  const [brokenRaw, setBrokenRaw] = React.useState('0')

  React.useEffect(() => {
    if (open) setBrokenRaw('0')
  }, [open])

  const draft = crateShipmentDraft({
    date,
    pointId,
    receptions,
    crateTareId: DEFAULT_TARE_ID,
  })
  const brokenUnits = Math.trunc(parseNumeric(brokenRaw))
  const total = shipmentTotal({ withBerryUnits: draft.withBerryUnits, brokenUnits })

  const posted = shipments.filter((s) => s.pointId === pointId && s.date === date && !s.voidedDate)
  // `I63` warn: квитанцію дописали ПІСЛЯ відправлення. Знімок не перераховується (`06 §3.3`),
  // тому єдиний чесний хід — показати обидва числа поруч, а не тихо підмінити одне одним.
  const stale = posted.filter(
    (s) => s.withBerryUnits !== draft.withBerryUnits || s.receptionCount !== draft.receptionCount,
  )

  const afterOnHand = standing.onHand === null ? null : standing.onHand - total
  const afterShortfall = standing.shortfall + total

  function submit() {
    const doc = postShipment({ pointId, date, brokenUnits })
    if (!doc) {
      toast.error('Відправлення не пройшло', { description: 'Перевірте кількість бою.' })
      return
    }
    onOpenChange(false)
    const shipped = shipmentTotal(doc)
    toast.success(`Відправили ${num(shipped)} ${crateWord(shipped)}`, {
      description: `З ягодою ${num(doc.withBerryUnits)}, бій ${num(doc.brokenUnits)}.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Відправлення на базу</DialogTitle>
          <DialogDescription>За {longDate(date)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="flex items-end justify-between gap-4 rounded-lg bg-muted/50 px-3 py-2.5">
            <div>
              <Eyebrow>З ягодою</Eyebrow>
              <div className="mt-1 font-mono text-2xl leading-none font-semibold">
                {num(draft.withBerryUnits)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">ящ.</span>
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              порахувала програма з {num(draft.receptionCount)}{' '}
              {receiptWord(draft.receptionCount)}
              <div>↑ поля вводу немає</div>
            </div>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="ship-broken">Бій (ламані)</Label>
              <Input
                id="ship-broken"
                value={brokenRaw}
                onChange={(e) => setBrokenRaw(maskDecimalInput(e.target.value, 0))}
                inputMode="numeric"
                className="h-11 w-32 font-mono text-lg"
              />
            </div>
            <span className="pb-3 text-xs text-muted-foreground">вписує приймальник</span>
          </div>

          <div className="flex items-baseline justify-between border-t border-border pt-3">
            <span className="text-sm font-medium">Разом відправлено</span>
            <span className="font-mono text-xl font-semibold">
              {num(total)}
              <span className="ml-1.5 text-sm font-normal text-muted-foreground">ящ.</span>
            </span>
          </div>

          <p className="text-sm text-muted-foreground">
            Після відправлення: пустих на точці{' '}
            <span className="font-mono text-foreground">
              {afterOnHand === null ? '—' : num(afterOnHand)}
            </span>{' '}
            · не хватає до наділу{' '}
            <span className="font-mono text-foreground">
              {standing.allotment === null ? '—' : num(afterShortfall)}
            </span>
          </p>

          {afterOnHand !== null && afterOnHand < 0 ? (
            <p className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]">
              Після цього відправлення пустих на точці буде менше нуля — наділ замалий на
              цей день. Ягоду вже прийняли й машина вже їде, тому це попередження, а не
              заборона.
            </p>
          ) : null}

          {posted.length ? (
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                Уже відправлено цього дня
              </div>
              <div className="flex flex-col gap-1.5">
                {posted.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{s.postedTime}</span>
                    <span className="h-px flex-1 bg-border" />
                    <span className="font-mono text-xs text-muted-foreground">
                      з ягодою {num(s.withBerryUnits)} · бій {num(s.brokenUnits)}
                    </span>
                    <span className="w-16 text-right font-mono font-medium">
                      {num(shipmentTotal(s))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {stale.map((s) => (
            <p
              key={s.id}
              className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]"
            >
              День змінився після відправлення: було {num(s.withBerryUnits)} ящ. із{' '}
              {num(s.receptionCount)} {receiptWord(s.receptionCount)}, стало{' '}
              {num(draft.withBerryUnits)} із {num(draft.receptionCount)}{' '}
              {receiptWord(draft.receptionCount)}. Знімок не перераховується — його
              виправляє керівник новим документом.
            </p>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          {/* День, за який уже відправляли, лишається відкритим (`UC-21` A4: обидва
              документи існують, `atBase` — сума проведених). Але кнопка це КАЖЕ, а не
              мовчить: подвійне відправлення має бути рішенням, а не проміжком уваги. */}
          <Button onClick={submit} disabled={total <= 0}>
            <Truck className="size-4" />
            {posted.length ? 'Відправити ще раз' : 'Відправити'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
