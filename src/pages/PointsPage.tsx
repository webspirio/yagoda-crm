import * as React from 'react'
import { ArrowRight, MapPin, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { reconcileDay, supplierBalance, sum } from '@/lib/calc'
import { addDays, kg, num, shortDate, tonnage, uah } from '@/lib/format'
import { OPERATORS, TODAY } from '@/lib/seed'

export function PointsPage() {
  const points = useStore((s) => s.points)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const suppliers = useStore((s) => s.suppliers)
  const setActivePoint = useStore((s) => s.setActivePoint)
  const go = useStore((s) => s.go)

  const days = React.useMemo(() => {
    const list: string[] = []
    for (let d = addDays(TODAY, -13); d <= TODAY; d = addDays(d, 1)) list.push(d)
    return list
  }, [])

  const rows = points.map((p) => {
    const items = receptions.filter((r) => r.pointId === p.id)
    const recent = items.filter((r) => r.date >= days[0])
    const today = reconcileDay(
      TODAY,
      items,
      payouts.filter((x) => x.pointId === p.id),
    )
    const pointSuppliers = suppliers.filter((s) => s.homePointId === p.id)
    return {
      point: p,
      operator: OPERATORS[p.id],
      suppliers: pointSuppliers.length,
      net: sum(items, (r) => r.net),
      amount: sum(items, (r) => r.amount),
      outstanding: sum(
        pointSuppliers.map((s) => ({ v: supplierBalance(s.id, receptions, payouts) })),
        (x) => x.v,
      ),
      today,
      series: days.map((d) => sum(recent.filter((r) => r.date === d), (r) => r.net)),
      lastDate: items.length ? items[items.length - 1].date : undefined,
    }
  })

  const totalNet = sum(rows, (r) => r.net)

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        eyebrow="сезон 2026"
        title="Точки прийомки"
        description="Кожна точка веде свій день окремо, а зведена каса складається сама — без перенесення цифр між файлами."
      />

      <div className="grid gap-3 pb-5 md:grid-cols-2">
        {rows.map((r) => (
          <div key={r.point.id} className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-medium">{r.point.name}</span>
                  {r.point.isMain ? <Badge variant="secondary">основна</Badge> : null}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="size-3" />
                    {r.point.village}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3" />
                    {r.suppliers} постачальників
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActivePoint(r.point.id)
                  go({ name: 'day' })
                }}
              >
                Каса точки
                <ArrowRight className="size-3.5" />
              </Button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <Eyebrow>За сезон</Eyebrow>
                <div className="mt-1 font-mono text-lg font-semibold">{tonnage(r.net)}</div>
                <div className="text-[11px] text-muted-foreground">{uah(r.amount)}</div>
              </div>
              <div>
                <Eyebrow>Сьогодні</Eyebrow>
                <div className="mt-1 font-mono text-lg font-semibold">
                  {kg(r.today.netKg, 0)}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {r.today.receptionCount} квитанцій
                </div>
              </div>
              <div>
                <Eyebrow>Залишки</Eyebrow>
                <div className="mt-1 font-mono text-lg font-semibold text-[var(--amber)]">
                  {uah(r.outstanding)}
                </div>
                <div className="text-[11px] text-muted-foreground">за постачальниками</div>
              </div>
            </div>

            <Sparkline values={r.series} className="mt-3" height={38} />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>{shortDate(days[0])}</span>
              <span>останні 14 днів · приймає {r.operator}</span>
              <span>{shortDate(TODAY)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Точка</TableHead>
              <TableHead>Приймальник</TableHead>
              <TableHead className="text-right">Частка тонажу</TableHead>
              <TableHead className="text-right">Ягоди</TableHead>
              <TableHead className="text-right">Нараховано</TableHead>
              <TableHead className="text-right">Залишки</TableHead>
              <TableHead className="text-right">Остання здача</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.point.id}>
                <TableCell className="font-medium">{r.point.name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.operator}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-[var(--chart-1)]"
                        style={{ width: `${(r.net / (totalNet || 1)) * 100}%` }}
                      />
                    </div>
                    <span className="w-10 font-mono text-xs text-muted-foreground">
                      {num((r.net / (totalNet || 1)) * 100, 0)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{tonnage(r.net)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{uah(r.amount)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-[var(--amber)]">
                  {uah(r.outstanding)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {r.lastDate ? shortDate(r.lastDate) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
