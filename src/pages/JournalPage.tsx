import * as React from 'react'
import { Download, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/common/bits'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { useStore } from '@/lib/store'
import { sum } from '@/lib/calc'
import { addDays, kg, num, shortDate, tonnage, uah } from '@/lib/format'
import { SEASON_START, TODAY } from '@/lib/seed'
import { toast } from 'sonner'
import type { Reception } from '@/lib/types'

const PRESETS = [
  { id: 'today', label: 'Сьогодні', from: TODAY, to: TODAY },
  { id: 'w', label: '7 днів', from: addDays(TODAY, -6), to: TODAY },
  { id: 'm', label: 'Липень', from: '2026-07-01', to: '2026-07-31' },
  { id: 'all', label: 'Весь сезон', from: SEASON_START, to: TODAY },
]

export function JournalPage() {
  const receptions = useStore((s) => s.receptions)
  const suppliers = useStore((s) => s.suppliers)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)

  const [from, setFrom] = React.useState(PRESETS[3].from)
  const [to, setTo] = React.useState(PRESETS[3].to)
  const [berryId, setBerryId] = React.useState('all')
  const [q, setQ] = React.useState('')
  const [limit, setLimit] = React.useState(150)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)

  const { rows, ms } = React.useMemo(() => {
    const t0 = performance.now()
    const needle = q.trim().toLowerCase()
    const supplierById = new Map(suppliers.map((s) => [s.id, s]))
    const out = receptions
      .filter((r) => {
        if (r.date < from || r.date > to) return false
        if (activePointId !== 'all' && r.pointId !== activePointId) return false
        if (berryId !== 'all' && r.berryId !== berryId) return false
        if (needle) {
          const s = supplierById.get(r.supplierId)
          if (!s || !s.name.toLowerCase().includes(needle)) return false
        }
        return true
      })
      .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
    return { rows: out, ms: performance.now() - t0 }
  }, [receptions, suppliers, from, to, berryId, q, activePointId])

  React.useEffect(() => setLimit(150), [from, to, berryId, q, activePointId])

  const totals = {
    net: sum(rows, (r) => r.net),
    amount: sum(rows, (r) => r.amount),
    paid: sum(rows, (r) => r.paid),
    debt: sum(rows, (r) => r.debt),
  }

  function exportCsv() {
    const head = [
      'Дата', 'Час', 'Квитанція', 'Точка', 'Постачальник', 'Сорт',
      'Брутто', 'Тара', 'Нетто', 'Ціна', 'Надбавка', 'Нараховано', 'Видано', 'Залишок',
    ]
    const lines = rows.map((r) =>
      [
        r.date, r.time, r.code,
        points.find((p) => p.id === r.pointId)?.name ?? '',
        suppliers.find((s) => s.id === r.supplierId)?.name ?? '',
        berries.find((b) => b.id === r.berryId)?.name ?? '',
        r.gross, r.tareWeight, r.net, r.price, r.bonus, r.amount, r.paid, r.debt,
      ].join(';'),
    )
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prijomka_${from}_${to}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Вивантажено ${rows.length} записів`)
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="повний реєстр"
        title="Журнал прийомки"
        description="Усі квитанції сезону в одному місці. Фільтр за місяць відпрацьовує миттєво — база не залежить від того, скільки в ній рядків."
        actions={
          <Button variant="outline" onClick={exportCsv}>
            <Download className="size-4" />
            Вивантажити CSV
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            size="sm"
            variant={from === p.from && to === p.to ? 'default' : 'outline'}
            onClick={() => {
              setFrom(p.from)
              setTo(p.to)
            }}
          >
            {p.label}
          </Button>
        ))}
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={from}
            min={SEASON_START}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
          <span className="text-muted-foreground">—</span>
          <Input
            type="date"
            value={to}
            min={from}
            max={TODAY}
            onChange={(e) => setTo(e.target.value)}
            className="h-8 w-[140px] text-xs"
          />
        </div>
        <Select value={berryId} onValueChange={setBerryId}>
          <SelectTrigger className="h-8 w-[180px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Усі сорти</SelectItem>
            {berries.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Постачальник"
          className="h-8 w-[190px] text-xs"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
        <Summary label="Квитанцій" value={num(rows.length)} />
        <Summary label="Ягоди" value={tonnage(totals.net)} />
        <Summary label="Нараховано" value={uah(totals.amount)} />
        <Summary label="Видано" value={uah(totals.paid)} />
        <Summary label="У залишок" value={uah(totals.debt)} tone="amber" />
        <Badge
          variant="secondary"
          className="ml-auto gap-1 font-mono text-[11px] text-[var(--leaf)]"
        >
          <Zap className="size-3" />
          {ms < 1 ? '<1' : ms.toFixed(0)} мс
        </Badge>
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[74px]">Дата</TableHead>
              <TableHead className="w-[60px]">Час</TableHead>
              <TableHead className="w-[86px]">Квитанція</TableHead>
              <TableHead>Постачальник</TableHead>
              <TableHead>Сорт</TableHead>
              <TableHead className="text-right">Брутто</TableHead>
              <TableHead className="text-right">Тара</TableHead>
              <TableHead className="text-right">Нетто</TableHead>
              <TableHead className="text-right">Ціна</TableHead>
              <TableHead className="text-right">Сума</TableHead>
              <TableHead className="text-right">Видано</TableHead>
              <TableHead className="text-right">Залишок</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, limit).map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setReceipt(r)}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {shortDate(r.date)}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.time}</TableCell>
                <TableCell className="font-mono text-xs">{r.code}</TableCell>
                <TableCell className="max-w-[190px] truncate text-sm">
                  {suppliers.find((s) => s.id === r.supplierId)?.name}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {berries.find((b) => b.id === r.berryId)?.short}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  {num(r.gross, 2)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs text-muted-foreground">
                  −{num(r.tareWeight, 2)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-medium">
                  {kg(r.net, 2)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {num(r.price + r.bonus)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">{uah(r.amount)}</TableCell>
                <TableCell className="text-right font-mono text-sm text-muted-foreground">
                  {uah(r.paid)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm">
                  {r.debt > 0 ? (
                    <span className="font-medium text-[var(--amber)]">{uah(r.debt)}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > limit ? (
          <div className="border-t border-border/70 p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 250)}>
              Показати ще — залишилось {num(rows.length - limit)}
            </Button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            За цими умовами нічого немає.
          </div>
        ) : null}
      </div>

      <ReceiptDialog
        reception={receipt}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
    </div>
  )
}

function Summary({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'amber'
}) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </div>
      <div
        className={`font-mono text-lg font-semibold ${tone === 'amber' ? 'text-[var(--amber)]' : ''}`}
      >
        {value}
      </div>
    </div>
  )
}
