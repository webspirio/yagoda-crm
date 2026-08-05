import * as React from 'react'
import { Package, Sprout } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { useStore } from '@/lib/store'
import { longDate, num } from '@/lib/format'
import { TODAY } from '@/lib/seed'
import { toast } from 'sonner'

export function RefsPage() {
  const tareTypes = useStore((s) => s.tareTypes)
  const berries = useStore((s) => s.berries)
  const updateTareType = useStore((s) => s.updateTareType)
  const receptions = useStore((s) => s.receptions)

  const usage = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const r of receptions)
      for (const line of r.tare) map.set(line.tareId, (map.get(line.tareId) ?? 0) + line.count)
    return map
  }, [receptions])

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        eyebrow="довідники"
        title="Тара і сорти"
        description="Вага тари задається один раз і далі знімається сама. Змінили вагу ящика — нові квитанції рахуються по новій, старі лишаються як були."
      />

      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="mb-3 flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <Eyebrow>Види тари</Eyebrow>
          </div>
          <div className="flex flex-col gap-2">
            {tareTypes.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">
                    використано {num(usage.get(t.id) ?? 0)} шт за сезон
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={String(t.weight)}
                    onChange={(e) => {
                      const v = Number(e.target.value.replace(',', '.'))
                      if (Number.isFinite(v) && v >= 0) updateTareType(t.id, { weight: v })
                    }}
                    onBlur={() => toast.success(`${t.name} — ${num(t.weight, 2)} кг`)}
                    inputMode="decimal"
                    className="h-9 w-20 text-right font-mono"
                  />
                  <span className="w-6 text-xs text-muted-foreground">кг</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Приймальник вагу тари не редагує — він лише вибирає вид і кількість.
          </p>
        </div>

        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="mb-3 flex items-center gap-2">
            <Sprout className="size-4 text-muted-foreground" />
            <Eyebrow>Сорти сезону</Eyebrow>
          </div>
          <div className="flex flex-col gap-2">
            {berries.map((b) => {
              const active = TODAY >= b.from && TODAY <= b.to
              return (
                <div
                  key={b.id}
                  className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {longDate(b.from)} — {longDate(b.to)}
                    </div>
                  </div>
                  {active ? (
                    <Badge variant="secondary" className="text-[10px] text-[var(--leaf)]">
                      приймаємо
                    </Badge>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">сезон закрито</span>
                  )}
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Поза сезоном сорт зникає з екрана прийомки — випадково пробити його неможливо.
          </p>
        </div>
      </div>
    </div>
  )
}
