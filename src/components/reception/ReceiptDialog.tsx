import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStore } from '@/lib/store'
import { supplierBalance } from '@/lib/calc'
import { kg, longDate, num, uah } from '@/lib/format'
import type { Reception } from '@/lib/types'

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-[3px]">
      <span className={muted ? 'text-neutral-500' : ''}>{label}</span>
      <span className={`font-mono ${strong ? 'text-base font-semibold' : ''}`}>{value}</span>
    </div>
  )
}

export function ReceiptDialog({
  reception,
  open,
  onOpenChange,
}: {
  reception: Reception | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const suppliers = useStore((s) => s.suppliers)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const tareTypes = useStore((s) => s.tareTypes)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)

  if (!reception) return null
  const supplier = suppliers.find((s) => s.id === reception.supplierId)
  const berry = berries.find((b) => b.id === reception.berryId)
  const point = points.find((p) => p.id === reception.pointId)
  const balance = supplier ? supplierBalance(supplier.id, receptions, payouts) : 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Квитанція {reception.code}</DialogTitle>
        </DialogHeader>

        <div
          id="receipt-print"
          className="printable rounded-lg border border-dashed border-neutral-300 bg-white p-4 text-[13px] text-neutral-900"
        >
          <div className="text-center">
            <div className="font-display text-sm font-semibold tracking-tight">
              ПРИЙОМКА ЯГОДИ
            </div>
            <div className="text-[11px] text-neutral-500">
              {point?.name} · {point?.village}
            </div>
          </div>

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label="Квитанція" value={reception.code} />
          <Row label="Дата" value={`${longDate(reception.date)}, ${reception.time}`} />
          <Row label="Постачальник" value={supplier?.name ?? '—'} />

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label={berry?.name ?? 'Ягода'} value="" muted />
          <Row label="Брутто" value={kg(reception.gross)} />
          <Row
            label={`Тара (${reception.tare
              .map((t) => `${t.count} × ${tareTypes.find((x) => x.id === t.tareId)?.name ?? ''}`)
              .join(', ')})`}
            value={`− ${kg(reception.tareWeight)}`}
          />
          <div className="my-1.5 border-t border-neutral-900" />
          <Row label="Нетто" value={kg(reception.net)} strong />
          <Row
            label="Ціна за кг"
            value={
              reception.bonus
                ? `${num(reception.price)} + ${num(reception.bonus)} = ${num(reception.price + reception.bonus)} ₴`
                : `${num(reception.price)} ₴`
            }
          />

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label="Нараховано" value={uah(reception.amount, { decimals: 2 })} strong />
          <Row label="Видано готівкою" value={uah(reception.paid, { decimals: 2 })} />
          {reception.debt > 0 ? (
            <Row label="Залишок за нами" value={uah(reception.debt, { decimals: 2 })} strong />
          ) : null}

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label="Загальний залишок" value={uah(balance)} />
          <Row label="Приймав" value={reception.operator} muted />

          <div className="mt-4 text-center text-[10px] text-neutral-400">
            Квитанція збережена в системі. Дублікат можна роздрукувати будь-коли.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Закрити
          </Button>
          <Button onClick={() => window.print()}>
            <Printer className="size-4" />
            Друк
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
