import * as React from 'react'
import { Package, Sliders, Sprout } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { useStore } from '@/lib/store'
import { longDate, num } from '@/lib/format'
import { maskDecimalInput, parseNumeric } from '@/lib/calc'
import { PRODUCTS, TODAY } from '@/lib/seed'
import { toast } from 'sonner'

/**
 * Чотири ціни, звірені з їхнім Довідником ✓ PART A: Ожина 60 / Ожина ОПТ 65 і
 * Шипшина 35 / Шипшина ОПТ 30. Решта 13 — заповнювачі, і на екрані вони так і
 * позначені. Ця пара — доказ, що ОПТ окремий сорт зі своєю ціною, а не множник.
 */
const CONFIRMED_PRODUCTS = new Set(['Ожина', 'Шипшина'])

export function RefsPage() {
  const tareTypes = useStore((s) => s.tareTypes)
  const berries = useStore((s) => s.berries)
  const updateTareType = useStore((s) => s.updateTareType)
  const receptions = useStore((s) => s.receptions)
  const role = useStore((s) => s.role)

  const usage = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const r of receptions)
      for (const line of r.tare) map.set(line.tareId, (map.get(line.tareId) ?? 0) + line.count)
    return map
  }, [receptions])

  // Товар → Сорт, 9 → 17 ✓ PART A. У коді список лишається плоским і ключем ціни
  // є сорт; два рівні існують поки що тільки на екрані (docs/07-roadmap §1.2).
  const byProduct = PRODUCTS.map((p) => ({
    product: p,
    grades: berries.filter((b) => b.product === p.name),
  }))
  const emptyProducts = byProduct.filter((g) => !g.grades.length)

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
              <div key={t.id} className="rounded-lg border border-border/70 px-3 py-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      використано {num(usage.get(t.id) ?? 0)} шт за сезон
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      value={String(t.weight)}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(',', '.'))
                        if (Number.isFinite(v) && v >= 0) updateTareType(t.id, { weight: v })
                      }}
                      onBlur={() => toast.success(`${t.name} — ${num(t.weight, 2)} кг`)}
                      inputMode="decimal"
                      className="h-9 w-[68px] text-right font-mono"
                    />
                    <span className="w-5 text-xs text-muted-foreground">кг</span>
                    <Input
                      value={String(t.price)}
                      onChange={(e) => {
                        const v = Number(e.target.value.replace(',', '.'))
                        if (Number.isFinite(v) && v >= 0) updateTareType(t.id, { price: v })
                      }}
                      onBlur={() => toast.success(`${t.name} — ${num(t.price)} ₴`)}
                      inputMode="decimal"
                      className="h-9 w-[68px] text-right font-mono"
                    />
                    <span className="w-4 text-xs text-muted-foreground">₴</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Приймальник вагу тари не редагує — він лише вибирає вид і кількість. Ціна тари — це
            вартість самого ящика, і саме від неї рахується Залог. Облік ящиків — окрема
            підсистема, яку ми поки не будуємо.
          </p>
        </div>

        <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <div className="mb-3 flex items-center gap-2">
            <Sprout className="size-4 text-muted-foreground" />
            <Eyebrow>Товар → сорт</Eyebrow>
          </div>
          <div className="flex flex-col gap-3">
            {byProduct
              .filter((g) => g.grades.length > 0)
              .map((g) => (
                <div key={g.product.id}>
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="text-[11px] font-medium tracking-[0.16em] uppercase">
                      {g.product.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {g.grades.length} {g.grades.length === 1 ? 'сорт' : 'сорти'}
                    </span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {g.grades.map((b) => {
                      // сорт із retired не «приймаємо» навіть у своєму вікні сезону (D-8)
                      const active = !b.retired && TODAY >= b.from && TODAY <= b.to
                      return (
                        <div
                          key={b.id}
                          className="flex items-center gap-2.5 rounded-lg border border-border/70 px-3 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm">{b.name}</span>
                              {b.wholesale ? (
                                <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                  ОПТ
                                </Badge>
                              ) : null}
                              {b.retired ? (
                                <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                                  не в обігу
                                </Badge>
                              ) : null}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              {longDate(b.from)} — {longDate(b.to)}
                            </div>
                          </div>
                          <span className="shrink-0 font-mono text-sm font-medium">
                            {num(b.basePrice)} ₴
                            {CONFIRMED_PRODUCTS.has(b.product) ? (
                              <span className="ml-1 text-[var(--leaf)]">✓</span>
                            ) : null}
                          </span>
                          {active ? (
                            <span className="w-[74px] shrink-0 text-right text-[10px] text-[var(--leaf)]">
                              приймаємо
                            </span>
                          ) : (
                            <span className="w-[74px] shrink-0 text-right text-[10px] text-muted-foreground">
                              {b.retired
                                ? 'виведено'
                                : TODAY < b.from
                                  ? 'сезон ще не почався'
                                  : 'сезон закрито'}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Ціна привʼязана до сорту, не до товару: Ожина 60 і Ожина ОПТ 65, але Шипшина 35 і
            Шипшина ОПТ 30 — ОПТ не завжди дорожчий. <span className="text-[var(--leaf)]">✓</span>{' '}
            — ціна звірена з вашим Довідником, решта — заповнювачі. Поза сезоном сорт зникає з
            екрана прийомки — випадково пробити його неможливо.
          </p>
        </div>
      </div>

      {/* Кизил є серед 9 товарів, але не має жодного з 17 сортів ✓ PART A —
          тара тягнеться VLOOKUP по сорту, і ціна теж по сорту (docs/05 §1.2) */}
      {emptyProducts.length ? (
        <div className="mt-5 rounded-xl border border-dashed border-border p-4">
          <Eyebrow className="mb-2">Товар без сортів</Eyebrow>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {emptyProducts.map((g) => g.product.name).join(', ')} — у переліку товарів є, жодного
            сорту немає, тому ні тари, ні ціни. У новій системі сорт — обовʼязкове поле, і товар
            без сортів просто не зʼявляється на кроці 2.
          </p>
        </div>
      ) : null}

      {role === 'owner' ? <SurchargeBounds /> : null}
    </div>
  )
}

/**
 * Межі Дод. ціни — M7 плюс M34: «30 - це максимум» і «щоб я могла змінювати оцю
 * максимальну ціну» (дзвінок №4, ряд. 701, 714). Мінус реальний і теж до −30, тому
 * maskDecimalInput тут із allowNegative. У їхньому ж файлі на цю колонку не стоїть нічого ✓ H7.
 */
function SurchargeBounds() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [min, setMin] = React.useState(String(settings.surchargeMin))
  const [max, setMax] = React.useState(String(settings.surchargeMax))

  function commit(which: 'min' | 'max', raw: string) {
    // parseNumeric() refuses anything ambiguous, so a half-typed bound cannot become NaN
    const v = parseNumeric(raw)
    if (which === 'min') {
      const next = Math.min(v, settings.surchargeMax)
      updateSettings({ surchargeMin: next })
      setMin(String(next))
    } else {
      const next = Math.max(v, settings.surchargeMin)
      updateSettings({ surchargeMax: next })
      setMax(String(next))
    }
    toast.success('Межі Дод. ціни збережено')
  }

  return (
    <div className="mt-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <div className="mb-3 flex items-center gap-2">
        <Sliders className="size-4 text-muted-foreground" />
        <Eyebrow>Межі Дод. ціни — тільки керівник</Eyebrow>
      </div>
      <div className="flex flex-wrap items-end gap-5">
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Не менше, ₴/кг</div>
          <Input
            value={min}
            onChange={(e) => setMin(maskDecimalInput(e.target.value, 2, true))}
            onBlur={() => commit('min', min)}
            inputMode="decimal"
            className="h-10 w-[110px] text-right font-mono text-base"
          />
        </div>
        <div>
          <div className="mb-1 text-xs text-muted-foreground">Не більше, ₴/кг</div>
          <Input
            value={max}
            onChange={(e) => setMax(maskDecimalInput(e.target.value, 2, true))}
            onBlur={() => commit('max', max)}
            inputMode="decimal"
            className="h-10 w-[110px] text-right font-mono text-base"
          />
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Приймальник не зможе виставити надбавку поза цими межами. Змінюйте, коли ринок стрибає.
      </p>
      <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Ваші слова: «30 - це максимум», і мінус теж справжній — «то ми закрили мінус 30, бо далека
        дорога». Тому початково стоїть від −30 до +30, а не до +25: жорсткіша межа відкидала б ваші
        ж дані. У самій таблиці на цю колонку не стоїть нічого: перевірка там буквально «це число і
        не дата», ні верхньої, ні нижньої межі, ні дозволу.
      </p>
    </div>
  )
}
