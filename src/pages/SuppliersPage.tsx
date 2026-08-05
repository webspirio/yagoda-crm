import * as React from 'react'
import { Plus, Search, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/common/bits'
import { AddSupplierDialog } from '@/components/reception/SupplierPicker'
import { useStore } from '@/lib/store'
import { supplierBalance, sum } from '@/lib/calc'
import { kg, shortDate, uah, uahAuto } from '@/lib/format'
import { cn } from '@/lib/utils'

export function SuppliersPage() {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const go = useStore((s) => s.go)
  const [q, setQ] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [onlyDebt, setOnlyDebt] = React.useState(false)

  // на точці видно і своїх за довідником, і всіх, хто сюди реально возив — інакше людина
  // з'являлася б у «Залишках» пункту, але не в його ж списку постачальників
  const deliveredHere = React.useMemo(
    () => new Set(receptions.filter((r) => r.pointId === activePointId).map((r) => r.supplierId)),
    [receptions, activePointId],
  )

  const rows = React.useMemo(() => {
    return suppliers
      .filter(
        (s) =>
          activePointId === 'all' || s.homePointId === activePointId || deliveredHere.has(s.id),
      )
      .map((s) => {
        const items = receptions.filter((r) => r.supplierId === s.id)
        const last = items.length ? items[items.length - 1] : undefined
        return {
          supplier: s,
          count: items.length,
          net: sum(items, (r) => r.net),
          amount: sum(items, (r) => r.amount),
          balance: supplierBalance(s.id, receptions, payouts),
          last: last?.date,
        }
      })
      .filter((r) => {
        if (onlyDebt && r.balance <= 0.009) return false
        if (!q.trim()) return true
        const needle = q.toLowerCase()
        // телефон шукається, лише якщо він узагалі є: у їхньому Довіднику він порожній
        // у 209 з 209 рядків ✓ PART C 7, тому в жодного сіданого постачальника його немає
        return (
          r.supplier.name.toLowerCase().includes(needle) ||
          r.supplier.village.toLowerCase().includes(needle) ||
          (r.supplier.phone?.includes(needle) ?? false)
        )
      })
      .sort((a, b) => b.amount - a.amount)
  }, [suppliers, receptions, payouts, q, onlyDebt, activePointId, deliveredHere])

  const totalBalance = sum(rows, (r) => r.balance)

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        eyebrow={`${rows.length} у списку`}
        title="Постачальники"
        description="Одна картка на людину. Квитанція посилається на цей запис, а не на набраний текст, тому описка не роздвоює людину на два залишки — але схожі записи все одно треба звіряти й зливати вручну."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Новий постачальник
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Прізвище або село"
            className="h-9 pl-9"
          />
        </div>
        <Button
          variant={onlyDebt ? 'default' : 'outline'}
          size="sm"
          onClick={() => setOnlyDebt((v) => !v)}
        >
          Тільки з залишком
        </Button>
        <div className="ml-auto text-sm text-muted-foreground">
          Загальний залишок за нами{' '}
          <span className="font-mono font-semibold text-[var(--amber)]">{uah(totalBalance)}</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Постачальник</TableHead>
              <TableHead>Точка</TableHead>
              <TableHead className="text-right">Здач</TableHead>
              <TableHead className="text-right">Ягоди</TableHead>
              <TableHead className="text-right">Нараховано</TableHead>
              <TableHead className="text-right">Залишок</TableHead>
              <TableHead className="text-right">Остання здача</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow
                key={r.supplier.id}
                className="cursor-pointer"
                onClick={() => go({ name: 'supplier', id: r.supplier.id })}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <UserRound className="size-3.5 text-muted-foreground" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{r.supplier.name}</span>
                        {/* Дод. ціна тепер по рядку прийомки, як їхня колонка J ✓ M7 —
                            на постачальнику надбавки більше немає, лишається сам ОПТ */}
                        {r.supplier.wholesale ? (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            ОПТ
                          </Badge>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.supplier.village} ·{' '}
                        {r.supplier.phone ? (
                          <span className="font-mono">{r.supplier.phone}</span>
                        ) : (
                          <span className="text-muted-foreground/70">телефон не вказано</span>
                        )}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {points.find((p) => p.id === r.supplier.homePointId)?.name}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{r.count}</TableCell>
                <TableCell className="text-right font-mono text-sm">{kg(r.net, 1)}</TableCell>
                <TableCell className="text-right font-mono text-sm">{uah(r.amount)}</TableCell>
                <TableCell
                  className={cn(
                    'text-right font-mono text-sm',
                    r.balance > 0.009 ? 'font-semibold text-[var(--amber)]' : 'text-muted-foreground',
                  )}
                >
                  {r.balance > 0.009 ? uahAuto(r.balance) : '—'}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {r.last ? shortDate(r.last) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            Нікого не знайшли за цим запитом.
          </div>
        ) : null}
      </div>

      <AddSupplierDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pointId={activePointId === 'all' ? 'p1' : activePointId}
      />
    </div>
  )
}
