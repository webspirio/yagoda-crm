import * as React from 'react'
import { ArrowRight, HandCoins, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Eyebrow, PageHeader, StatTile } from '@/components/common/bits'
import { SettleDialog } from '@/components/debts/SettleDialog'
import { useStore } from '@/lib/store'
import { openDebts, supplierBalance, sum } from '@/lib/calc'
import { daysBetween, daysWord, shortDate, uah, uahAuto } from '@/lib/format'
import { TODAY } from '@/lib/seed'
import { cn } from '@/lib/utils'

export function DebtsPage() {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const go = useStore((s) => s.go)
  const [q, setQ] = React.useState('')
  const [settleFor, setSettleFor] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const rows = React.useMemo(
    () =>
      suppliers
        .filter((s) => activePointId === 'all' || s.homePointId === activePointId)
        .map((s) => ({
          supplier: s,
          balance: supplierBalance(s.id, receptions, payouts),
          open: openDebts(s.id, receptions, payouts),
        }))
        .filter((r) => r.balance > 0.009)
        .filter((r) => !q.trim() || r.supplier.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.balance - a.balance),
    [suppliers, receptions, payouts, q, activePointId],
  )

  const total = sum(rows, (r) => r.balance)
  const oldestAge = rows.reduce((max, r) => {
    const d = r.open.length ? daysBetween(r.open[0].reception.date, TODAY) : 0
    return Math.max(max, d)
  }, 0)
  const settledTotal = sum(
    payouts.filter((p) => activePointId === 'all' || p.pointId === activePointId),
    (p) => p.amount,
  )

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={`${rows.length} ${rows.length === 1 ? 'постачальник' : 'постачальників'}`}
        title="Залишки за нами"
        description="Кожен залишок памʼятає, за яку саме здачу він виник. Тому видача сьогодні ніколи не «зʼїдає» сьогоднішню ягоду в звіті."
      />

      <div className="grid gap-3 pb-5 sm:grid-cols-3">
        <StatTile
          label="Всього винні"
          value={uah(total)}
          tone={total > 0 ? 'amber' : 'leaf'}
          hint="сума відкритих залишків"
        />
        <StatTile
          label="Найстаріший залишок"
          value={oldestAge ? daysWord(oldestAge) : '—'}
          hint="від дати здачі ягоди"
        />
        <StatTile label="Погашено за сезон" value={uah(settledTotal)} hint="виплати старих боргів" />
      </div>

      <div className="mb-4 relative max-w-sm">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Знайти постачальника"
          className="h-9 pl-9"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <div className="font-medium">Відкритих залишків немає</div>
          <div className="mt-1 text-sm text-muted-foreground">
            Усі здачі розраховані повністю.
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const age = r.open.length ? daysBetween(r.open[0].reception.date, TODAY) : 0
            const isOpen = expanded === r.supplier.id
            return (
              <div key={r.supplier.id} className="rounded-xl bg-card ring-1 ring-foreground/10">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(isOpen ? null : r.supplier.id)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{r.supplier.name}</span>
                      {r.supplier.wholesale ? (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                          опт
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.supplier.village} ·{' '}
                      {points.find((p) => p.id === r.supplier.homePointId)?.name} ·{' '}
                      {r.open.length} {r.open.length === 1 ? 'здача' : 'здачі'}
                    </div>
                  </button>

                  <div
                    className={cn(
                      'shrink-0 rounded-md px-2 py-1 font-mono text-[11px]',
                      age > 7
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-muted text-muted-foreground',
                    )}
                  >
                    {daysWord(age)}
                  </div>

                  <div className="w-28 shrink-0 text-right font-mono text-lg font-semibold text-[var(--amber)]">
                    {uahAuto(r.balance)}
                  </div>

                  <Button size="sm" onClick={() => setSettleFor(r.supplier.id)}>
                    <HandCoins className="size-3.5" />
                    Видати
                  </Button>
                </div>

                {isOpen ? (
                  <div className="border-t border-border/70 px-4 py-3">
                    <Eyebrow className="mb-2">Звідки взявся залишок</Eyebrow>
                    <div className="flex flex-col gap-1.5">
                      {r.open.map((o) => (
                        <div
                          key={o.reception.id}
                          className="flex items-center gap-3 text-sm text-muted-foreground"
                        >
                          <span className="font-mono text-xs">{o.reception.code}</span>
                          <span>{shortDate(o.reception.date)}</span>
                          <ArrowRight className="size-3" />
                          <span>
                            нараховано {uahAuto(o.reception.amount)}, видано{' '}
                            {uahAuto(o.reception.paid)}
                          </span>
                          <span className="ml-auto font-mono font-medium text-[var(--amber)]">
                            {uahAuto(o.open)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="link"
                      size="sm"
                      className="mt-1 px-0"
                      onClick={() => go({ name: 'supplier', id: r.supplier.id })}
                    >
                      Відкрити картку постачальника
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <SettleDialog
        supplierId={settleFor}
        open={Boolean(settleFor)}
        onOpenChange={(v) => !v && setSettleFor(null)}
      />
    </div>
  )
}
