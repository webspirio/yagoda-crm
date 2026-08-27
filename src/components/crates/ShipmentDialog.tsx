import * as React from 'react'
import { Ban, Truck } from 'lucide-react'
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
import { useScope, useStore } from '@/lib/store'
import { VoidCrateDialog } from './VoidCrateDialog'
import { crateWord, receiptWord } from './helpers'
import type { CrateStanding } from '@/lib/calc'
import type { CrateShipment, ISODate } from '@/lib/types'

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
 *
 * ДВА СТАНИ, А НЕ ОДИН, І ЦЕ ГОЛОВНА ПРАВКА ЦЬОГО ФАЙЛА. Раніше вікно завжди відкривалося
 * формою — навіть на дні, за який уже відправляли. Тоді воно БРЕХАЛО заголовком: «З ЯГОДОЮ
 * 173» і «після відправлення пустих 168» — це прогноз ДРУГОГО відправлення, тоді як стан
 * точки в ту саму секунду 341. Людина, яка відкрила вікно перевірити, що поїхало, читала
 * прогноз, якого ніхто не замовляв, і один зайвий клік по «Відправити» додавав базі ще 175
 * ящиків. Тому: уже відправляли — відкриваємо ПЕРЕГЛЯД (що поїхало і який стан точки
 * зараз), а форма другого відправлення живе за явною кнопкою «Відправити ще раз».
 * `UC-21 A4` цього не забороняє — обидва документи існують і `atBase` їх складає, — але
 * подвійне відправлення має бути рішенням, а не проміжком уваги.
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
  const voidCrateShipment = useStore((s) => s.voidCrateShipment)
  const config = useStore((s) => s.config)
  const { role } = useScope()

  const [brokenRaw, setBrokenRaw] = React.useState('0')
  /** явна дія «відправити ще раз»: без неї на вже відправленому дні форми не видно */
  const [wantsAnother, setWantsAnother] = React.useState(false)
  const [voiding, setVoiding] = React.useState<CrateShipment | null>(null)

  React.useEffect(() => {
    if (open) {
      setBrokenRaw('0')
      setWantsAnother(false)
      setVoiding(null)
    }
  }, [open])

  const draft = crateShipmentDraft({
    date,
    pointId,
    receptions,
    crateTareId: config.crateTareId,
  })
  const brokenUnits = Math.trunc(parseNumeric(brokenRaw))
  const total = shipmentTotal({ withBerryUnits: draft.withBerryUnits, brokenUnits })

  const posted = shipments.filter((s) => s.pointId === pointId && s.date === date && !s.voidedDate)
  const shippedTotal = posted.reduce((n, s) => n + shipmentTotal(s), 0)
  // `I63` warn: квитанцію дописали ПІСЛЯ відправлення. Знімок не перераховується (`06 §3.3`),
  // тому єдиний чесний хід — показати обидва числа поруч, а не тихо підмінити одне одним.
  const stale = posted.filter(
    (s) => s.withBerryUnits !== draft.withBerryUnits || s.receptionCount !== draft.receptionCount,
  )

  // Сторновано останнє відправлення — переглядати нема чого, і вікно саме повертається до
  // форми. Інакше воно показувало б порожній перегляд із кнопкою «відправити ще раз».
  const showForm = wantsAnother || posted.length === 0

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

  const alreadyShipped = posted.length ? (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <Eyebrow>Уже відправлено цього дня</Eyebrow>
        <span className="font-mono text-sm font-semibold">
          {num(shippedTotal)}
          <span className="ml-1 text-xs font-normal text-muted-foreground">ящ.</span>
        </span>
      </div>
      <div className="flex flex-col gap-1.5">
        {posted.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-xs text-muted-foreground">{s.postedTime}</span>
            <span className="h-px flex-1 bg-border" />
            <span className="font-mono text-xs text-muted-foreground">
              з ягодою {num(s.withBerryUnits)} · бій {num(s.brokenUnits)}
            </span>
            <span className="w-12 text-right font-mono font-medium">{num(shipmentTotal(s))}</span>
            {/* §7: сторнує КЕРІВНИК, із причиною. Приймальникові цієї кнопки не існує —
                не «є, але сіра»: заблокована кнопка вчить шукати обхід. */}
            {role === 'owner' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-destructive"
                onClick={() => setVoiding(s)}
              >
                <Ban className="size-3.5" />
                Сторнувати
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  ) : null

  const staleWarnings = stale.map((s) => (
    <p
      key={s.id}
      className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]"
    >
      День змінився після відправлення: було {num(s.withBerryUnits)} ящ. із{' '}
      {num(s.receptionCount)} {receiptWord(s.receptionCount)}, стало {num(draft.withBerryUnits)}{' '}
      із {num(draft.receptionCount)} {receiptWord(draft.receptionCount)}. Знімок не
      перераховується — його виправляє керівник новим документом.
    </p>
  ))

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{showForm ? 'Відправлення на базу' : 'Що поїхало на базу'}</DialogTitle>
            <DialogDescription>За {longDate(date)}</DialogDescription>
          </DialogHeader>

          {showForm ? (
            <div className="grid gap-4">
              {posted.length ? (
                <p className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]">
                  За цей день уже відправляли {num(shippedTotal)} {crateWord(shippedTotal)}. Усе,
                  що нижче, — прогноз ДРУГОГО відправлення, а не стан точки.
                </p>
              ) : null}

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

              {alreadyShipped}
              {staleWarnings}
            </div>
          ) : (
            <div className="grid gap-4">
              {alreadyShipped}

              {/* СТАН ТОЧКИ, а не прогноз: рівно ті самі числа, що на смужці наділу за
                  цим вікном. Саме їх людина шукає, коли відкриває «Відправлення за сьогодні»
                  на вже відправленому дні. */}
              <div className="rounded-lg border border-border p-3">
                <Eyebrow className="mb-2">Стан точки зараз</Eyebrow>
                <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-sm">
                  <span>
                    пустих{' '}
                    <span className="font-semibold">
                      {standing.onHand === null ? '—' : num(standing.onHand)}
                    </span>
                  </span>
                  <span>
                    у людей <span className="font-semibold">{num(standing.inField)}</span>
                  </span>
                  <span>
                    у нас з ягодою <span className="font-semibold">{num(standing.atBase)}</span>
                  </span>
                  <span>
                    не хватає{' '}
                    <span className="font-semibold">
                      {standing.allotment === null ? '—' : num(standing.shortfall)}
                    </span>
                  </span>
                </div>
              </div>

              {staleWarnings}

              <p className="text-xs leading-relaxed text-muted-foreground">
                Другий раз за цей самий день відправляють рідко, і це окрема дія: обидва
                документи лишаться в обліку, а «у нас з ягодою» складе їх обидва.
              </p>
            </div>
          )}

          <DialogFooter>
            {/* З форми ДРУГОГО відправлення «Скасувати» вертає в перегляд, а не закриває
                вікно: людина прийшла подивитися, що поїхало, і має куди повернутися. */}
            <Button
              variant="outline"
              onClick={() => {
                if (wantsAnother && posted.length) setWantsAnother(false)
                else onOpenChange(false)
              }}
            >
              {wantsAnother && posted.length ? 'Назад' : showForm ? 'Скасувати' : 'Закрити'}
            </Button>
            {showForm ? (
              <Button onClick={submit} disabled={total <= 0}>
                <Truck className="size-4" />
                {posted.length ? 'Відправити ще раз' : 'Відправити'}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => setWantsAnother(true)}>
                <Truck className="size-4" />
                Відправити ще раз
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Сусіднє вікно, а не вкладене: два модальні шари Radix складає стеком, і Escape
          закриває верхній — тобто сторно, а не список відправлень під ним. */}
      <VoidCrateDialog
        open={voiding !== null}
        onOpenChange={(v) => {
          if (!v) setVoiding(null)
        }}
        title="Сторнувати відправлення"
        what={
          voiding
            ? `${longDate(voiding.date)}, о ${voiding.postedTime} · з ягодою ${num(voiding.withBerryUnits)} · бій ${num(voiding.brokenUnits)} · разом ${num(shipmentTotal(voiding))} ящ.`
            : ''
        }
        placeholder="провели двічі одну машину"
        onConfirm={(reason) => {
          if (!voiding) return false
          const doc = voidCrateShipment(voiding.id, reason)
          if (!doc) return false
          setVoiding(null)
          toast.success('Відправлення сторновано', {
            description: `${num(shipmentTotal(doc))} ящ. повернулися в «пусті на точці». Документ лишився в історії з причиною.`,
          })
          return true
        }}
      />
    </>
  )
}
