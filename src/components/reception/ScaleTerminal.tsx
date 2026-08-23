import { ArrowRight, Equal, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { num, uah } from '@/lib/format'
import { effectivePrice } from '@/lib/calc'

interface Props {
  berryName?: string
  gross: number
  /** Піддон — знімається до тари, тому стоїть під брутто, а не поруч із нею */
  pallet: number
  tareWeight: number
  tareUnits: number
  tareLabel?: string
  net: number
  price: number
  bonus: number
  amount: number
  ready: boolean
}

function Readout({
  value,
  unit,
  className,
  glow,
}: {
  value: string
  unit: string
  className?: string
  glow?: boolean
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span
        key={value}
        className={cn(
          'animate-tick font-mono font-semibold tracking-tight',
          glow && 'readout-glow',
          className,
        )}
      >
        {value}
      </span>
      <span className="font-mono text-xs text-white/35">{unit}</span>
    </div>
  )
}

export function ScaleTerminal({
  berryName,
  gross,
  pallet,
  tareWeight,
  tareUnits,
  tareLabel,
  net,
  price,
  bonus,
  amount,
  ready,
}: Props) {
  // an idle platform scale reads zero, not blank
  const dash = '0,00'

  return (
    <div className="relative overflow-hidden rounded-2xl bg-terminal text-white ring-1 ring-black/20">
      <div className="pointer-events-none absolute inset-0 grain opacity-40" />

      <div className="relative flex items-center justify-between gap-3 border-b border-terminal-line px-5 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-1.5 rounded-full transition-colors',
              ready ? 'bg-readout' : 'bg-white/20',
            )}
          />
          <span className="text-[10px] font-medium tracking-[0.2em] text-white/45 uppercase">
            Розрахунок ваги
          </span>
        </div>
        <span className="truncate font-mono text-[11px] text-white/55">
          {berryName ?? 'сорт не обрано'}
        </span>
      </div>

      {/* brutto − tare */}
      <div className="relative grid grid-cols-2 divide-x divide-terminal-line">
        <div className="px-5 py-4">
          <div className="mb-1.5 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Брутто
          </div>
          <Readout
            value={gross > 0 ? num(gross, 2) : dash}
            unit="кг"
            className={cn('text-3xl', gross > 0 ? 'text-white/90' : 'text-white/25')}
          />
          {pallet > 0 ? (
            <div className="mt-1 font-mono text-[11px] text-white/35">
              − піддон {num(pallet, 2)} кг
            </div>
          ) : null}
        </div>
        <div className="px-5 py-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            <Minus className="size-3" /> Тара
          </div>
          <Readout
            value={tareWeight > 0 ? num(tareWeight, 2) : dash}
            unit="кг"
            className={cn('text-3xl', tareWeight > 0 ? 'text-white/90' : 'text-white/25')}
          />
          <div className="mt-1 font-mono text-[11px] text-white/35">
            {tareUnits > 0 ? `${tareUnits} × ${tareLabel}` : 'тару не додано'}
          </div>
        </div>
      </div>

      {/* net — the number the whole app exists for */}
      <div className="relative flex items-end justify-between gap-4 border-y border-terminal-line bg-terminal-2 px-5 py-5">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium tracking-[0.18em] text-readout/60 uppercase">
            <Equal className="size-3" /> Нетто — чиста вага
          </div>
          <Readout
            value={net > 0 ? num(net, 2) : dash}
            unit="кг"
            glow={net > 0}
            className={cn(
              'text-[56px] leading-[0.95]',
              net > 0 ? 'text-readout' : 'text-white/15',
            )}
          />
        </div>
        <div className="pb-1.5 text-right">
          <div className="mb-1 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
            Ціна
          </div>
          <div className="font-mono text-lg font-medium text-white/85">
            {price > 0 ? `${num(effectivePrice(price, bonus))} ₴/кг` : '—'}
          </div>
          {bonus !== 0 ? (
            <div className="font-mono text-[11px] text-[#f2a4bb]">
              {num(price)} {bonus > 0 ? '+' : '−'} {num(Math.abs(bonus))} Дод. ціна
            </div>
          ) : null}
        </div>
      </div>

      {/* amount */}
      <div className="relative flex items-center justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-2 text-[10px] font-medium tracking-[0.18em] text-white/35 uppercase">
          Нетто <ArrowRight className="size-3" /> сума до розрахунку
        </div>
        <div
          key={amount}
          className={cn(
            'animate-tick font-mono text-2xl font-semibold tracking-tight',
            amount > 0 ? 'text-white' : 'text-white/20',
          )}
        >
          {amount > 0 ? uah(amount, { decimals: 2 }) : '0,00 ₴'}
        </div>
      </div>
    </div>
  )
}
