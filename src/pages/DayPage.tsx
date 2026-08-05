import * as React from 'react'
import { ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Eyebrow, PageHeader, StatTile } from '@/components/common/bits'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { useStore, scopedPayouts, scopedReceptions } from '@/lib/store'
import { originDates, reconcileDay, sum } from '@/lib/calc'
import { kg, longDate, shortDate, tonnage, uah, weekday } from '@/lib/format'
import { addDays } from '@/lib/format'
import { SEASON_START, TODAY } from '@/lib/seed'
import { cn } from '@/lib/utils'
import type { Reception } from '@/lib/types'

export function DayPage() {
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const suppliers = useStore((s) => s.suppliers)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const workDate = useStore((s) => s.workDate)
  const setWorkDate = useStore((s) => s.setWorkDate)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)

  const scopedR = scopedReceptions(receptions, activePointId)
  const scopedP = scopedPayouts(payouts, activePointId)
  const day = reconcileDay(workDate, scopedR, scopedP)

  const dayReceptions = scopedR
    .filter((r) => r.date === workDate)
    .sort((a, b) => a.time.localeCompare(b.time))
  const dayPayouts = scopedP.filter((p) => p.date === workDate)

  const byBerry = berries
    .map((b) => {
      const items = dayReceptions.filter((r) => r.berryId === b.id)
      return {
        berry: b,
        net: sum(items, (r) => r.net),
        amount: sum(items, (r) => r.amount),
        count: items.length,
      }
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.net - a.net)

  const maxNet = Math.max(...byBerry.map((x) => x.net), 1)
  const scopeName =
    activePointId === 'all'
      ? 'усі точки'
      : (points.find((p) => p.id === activePointId)?.name ?? '')

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        eyebrow={`${scopeName} · ${weekday(workDate)}`}
        title={`Каса за ${longDate(workDate)}`}
        description="Скільки ягоди зайшло, скільки грошей вийшло і чому ці дві цифри не збігаються — з розкладкою по датах."
        actions={
          <>
            <div className="flex items-center rounded-lg border border-border bg-card">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-r-none"
                disabled={workDate <= SEASON_START}
                onClick={() => setWorkDate(addDays(workDate, -1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2.5 font-mono text-xs">{shortDate(workDate)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-l-none"
                disabled={workDate >= TODAY}
                onClick={() => setWorkDate(addDays(workDate, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {workDate !== TODAY ? (
              <Button variant="outline" size="sm" onClick={() => setWorkDate(TODAY)}>
                Сьогодні
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              Звіт
            </Button>
          </>
        }
      />

      <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Прийнято ягоди" value={tonnage(day.netKg)} hint={`${day.receptionCount} квитанцій`} />
        <StatTile label="Нараховано" value={uah(day.accrued)} hint="вартість прийнятої ягоди" />
        <StatTile
          label="Вийшло з каси"
          value={uah(day.cashOut)}
          hint="готівка за день, разом з боргами"
          tone="berry"
        />
        <StatTile
          label="Залишків створено"
          value={uah(day.newDebt)}
          hint="перейде на баланс постачальників"
          tone={day.newDebt > 0 ? 'amber' : 'default'}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
        {/* ---------- the reconciliation ---------- */}
        <div className="printable rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="print-only mb-4">
            <div className="font-display text-lg font-semibold">
              Звіт за {longDate(workDate)}
            </div>
            <div className="text-sm text-muted-foreground">
              {scopeName} · прийнято {tonnage(day.netKg)} у {day.receptionCount} квитанціях
            </div>
          </div>
          <Eyebrow className="mb-4">Звірка каси</Eyebrow>

          <div className="flex flex-col gap-0">
            <LedgerRow label="Нараховано за ягоду цього дня" value={day.accrued} strong />
            <LedgerRow
              label="Видано готівкою одразу"
              value={-day.paidToday}
              indent
            />
            <LedgerRow label="Пішло в залишок за нами" value={-day.newDebt} indent tone="amber" />
            <div className="my-2 border-t border-border" />
            <div
              className={cn(
                'flex items-center justify-between rounded-lg px-3 py-2.5',
                Math.abs(day.drift) < 0.01
                  ? 'bg-[var(--leaf)]/10 text-[var(--leaf)]'
                  : 'bg-destructive/10 text-destructive',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4" />
                {Math.abs(day.drift) < 0.01 ? 'Розбіжність нульова' : 'Є розбіжність'}
              </span>
              <span className="font-mono text-sm font-semibold">{uah(day.drift, { decimals: 2 })}</span>
            </div>
          </div>

          <div className="mt-6">
            <Eyebrow className="mb-3">Окремо: видано за ягоду попередніх днів</Eyebrow>
            {day.pastByOriginDate.length ? (
              <div className="flex flex-col gap-1.5">
                {day.pastByOriginDate.map((x) => (
                  <div
                    key={x.date}
                    className="flex items-center gap-2.5 rounded-lg bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      ягода {shortDate(x.date)}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">
                      гроші {shortDate(workDate)}
                    </span>
                    <span className="ml-auto font-mono font-medium">{uah(x.amount)}</span>
                  </div>
                ))}
                <div className="mt-1 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm text-muted-foreground">Разом боргів погашено</span>
                  <span className="font-mono font-semibold">{uah(day.paidForPastDays)}</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Цього дня старі залишки не видавали.
              </p>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between rounded-lg bg-foreground px-4 py-3 text-background">
            <span className="text-sm font-medium">Всього вийшло з каси</span>
            <span className="font-mono text-xl font-semibold">{uah(day.cashOut)}</span>
          </div>

          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            В Excel ці дві дати живуть в одній колонці, тому за фільтром «сьогодні» видача завжди
            більша за ягоду. Тут кожна виплата памʼятає, за який день вона видана — і денний звіт
            сходиться сам.
          </p>
        </div>

        {/* ---------- by berry ---------- */}
        <div className="flex flex-col gap-5">
          <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <Eyebrow className="mb-3">Що приймали</Eyebrow>
            {byBerry.length ? (
              <div className="flex flex-col gap-3">
                {byBerry.map((x) => (
                  <div key={x.berry.id}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium">{x.berry.name}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {kg(x.net, 1)} · {uah(x.amount)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${(x.net / maxNet) * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Цього дня прийомки не було.</p>
            )}
          </div>

          <div className="flex min-h-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <Eyebrow>Стрічка дня</Eyebrow>
              <Badge variant="secondary" className="font-mono">
                {dayReceptions.length + dayPayouts.length}
              </Badge>
            </div>
            <div className="max-h-[520px] overflow-y-auto">
              <ul className="divide-y divide-border/60">
                {[
                  ...dayReceptions.map((r) => ({ kind: 'r' as const, time: r.time, r })),
                  ...dayPayouts.map((p) => ({ kind: 'p' as const, time: p.time, p })),
                ]
                  .sort((a, b) => a.time.localeCompare(b.time))
                  .map((row, i) => {
                    if (row.kind === 'r') {
                      const s = suppliers.find((x) => x.id === row.r.supplierId)
                      return (
                        <li key={`r${i}`}>
                          <button
                            onClick={() => setReceipt(row.r)}
                            className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-muted/60"
                          >
                            <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground">
                              {row.time}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{s?.name}</span>
                            <span className="shrink-0 font-mono text-xs text-muted-foreground">
                              {kg(row.r.net, 1)}
                            </span>
                            <span className="w-20 shrink-0 text-right font-mono text-sm">
                              {uah(row.r.amount)}
                            </span>
                          </button>
                        </li>
                      )
                    }
                    const s = suppliers.find((x) => x.id === row.p.supplierId)
                    return (
                      <li
                        key={`p${i}`}
                        className="flex items-center gap-3 bg-[var(--amber)]/6 px-4 py-2"
                      >
                        <span className="w-9 shrink-0 font-mono text-[11px] text-muted-foreground">
                          {row.time}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {s?.name}
                          <span className="ml-1.5 text-xs text-[var(--amber)]">
                            борг {originDates(row.p.allocations).map(shortDate).join(', ')}
                          </span>
                        </span>
                        <span className="w-20 shrink-0 text-right font-mono text-sm">
                          {uah(row.p.amount)}
                        </span>
                      </li>
                    )
                  })}
              </ul>
              {dayReceptions.length + dayPayouts.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Цього дня рухів не було.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <ReceiptDialog
        reception={receipt}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
    </div>
  )
}

function LedgerRow({
  label,
  value,
  strong,
  indent,
  tone,
}: {
  label: string
  value: number
  strong?: boolean
  indent?: boolean
  tone?: 'amber'
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-2',
        indent && 'pl-4',
      )}
    >
      <span
        className={cn(
          'text-sm',
          strong ? 'font-medium' : 'text-muted-foreground',
          indent && 'before:mr-2 before:text-muted-foreground/50 before:content-["└"]',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'font-mono tabular-nums',
          strong ? 'text-base font-semibold' : 'text-sm',
          tone === 'amber' && 'text-[var(--amber)]',
        )}
      >
        {uah(value)}
      </span>
    </div>
  )
}
