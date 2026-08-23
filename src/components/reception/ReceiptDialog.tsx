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
import { effectivePrice, round2, sum, supplierBalance } from '@/lib/calc'
import { kg, longDate, num, plural, uah, uahAuto } from '@/lib/format'
import type { Payout, Reception } from '@/lib/types'

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
  payout,
  open,
  onOpenChange,
}: {
  reception: Reception | null
  /** Виплата за попередні залишки, породжена цим самим візитом */
  payout?: Payout
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
  const point = points.find((p) => p.id === reception.pointId)
  const balance = supplier ? supplierBalance(supplier.id, receptions, payouts) : 0

  // один візит — один чек: позиції збираються тут, а не приходять пропом, щоб інші
  // сторінки могли й далі відкривати чек однією квитанцією (M5)
  const lines = reception.visitId
    ? receptions
        .filter((r) => r.visitId === reception.visitId)
        .sort((a, b) => a.code.localeCompare(b.code))
    : [reception]

  const accrued = sum(lines, (l) => l.amount)
  const carriedIn = sum(lines, (l) => l.carriedIn)
  const total = round2(accrued + carriedIn)
  // Виплату НЕ вгадуємо: вона несе visitId того візиту, надлишком якого вона є.
  // Інакше людина, що приїхала двічі за день, отримала б на першому чеку гроші,
  // видані на другому — або погашення зі сторінки «Залишки» потрапило б у чужий чек.
  const visitPayout =
    payout ?? (reception.visitId ? payouts.find((p) => p.visitId === reception.visitId) : undefined)
  const paidCash = round2(sum(lines, (l) => l.paid) + (visitPayout?.amount ?? 0))
  const remainder = round2(total - paidCash)
  const codeLabel =
    lines.length > 1
      ? `${lines[0].code} · ${lines.length} ${plural(lines.length, 'позиція', 'позиції', 'позицій')}`
      : reception.code

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Квитанція {codeLabel}</DialogTitle>
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

          <Row label="Квитанція" value={codeLabel} />
          <Row label="Дата" value={`${longDate(reception.date)}, ${reception.time}`} />
          <Row label="Постачальник" value={supplier?.name ?? '—'} />

          {lines.map((line) => (
            <div key={line.id}>
              <div className="my-3 border-t border-dashed border-neutral-300" />

              <Row label={berries.find((b) => b.id === line.berryId)?.name ?? 'Ягода'} value="" muted />
              <Row label="Брутто" value={kg(line.gross)} />
              {line.pallet > 0 ? <Row label="Піддон" value={`− ${kg(line.pallet)}`} /> : null}
              <Row
                label={`Тара (${line.tare
                  .map((t) => `${t.count} × ${tareTypes.find((x) => x.id === t.tareId)?.name ?? ''}`)
                  .join(', ')})`}
                value={`− ${kg(line.tareWeight)}`}
              />
              <div className="my-1.5 border-t border-neutral-900" />
              <Row label="Нетто" value={kg(line.net)} strong />
              <Row
                label="Ціна за кг"
                value={
                  line.bonus
                    ? `${num(line.price)} + ${num(line.bonus)} = ${num(effectivePrice(line.price, line.bonus))} ₴`
                    : `${num(line.price)} ₴`
                }
              />
              {lines.length > 1 ? <Row label="Сума" value={uah(line.amount, { decimals: 2 })} /> : null}
            </div>
          ))}

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label="Нараховано" value={uah(accrued, { decimals: 2 })} strong />
          {carriedIn > 0.009 ? (
            <>
              <Row label="Попередній залишок" value={uah(carriedIn, { decimals: 2 })} />
              <Row label="РАЗОМ" value={uah(total, { decimals: 2 })} strong />
            </>
          ) : null}
          <Row label="Видано готівкою" value={uah(paidCash, { decimals: 2 })} />
          {visitPayout ? (
            <Row
              label="з них на попередні залишки"
              value={uah(visitPayout.amount, { decimals: 2 })}
              muted
            />
          ) : null}
          {remainder > 0.009 ? (
            <Row label="Залишок за нами" value={uah(remainder, { decimals: 2 })} strong />
          ) : null}

          <div className="my-3 border-t border-dashed border-neutral-300" />

          <Row label="Загальний залишок" value={uahAuto(balance)} />
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
