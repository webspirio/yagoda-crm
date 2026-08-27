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
import { openDebts, reconcileDay, signerFor, sum } from '@/lib/calc'
import { addDays, kg, num, shortDate, tonnage, uah } from '@/lib/format'

export function PointsPage() {
  const points = useStore((s) => s.points)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const suppliers = useStore((s) => s.suppliers)
  const users = useStore((s) => s.users)
  const config = useStore((s) => s.config)
  const setActivePoint = useStore((s) => s.setActivePoint)
  const go = useStore((s) => s.go)

  const days = React.useMemo(() => {
    const list: string[] = []
    for (let d = addDays(config.businessToday, -13); d <= config.businessToday; d = addDays(d, 1))
      list.push(d)
    return list
  }, [config.businessToday])

  // Десять точок — із їхнього ж випадаючого списку `Data_Import!E` ✓ PART A.
  // Працюють п'ять; решта стоїть у реєстрі, бо план — «від 5 до 10» ✓ PART A.
  const trading = points.filter((p) => p.active)
  const registry = points.filter((p) => !p.active)

  const rows = trading.map((p) => {
    const items = receptions.filter((r) => r.pointId === p.id)
    const recent = items.filter((r) => r.date >= days[0])
    const today = reconcileDay(
      config.businessToday,
      items,
      payouts.filter((x) => x.pointId === p.id),
    )
    // «постачальників на точці» — це ті, хто реально сюди возив, а не приписані до неї
    const pointSuppliers = new Set(items.map((r) => r.supplierId))
    return {
      point: p,
      operator: signerFor(users, p.id),
      suppliers: pointSuppliers.size,
      net: sum(items, (r) => r.net),
      amount: sum(items, (r) => r.amount),
      // залишок пункту — це борг за ягоду, яку прийняв САМЕ він
      outstanding: sum(
        suppliers.map((s) => ({ v: sum(openDebts(s.id, items, payouts), (o) => o.open) })),
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
        eyebrow={`${trading.length} з ${points.length} працюють · сезон 2026`}
        title="Точки прийомки"
        description="Кожна точка веде свій день окремо, а зведена каса складається сама — без перенесення цифр між файлами. У довіднику стоять усі десять точок із вашого списку: пʼять приймають, пʼять чекають відкриття."
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
              <span>
                останні 14 днів ·{' '}
                {r.operator ? `приймає ${r.operator}` : 'приймальника не призначено'}
              </span>
              <span>{shortDate(config.businessToday)}</span>
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
                <TableCell className="text-sm text-muted-foreground">
                  {r.operator ?? 'не призначено'}
                </TableCell>
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

      {/* Реєстр — окремо від тих, що торгують: у них немає ні прийомок, ні каси,
          і показувати їх в одному списку означало б показувати нулі як дані */}
      {registry.length ? (
        <div className="mt-5 rounded-xl border border-dashed border-border p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <Eyebrow>У реєстрі — ще не відкриті</Eyebrow>
            <span className="text-xs text-muted-foreground">
              {registry.length} з {points.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {registry.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
              >
                <MapPin className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{p.village}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            Ці точки вже є у довіднику — усі десять із вашого списку. Щоб відкрити прийомку, точку
            не треба заводити заново: вона просто починає працювати, і зведення підхоплює її саме.
          </p>
        </div>
      ) : null}
    </div>
  )
}
