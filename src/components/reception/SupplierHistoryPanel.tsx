import { ChevronRight } from 'lucide-react'
import { Eyebrow } from '@/components/common/bits'
import { useStore } from '@/lib/store'
import { sum } from '@/lib/calc'
import { kg, plural, shortDate, uah } from '@/lib/format'

/**
 * Компактна історія постачальника просто на прийомці (#7 / #9). Приймальник обрав людину —
 * і бачить, скільки вона вже здала за сезон і кілька останніх здач, не йдучи в її картку.
 *
 * Дані дзеркалять `SupplierPage` СВІДОМО: там `items` не звужені по точці (season-wide), бо
 * «Здач за сезон» рахує все здане людиною, а не лише на цьому пункті. Попунктний — це
 * ЗАЛИШОК, і його вже показують сусідні плашки в секції 1. Тому тут `supplierId` достатньо,
 * а `pointId` панелі не потрібен: жодне число нижче від точки не залежить.
 *
 * Порожній випадок — тиха фраза, не крах і не NaN: у новачка ще нема жодного рядка, і `sum()`
 * на порожньому масиві дає 0, а не NaN, тому гілку з тоталами тоді просто не малюємо.
 */
export function SupplierHistoryPanel({ supplierId }: { supplierId: string }) {
  const receptions = useStore((s) => s.receptions)
  const berries = useStore((s) => s.berries)
  const go = useStore((s) => s.go)

  // усі здачі людини, найновіші вгорі — той самий фільтр і те саме сортування, що в SupplierPage
  const items = receptions
    .filter((r) => r.supplierId === supplierId)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))

  const totalNet = sum(items, (r) => r.net)
  const totalAmount = sum(items, (r) => r.amount)
  const recent = items.slice(0, 3)

  return (
    <div className="mt-2.5 rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-foreground/5">
      <div className="flex items-center justify-between gap-2">
        <Eyebrow>Історія здач</Eyebrow>
        <button
          onClick={() => go({ name: 'supplier', id: supplierId })}
          className="flex items-center gap-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          Картка постачальника
          <ChevronRight className="size-3.5" />
        </button>
      </div>

      {items.length === 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          Здач ще не було — це буде перша.
        </p>
      ) : (
        <>
          <div className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono font-medium text-foreground">{items.length}</span>{' '}
            {plural(items.length, 'здача', 'здачі', 'здач')} ·{' '}
            <span className="font-mono font-medium text-foreground">{kg(totalNet, 1)}</span> ·{' '}
            <span className="font-mono font-medium text-foreground">{uah(totalAmount)}</span>
          </div>
          <ul className="mt-2 flex flex-col gap-1">
            {recent.map((r) => (
              <li key={r.id} className="flex items-center gap-2 text-xs">
                <span className="w-10 shrink-0 font-mono text-muted-foreground">
                  {shortDate(r.date)}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {berries.find((b) => b.id === r.berryId)?.name ?? '—'} · {kg(r.net, 1)}
                </span>
                <span className="shrink-0 font-mono font-medium">{uah(r.amount)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
