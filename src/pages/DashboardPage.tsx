import * as React from 'react'
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'
import { ArrowRight, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Eyebrow, PageHeader, StatTile } from '@/components/common/bits'
import { Sparkline } from '@/components/common/Sparkline'
import { scopedReceptions, useStore } from '@/lib/store'
import { openDebts, sum } from '@/lib/calc'
import { addDays, kg, num, shortDate, tonnage, uah } from '@/lib/format'
import { SEASON_START, TODAY } from '@/lib/seed'

const RANGES = [
  { id: '7', label: '7 днів', from: addDays(TODAY, -6) },
  { id: '14', label: '14 днів', from: addDays(TODAY, -13) },
  { id: '30', label: '30 днів', from: addDays(TODAY, -29) },
  { id: 'season', label: 'Весь сезон', from: SEASON_START },
]

const chartConfig = {
  net: { label: 'Ягода, кг', color: 'var(--chart-1)' },
  paidToday: { label: 'Видано за ягоду дня', color: 'var(--chart-1)' },
  settled: { label: 'Погашено старих залишків', color: 'var(--chart-3)' },
} satisfies ChartConfig

export function DashboardPage() {
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const suppliers = useStore((s) => s.suppliers)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const go = useStore((s) => s.go)
  const [rangeId, setRangeId] = React.useState('30')

  const from = RANGES.find((r) => r.id === rangeId)!.from

  const inScope = React.useCallback(
    (pointId: string) => activePointId === 'all' || pointId === activePointId,
    [activePointId],
  )

  const rangeReceptions = receptions.filter((r) => r.date >= from && inScope(r.pointId))
  const rangePayouts = payouts.filter((p) => p.date >= from && inScope(p.pointId))

  const days = React.useMemo(() => {
    const list: string[] = []
    for (let d = from; d <= TODAY; d = addDays(d, 1)) list.push(d)
    return list
  }, [from])

  const daily = React.useMemo(() => {
    const byDay = new Map<string, { net: number; amount: number; paidToday: number; settled: number }>()
    for (const d of days) byDay.set(d, { net: 0, amount: 0, paidToday: 0, settled: 0 })
    for (const r of rangeReceptions) {
      const row = byDay.get(r.date)
      if (!row) continue
      row.net += r.net
      row.amount += r.amount
      row.paidToday += r.paid
    }
    for (const p of rangePayouts) {
      const row = byDay.get(p.date)
      if (!row) continue
      row.settled += p.amount
    }
    return days.map((d) => ({ date: d, label: shortDate(d), ...byDay.get(d)! }))
  }, [days, rangeReceptions, rangePayouts])

  const totals = {
    net: sum(rangeReceptions, (r) => r.net),
    amount: sum(rangeReceptions, (r) => r.amount),
    paid: sum(rangeReceptions, (r) => r.paid),
    settled: sum(rangePayouts, (p) => p.amount),
    debt: sum(rangeReceptions, (r) => r.debt),
    count: rangeReceptions.length,
  }
  const avgPrice = totals.net ? totals.amount / totals.net : 0

  const outstanding = React.useMemo(
    () =>
      (() => {
        // один прохід замість 208 перефільтрувань усього журналу
        const byS = new Map<string, typeof receptions>()
        for (const r of scopedReceptions(receptions, activePointId)) {
          const list = byS.get(r.supplierId)
          if (list) list.push(r)
          else byS.set(r.supplierId, [r])
        }
        return sum(
          suppliers.map((s) => ({
            v: sum(openDebts(s.id, byS.get(s.id) ?? [], payouts), (o) => o.open),
          })),
          (x) => x.v,
        )
      })(),
    [suppliers, receptions, payouts, activePointId],
  )

  const byBerry = berries
    .map((b) => {
      const items = rangeReceptions.filter((r) => r.berryId === b.id)
      return { berry: b, net: sum(items, (r) => r.net), amount: sum(items, (r) => r.amount) }
    })
    .filter((x) => x.net > 0)
    .sort((a, b) => b.net - a.net)
  const maxBerry = Math.max(...byBerry.map((b) => b.net), 1)

  // point comparison always spans every point — that is the whole reason it exists.
  // Only the five that trade: the other five sit in the registry with no receptions at all,
  // and a card of zeros next to a real one reads as broken, not as «ready to open» ✓ PART A
  const allInRange = receptions.filter((r) => r.date >= from)
  const tradingPoints = points.filter((p) => p.active)
  const registryCount = points.length - tradingPoints.length
  const byPoint = tradingPoints.map((p) => {
    const items = allInRange.filter((r) => r.pointId === p.id)
    const series = days.map((d) =>
      sum(items.filter((r) => r.date === d), (r) => r.net),
    )
    return {
      point: p,
      net: sum(items, (r) => r.net),
      amount: sum(items, (r) => r.amount),
      count: items.length,
      series,
    }
  })

  const topSuppliers = suppliers
    .map((s) => {
      const items = rangeReceptions.filter((r) => r.supplierId === s.id)
      return {
        supplier: s,
        net: sum(items, (r) => r.net),
        amount: sum(items, (r) => r.amount),
        count: items.length,
      }
    })
    .filter((x) => x.count > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  const busiestDay = daily.reduce((m, d) => (d.net > m.net ? d : m), daily[0])
  const maxDailyNet = Math.max(...daily.map((d) => d.net), 0)

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        eyebrow={
          activePointId === 'all'
            ? 'усі точки'
            : (points.find((p) => p.id === activePointId)?.name ?? '')
        }
        title="Зведення по сезону"
        description="Тонаж, гроші й залишки за будь-який період — рахується з тих самих квитанцій, що їх пробивають на точках."
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
            {RANGES.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={rangeId === r.id ? 'secondary' : 'ghost'}
                onClick={() => setRangeId(r.id)}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-5">
        <StatTile
          label="Прийнято ягоди"
          value={tonnage(totals.net)}
          hint={`${num(totals.count)} квитанцій`}
        />
        <StatTile label="Нараховано" value={uah(totals.amount)} hint="вартість прийнятої ягоди" />
        <StatTile
          label="Видано з каси"
          value={uah(totals.paid + totals.settled)}
          hint={`у т.ч. ${uah(totals.settled)} старих залишків`}
          tone="berry"
        />
        <StatTile
          label="Залишок за нами"
          value={uah(outstanding)}
          hint="відкрито на сьогодні"
          tone={outstanding > 0 ? 'amber' : 'leaf'}
        />
        <StatTile
          label="Середня ціна"
          value={`${num(avgPrice, 1)} ₴/кг`}
          hint="по всій ягоді періоду"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <div className="flex flex-col gap-5">
          {/* tonnage per day — one series, tooltip carries the breakdown */}
          <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <Eyebrow>Прийнято ягоди по днях</Eyebrow>
                <div className="mt-1 font-mono text-xl font-semibold">{tonnage(totals.net)}</div>
              </div>
              {busiestDay ? (
                <Badge variant="secondary" className="gap-1">
                  <TrendingUp className="size-3" />
                  Пік {shortDate(busiestDay.date)} · {kg(busiestDay.net, 0)}
                </Badge>
              ) : null}
            </div>
            <ChartContainer config={chartConfig} className="h-[220px] w-full">
              <BarChart data={daily} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={18}
                  className="text-[10px]"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  tickFormatter={(v) =>
                    v === 0 ? '0' : maxDailyNet >= 2000 ? `${num(v / 1000, 1)} т` : `${num(v)}`
                  }
                  className="text-[10px]"
                />
                <ChartTooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) => shortDate(String(p?.[0]?.payload?.date ?? ''))}
                      formatter={(value) => [`${num(Number(value), 0)} кг`, ' Прийнято']}
                    />
                  }
                />
                <Bar dataKey="net" radius={[4, 4, 0, 0]} maxBarSize={26}>
                  {daily.map((d) => (
                    <Cell
                      key={d.date}
                      fill={d.date === TODAY ? 'var(--chart-3)' : 'var(--chart-1)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
            <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-[var(--chart-1)]" /> завершені дні
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-[2px] bg-[var(--chart-3)]" /> сьогодні, день триває
              </span>
            </div>
          </div>

          {/* cash out per day — two series, stacked, with a surface gap */}
          <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <Eyebrow>Скільки виходило з каси</Eyebrow>
                <div className="mt-1 font-mono text-xl font-semibold">
                  {uah(totals.paid + totals.settled)}
                </div>
              </div>
              <span className="max-w-[280px] text-right text-[11px] leading-snug text-muted-foreground">
                Бурштинова частина — це гроші за ягоду попередніх днів. Саме вона ламає денний звіт
                в Excel.
              </span>
            </div>
            <ChartContainer config={chartConfig} className="h-[200px] w-full">
              <BarChart data={daily} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={18}
                  className="text-[10px]"
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)} тис` : String(v))}
                  className="text-[10px]"
                />
                <ChartTooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, p) => shortDate(String(p?.[0]?.payload?.date ?? ''))}
                      formatter={(value, name) => [
                        `${num(Number(value), 0)} ₴`,
                        ` ${chartConfig[name as keyof typeof chartConfig]?.label ?? name}`,
                      ]}
                    />
                  }
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="paidToday"
                  stackId="a"
                  fill="var(--color-paidToday)"
                  maxBarSize={26}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
                <Bar
                  dataKey="settled"
                  stackId="a"
                  fill="var(--color-settled)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={26}
                  stroke="var(--card)"
                  strokeWidth={2}
                />
              </BarChart>
            </ChartContainer>
          </div>

          {/* points — small multiples, no colour coding needed */}
          <div>
            <Eyebrow className="mb-2.5">Точки за період — усі, незалежно від фільтра</Eyebrow>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {byPoint.map((p) => (
                <button
                  key={p.point.id}
                  onClick={() => go({ name: 'points' })}
                  className="rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/25"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{p.point.name}</span>
                    {p.point.isMain ? (
                      <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                        основна
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 font-mono text-lg font-semibold">{tonnage(p.net)}</div>
                  <div className="text-xs text-muted-foreground">{uah(p.amount)}</div>
                  <Sparkline values={p.series} className="mt-2" height={34} />
                </button>
              ))}
              {/* «від 5 до 10» ✓ PART A — усі десять уже стоять у довіднику */}
              {registryCount ? (
                <button
                  onClick={() => go({ name: 'points' })}
                  className="rounded-xl border border-dashed border-border p-4 text-left transition-colors hover:border-foreground/25"
                >
                  <div className="text-sm font-medium text-muted-foreground">
                    +{registryCount} у реєстрі
                  </div>
                  <div className="mt-1 text-xs leading-snug text-muted-foreground">
                    точки з вашого списку, які ще не відкриті — зведення підхопить їх саме
                  </div>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---------------- right column ---------------- */}
        <div className="flex flex-col gap-5">
          <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <Eyebrow className="mb-3">Сорти за тонажем</Eyebrow>
            <div className="flex flex-col gap-3">
              {byBerry.map((x) => (
                <div key={x.berry.id}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm">{x.berry.name}</span>
                    <span className="shrink-0 font-mono text-xs font-medium">
                      {tonnage(x.net)}
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--chart-1)]"
                      style={{ width: `${(x.net / maxBerry) * 100}%` }}
                    />
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{uah(x.amount)}</div>
                </div>
              ))}
              {byBerry.length === 0 ? (
                <p className="text-sm text-muted-foreground">За цей період прийомки не було.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
              <Eyebrow>Найбільші здавальники</Eyebrow>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => go({ name: 'suppliers' })}
              >
                Усі
                <ArrowRight className="size-3" />
              </Button>
            </div>
            <ul className="divide-y divide-border/60">
              {topSuppliers.map((t, i) => (
                <li key={t.supplier.id}>
                  <button
                    onClick={() => go({ name: 'supplier', id: t.supplier.id })}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60"
                  >
                    <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm">{t.supplier.name}</span>
                        {t.supplier.wholesale ? (
                          <Badge variant="secondary" className="h-4 shrink-0 px-1.5 text-[10px]">
                            ОПТ
                          </Badge>
                        ) : null}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.count} здач · {kg(t.net, 0)}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-sm font-medium">
                      {uah(t.amount)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-dashed border-border p-4">
            <Eyebrow className="mb-2">Що це замінює</Eyebrow>
            <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
              <li>· зведення чотирьох файлів у спільну касу вручну</li>
              <li>· перерахунок чистої ваги окремо від тари</li>
              <li>· пошук, якою датою «загубився» залишок</li>
              <li>· фільтр за місяць, який вантажиться хвилинами</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
