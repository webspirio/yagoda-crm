import * as React from 'react'
import { ArrowLeft, HandCoins, Phone, Receipt, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Eyebrow, StatTile } from '@/components/common/bits'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { SettleDialog } from '@/components/debts/SettleDialog'
import { useStore } from '@/lib/store'
import { openDebts, originDates, supplierBalance, sum } from '@/lib/calc'
import { daysBetween, daysWord, kg, longDate, num, shortDate, uah, uahAuto } from '@/lib/format'
import { TODAY } from '@/lib/seed'
import { cn } from '@/lib/utils'
import type { Reception } from '@/lib/types'

export function SupplierPage({ id }: { id: string }) {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const go = useStore((s) => s.go)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)
  const [settle, setSettle] = React.useState(false)

  const supplier = suppliers.find((s) => s.id === id)
  if (!supplier) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-muted-foreground">
        Картку не знайдено.
      </div>
    )
  }

  const items = receptions
    .filter((r) => r.supplierId === id)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  const pays = payouts
    .filter((p) => p.supplierId === id)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  const balance = supplierBalance(id, receptions, payouts)
  const open = openDebts(id, receptions, payouts)
  const oldest = open.length ? open[0].reception.date : undefined

  const timeline = [
    ...items.map((r) => ({ kind: 'r' as const, date: r.date, time: r.time, r })),
    ...pays.map((p) => ({ kind: 'p' as const, date: p.date, time: p.time, p })),
  ].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))

  return (
    <div className="mx-auto max-w-[1100px]">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-3 text-muted-foreground"
        onClick={() => go({ name: 'suppliers' })}
      >
        <ArrowLeft className="size-4" />
        Усі постачальники
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl leading-tight font-medium">{supplier.name}</h1>
            {supplier.wholesale ? (
              <Badge variant="secondary">опт · надбавка +{supplier.bonus} ₴/кг</Badge>
            ) : null}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5" />
              <span className="font-mono">{supplier.phone}</span>
            </span>
            <span>{supplier.village}</span>
            <span>·</span>
            <span>{points.find((p) => p.id === supplier.homePointId)?.name}</span>
          </div>
          {supplier.note ? (
            <p className="mt-2 text-sm text-muted-foreground italic">«{supplier.note}»</p>
          ) : null}
        </div>
        {balance > 0.009 ? (
          <Button onClick={() => setSettle(true)}>
            <HandCoins className="size-4" />
            Видати залишок {uahAuto(balance)}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Здач за сезон" value={String(items.length)} />
        <StatTile label="Ягоди здано" value={kg(sum(items, (r) => r.net), 1)} />
        <StatTile label="Нараховано" value={uah(sum(items, (r) => r.amount))} />
        <StatTile
          label="Залишок за нами"
          value={uahAuto(balance)}
          tone={balance > 0.009 ? 'amber' : 'leaf'}
          hint={
            oldest
              ? `найстаріший з ${shortDate(oldest)} — ${daysWord(daysBetween(oldest, TODAY))}`
              : 'усе розраховано'
          }
        />
      </div>

      {open.length ? (
        <div className="mb-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Eyebrow className="mb-3">Відкриті залишки — за що саме винні</Eyebrow>
          <div className="flex flex-col gap-1.5">
            {open.map((o) => (
              <div
                key={o.reception.id}
                className="flex items-center gap-3 rounded-lg bg-[var(--amber)]/8 px-3 py-2 text-sm"
              >
                <Wallet className="size-3.5 shrink-0 text-[var(--amber)]" />
                <span className="font-mono text-xs text-muted-foreground">
                  {o.reception.code}
                </span>
                <span>{longDate(o.reception.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {berries.find((b) => b.id === o.reception.berryId)?.name} · {kg(o.reception.net, 1)}
                </span>
                <span className="ml-auto font-mono font-semibold text-[var(--amber)]">
                  {uahAuto(o.open)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="border-b border-border/70 px-4 py-3">
          <Eyebrow>Історія — здачі та виплати</Eyebrow>
        </div>
        <ul className="divide-y divide-border/60">
          {timeline.map((row, i) => {
            if (row.kind === 'r') {
              const b = berries.find((x) => x.id === row.r.berryId)
              return (
                <li key={`r${i}`}>
                  <button
                    onClick={() => setReceipt(row.r)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60"
                  >
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                      {shortDate(row.date)}
                    </span>
                    <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {row.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        {b?.name} · {kg(row.r.net, 1)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {num(row.r.gross, 2)} брутто − {num(row.r.tareWeight, 2)} тара ·{' '}
                        {num(row.r.price + row.r.bonus)} ₴/кг
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-medium">
                        {uah(row.r.amount)}
                      </span>
                      {row.r.debt > 0 ? (
                        <span className="block font-mono text-[11px] text-[var(--amber)]">
                          у залишок {uahAuto(row.r.debt)}
                        </span>
                      ) : null}
                    </span>
                    <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            }
            return (
              <li key={`p${i}`} className="flex items-center gap-3 bg-[var(--leaf)]/6 px-4 py-2.5">
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {shortDate(row.date)}
                </span>
                <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {row.time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">Видано залишок</span>
                  <span className="block text-xs text-muted-foreground">
                    закрито ягоду за{' '}
                    {originDates(row.p.allocations).map(shortDate).join(', ')}
                  </span>
                </span>
                <span
                  className={cn('shrink-0 font-mono text-sm font-medium text-[var(--leaf)]')}
                >
                  {uah(row.p.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <ReceiptDialog
        reception={receipt}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
      <SettleDialog supplierId={id} open={settle} onOpenChange={setSettle} />
    </div>
  )
}
