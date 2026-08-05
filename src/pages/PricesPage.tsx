import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Clock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { Sparkline } from '@/components/common/Sparkline'
import { useStore } from '@/lib/store'
import { addDays, longDate, num } from '@/lib/format'
import { TODAY } from '@/lib/seed'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Berry } from '@/lib/types'

export function PricesPage() {
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const role = useStore((s) => s.role)
  const priceFor = useStore((s) => s.priceFor)
  const priceHistory = useStore((s) => s.priceHistory)
  const prices = useStore((s) => s.prices)
  const setPrice = useStore((s) => s.setPrice)

  const [editing, setEditing] = React.useState<{ berry: Berry; pointId: string } | null>(null)
  const [value, setValue] = React.useState('')
  const [reason, setReason] = React.useState('')

  const activeBerries = berries.filter((b) => TODAY >= b.from && TODAY <= b.to)
  const visiblePoints = activePointId === 'all' ? points : points.filter((p) => p.id === activePointId)

  function openEdit(berry: Berry, pointId: string) {
    setEditing({ berry, pointId })
    setValue(String(priceFor(TODAY, pointId, berry.id) ?? berry.basePrice))
    setReason('')
  }

  function submit() {
    if (!editing) return
    const v = Number(value.replace(',', '.'))
    if (!v || v <= 0) {
      toast.error('Введіть ціну')
      return
    }
    setPrice({
      date: TODAY,
      pointId: editing.pointId,
      berryId: editing.berry.id,
      price: v,
      author: role === 'owner' ? 'Власник' : 'Приймальник',
      reason: reason.trim() || undefined,
    })
    toast.success(`${editing.berry.name} — ${num(v)} ₴/кг`, {
      description: 'Нова ціна діє з цієї хвилини. Попередні квитанції не змінюються.',
    })
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={longDate(TODAY)}
        title="Ціни дня"
        description="Ціну ставлять зранку і коригують протягом дня. Кожна зміна лишає слід — видно, хто, коли і чому підняв."
      />

      {activePointId === 'all' ? (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Сорт</TableHead>
                <TableHead className="w-[150px]">Ціна за 14 днів</TableHead>
                {points.map((p) => (
                  <TableHead key={p.id} className="text-right">
                    {p.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeBerries.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.name}</TableCell>
                  <TableCell>
                    <PriceTrend berryId={b.id} />
                  </TableCell>
                  {points.map((p) => {
                    const price = priceFor(TODAY, p.id, b.id)
                    const hist = priceHistory(TODAY, p.id, b.id)
                    const changed = hist.length > 1
                    return (
                      <TableCell key={p.id} className="text-right">
                        {price === undefined ? (
                          <button
                            onClick={() => openEdit(b, p.id)}
                            className="text-xs text-muted-foreground underline decoration-dotted"
                          >
                            встановити
                          </button>
                        ) : (
                          <button
                            onClick={() => openEdit(b, p.id)}
                            className="group inline-flex items-center gap-1.5"
                          >
                            <span className="font-mono font-medium">{num(price)} ₴</span>
                            {changed ? (
                              <PriceDelta from={hist[0].price} to={price} />
                            ) : null}
                            <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
                          </button>
                        )}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {activeBerries.map((b) => {
            const pointId = visiblePoints[0].id
            const price = priceFor(TODAY, pointId, b.id)
            const hist = priceHistory(TODAY, pointId, b.id)
            return (
              <div key={b.id} className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{b.name}</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-3xl font-semibold">
                        {price !== undefined ? num(price) : '—'}
                      </span>
                      <span className="text-sm text-muted-foreground">₴/кг</span>
                      {hist.length > 1 ? <PriceDelta from={hist[0].price} to={price!} /> : null}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => openEdit(b, pointId)}>
                    <Pencil className="size-3.5" />
                    Змінити
                  </Button>
                </div>

                {hist.length ? (
                  <div className="mt-4 border-t border-border/70 pt-3">
                    <Eyebrow className="mb-2">Історія за сьогодні</Eyebrow>
                    <ul className="flex flex-col gap-1.5">
                      {hist.map((h) => (
                        <li key={h.id} className="flex items-start gap-2 text-xs">
                          <Clock className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                          <span className="font-mono text-muted-foreground">{h.time}</span>
                          <span className="font-mono font-medium">{num(h.price)} ₴</span>
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {h.reason ? `— ${h.reason}` : ''}
                          </span>
                          <span className="shrink-0 text-muted-foreground">{h.author}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {activePointId === 'all' ? <IntradayChanges /> : null}

      <div className="mt-5 rounded-xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">Надбавки оптовикам</Badge>
          <span className="text-muted-foreground">
            Оптовик має свою надбавку в картці — вона додається до ціни дня автоматично, окремо
            перераховувати нічого не треба.
          </span>
        </div>
      </div>

      <div className="mt-2 text-xs text-muted-foreground">
        Записів про ціни в базі: <span className="font-mono">{prices.length}</span>
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>{editing?.berry.name}</DialogTitle>
            <DialogDescription>
              {points.find((p) => p.id === editing?.pointId)?.name} · нова ціна діятиме для
              наступних квитанцій.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="price">Ціна, ₴/кг</Label>
              <Input
                id="price"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                className="h-12 font-mono text-xl font-semibold"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Причина (необовʼязково)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Підняли — конкуренти в Гончарівці"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Скасувати
            </Button>
            <Button onClick={submit}>Зберегти ціну</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Price of the main point over the last two weeks — context for today's number. */
function PriceTrend({ berryId }: { berryId: string }) {
  const prices = useStore((s) => s.prices)
  const values = React.useMemo(() => {
    const out: number[] = []
    for (let i = 13; i >= 0; i--) {
      const d = addDays(TODAY, -i)
      const list = prices
        .filter((p) => p.date === d && p.pointId === 'p1' && p.berryId === berryId)
        .sort((a, b) => a.time.localeCompare(b.time))
      if (list.length) out.push(list[list.length - 1].price)
    }
    return out
  }, [prices, berryId])

  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">новий сорт</span>
  }
  const diff = values[values.length - 1] - values[0]
  return (
    <div className="flex items-center gap-2">
      <div className="w-[76px]">
        <Sparkline values={values} height={26} zeroBased={false} />
      </div>
      <span
        className={cn(
          'font-mono text-[11px]',
          diff > 0 ? 'text-[var(--leaf)]' : diff < 0 ? 'text-[var(--amber)]' : 'text-muted-foreground',
        )}
      >
        {diff > 0 ? '+' : diff < 0 ? '−' : ''}
        {num(Math.abs(diff))} ₴
      </span>
    </div>
  )
}

/** Everything that moved after the morning price was set. */
function IntradayChanges() {
  const prices = useStore((s) => s.prices)
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)

  const changes = prices
    .filter((p) => p.date === TODAY && p.time !== '07:30')
    .sort((a, b) => b.time.localeCompare(a.time))

  return (
    <div className="mt-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <Eyebrow className="mb-3">Зміни протягом дня</Eyebrow>
      {changes.length ? (
        <ul className="flex flex-col gap-1.5">
          {changes.map((c) => {
            const morning = prices.find(
              (p) => p.date === c.date && p.pointId === c.pointId && p.berryId === c.berryId,
            )
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2.5 text-sm">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{c.time}</span>
                <span className="font-medium">{points.find((p) => p.id === c.pointId)?.name}</span>
                <span className="text-muted-foreground">
                  {berries.find((b) => b.id === c.berryId)?.name}
                </span>
                <span className="font-mono text-xs">
                  {morning ? `${num(morning.price)} → ` : ''}
                  <b>{num(c.price)} ₴</b>
                </span>
                {c.reason ? (
                  <span className="truncate text-xs text-muted-foreground italic">
                    «{c.reason}»
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">{c.author}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Сьогодні ціну ще не міняли — діють ранкові значення.
        </p>
      )}
    </div>
  )
}

function PriceDelta({ from, to }: { from: number; to: number }) {
  const diff = to - from
  if (!diff) return null
  const up = diff > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[11px] font-medium',
        up ? 'bg-[var(--leaf)]/12 text-[var(--leaf)]' : 'bg-[var(--amber)]/12 text-[var(--amber)]',
      )}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : '−'}
      {num(Math.abs(diff))}
    </span>
  )
}
