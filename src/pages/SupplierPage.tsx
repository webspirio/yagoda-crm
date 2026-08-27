import * as React from 'react'
import { ArrowLeft, HandCoins, Phone, Receipt, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Eyebrow, StatTile } from '@/components/common/bits'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { SettleDialog } from '@/components/debts/SettleDialog'
import { scopedReceptions, useStore } from '@/lib/store'
import { effectivePrice, openDebts, originDates, supplierBalanceAt, sum } from '@/lib/calc'
import { daysBetween, daysWord, kg, longDate, num, shortDate, uah, uahAuto } from '@/lib/format'
import { KindBadge, KindChoice } from '@/components/common/kind'
import { KIND_LABEL } from '@/lib/kind'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Reception, SupplierKind } from '@/lib/types'

/**
 * Розклад залишку по точках. Керівникові в режимі «Усі точки» одного числа не досить:
 * борг попунктний, і саме тут видно, де він лежить. Σ рядків дорівнює сумі у плитці —
 * порожні точки не показуємо, бо нуль нічого не додає.
 */
function PointBreakdown({ rows }: { rows: { id: string; name: string; balance: number }[] }) {
  if (!rows.length) return null
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Eyebrow className="mr-1">Де саме лежить</Eyebrow>
      {rows.map((r) => (
        <span
          key={r.id}
          className="rounded-lg bg-card px-3 py-1.5 text-sm ring-1 ring-foreground/10"
        >
          {r.name}{' '}
          <span className="ml-1 font-mono font-semibold text-[var(--amber)]">
            {uahAuto(r.balance)}
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * Тристановий маркер на людині. `В3` → варіант В: приймальник ставить його при створенні
 * **і змінює потім** — «цей маркер можна змінювати і в процесі роботи… приймальник це
 * нічого» (дзвінок №4, ряд. 739–741). Черги погодження немає, обмеження по ролі немає;
 * слід лишає сам `updateSupplier`.
 */
function KindPicker({
  kind,
  onPick,
}: {
  kind: SupplierKind
  onPick: (k: SupplierKind) => void
}) {
  return (
    <div className="mb-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <Eyebrow>Хто це</Eyebrow>
      <KindChoice value={kind} onChange={onPick} />
    </div>
  )
}

export function SupplierPage({ id }: { id: string }) {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const berries = useStore((s) => s.berries)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const go = useStore((s) => s.go)
  const updateSupplier = useStore((s) => s.updateSupplier)
  const config = useStore((s) => s.config)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)
  const [settle, setSettle] = React.useState(false)
  const [phoneDraft, setPhoneDraft] = React.useState('')

  const supplier = suppliers.find((s) => s.id === id)
  if (!supplier) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center text-muted-foreground">
        Картку не знайдено.
      </div>
    )
  }

  const items = receptions
    .filter((r) => r.supplierId === id)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  const pays = payouts
    .filter((p) => p.supplierId === id)
    .sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))
  // Е2: книга кожного пункту своя — «він цей борг з іншої точки забрати не може»
  // (дзвінок №4, ряд. 902).
  const onPoint = activePointId !== 'all'
  // книга пункту — по прив'язках виплат, не по їхньому штампу (calc.ts). openDebts()
  // так уже й рахує, тому їй дають ПОВНИЙ масив виплат: чужі прив'язки просто не збігаються
  const balance = supplierBalanceAt(id, receptions, payouts, activePointId)
  const open = openDebts(id, scopedReceptions(receptions, activePointId), payouts)
  const oldest = open.length ? open[0].reception.date : undefined

  // Розклад для режиму «Усі точки». Фільтруємо вже звужені масиви цієї людини — дешевше,
  // ніж 11 проходів по всій мережі, і результат той самий.
  const byPoint = onPoint
    ? []
    : points
        .map((p) => ({
          id: p.id,
          name: p.name,
          balance: supplierBalanceAt(id, items, pays, p.id),
        }))
        .filter((r) => Math.abs(r.balance) > 0.009)

  function changeKind(kind: SupplierKind) {
    updateSupplier(id, { kind })
    toast.success(kind === 'none' ? 'Позначку знято' : `Тепер ${KIND_LABEL[kind]}`)
  }

  const timeline = [
    ...items.map((r) => ({ kind: 'r' as const, date: r.date, time: r.time, r })),
    ...pays.map((p) => ({ kind: 'p' as const, date: p.date, time: p.time, p })),
  ].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time))

  return (
    <div className="mx-auto max-w-[1100px]">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-3 text-muted-foreground"
        onClick={() => go({ name: 'suppliers' })}
      >
        <ArrowLeft className="size-4" />
        Усі постачальники
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl leading-tight font-medium">{supplier.name}</h1>
            {/* Дод. ціна живе на рядку прийомки (їхня колонка J) ✓ M7 — на людині її немає */}
            <KindBadge kind={supplier.kind} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Phone className="size-3.5" />
              {supplier.phone ? (
                <span className="font-mono">{supplier.phone}</span>
              ) : (
                <span className="text-muted-foreground/70">телефон не вказано</span>
              )}
            </span>
            <span>{supplier.village}</span>
            <span>·</span>
            <span>{points.find((p) => p.id === supplier.homePointId)?.name}</span>
          </div>
          {supplier.note ? (
            <p className="mt-2 text-sm text-muted-foreground italic">«{supplier.note}»</p>
          ) : null}
        </div>
        {balance > 0.009 ? (
          <Button onClick={() => setSettle(true)}>
            <HandCoins className="size-4" />
            Видати залишок {uahAuto(balance)}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3 pb-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Здач за сезон" value={String(items.length)} />
        <StatTile label="Ягоди здано" value={kg(sum(items, (r) => r.net), 1)} />
        <StatTile label="Нараховано" value={uah(sum(items, (r) => r.amount))} />
        <StatTile
          label={onPoint ? 'Залишок на цій точці' : 'Залишок по всіх точках'}
          value={uahAuto(balance)}
          tone={balance > 0.009 ? 'amber' : 'leaf'}
          hint={
            oldest
              ? `найстаріший з ${shortDate(oldest)} — ${daysWord(daysBetween(oldest, config.businessToday))}`
              : 'усе розраховано'
          }
        />
      </div>

      <PointBreakdown rows={byPoint} />

      <KindPicker kind={supplier.kind} onPick={changeKind} />

      {/* Довідник!B порожній у 209 з 209 рядків ✓ PART C 7, H5 — тому контактів немає
          ні в кого, і жоден канал сповіщень тут не обіцяємо */}
      {supplier.phone ? null : (
        <div className="mb-5 rounded-xl border border-dashed border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              Телефон не вказано. У вашій таблиці він порожній у 209 з 209 записів, тому
              контактних даних сьогодні немає ні в кого. Номер можна дописати тут, у картці.
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <Input
                value={phoneDraft}
                onChange={(e) => setPhoneDraft(e.target.value)}
                placeholder="+380…"
                inputMode="tel"
                className="h-9 w-[160px] font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!phoneDraft.trim()}
                onClick={() => {
                  updateSupplier(id, { phone: phoneDraft.trim() })
                  toast.success('Телефон збережено')
                }}
              >
                Додати
              </Button>
            </div>
          </div>
        </div>
      )}

      {open.length ? (
        <div className="mb-5 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <Eyebrow className="mb-3">Відкриті залишки — за що саме винні</Eyebrow>
          <div className="flex flex-col gap-1.5">
            {open.map((o) => (
              <div
                key={o.reception.id}
                className="flex items-center gap-3 rounded-lg bg-[var(--amber)]/8 px-3 py-2 text-sm"
              >
                <Wallet className="size-3.5 shrink-0 text-[var(--amber)]" />
                <span className="font-mono text-xs text-muted-foreground">
                  {o.reception.code}
                </span>
                <span>{longDate(o.reception.date)}</span>
                <span className="text-xs text-muted-foreground">
                  {berries.find((b) => b.id === o.reception.berryId)?.name} · {kg(o.reception.net, 1)}
                </span>
                <span className="ml-auto font-mono font-semibold text-[var(--amber)]">
                  {uahAuto(o.open)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="border-b border-border/70 px-4 py-3">
          <Eyebrow>Історія — здачі та виплати</Eyebrow>
        </div>
        <ul className="divide-y divide-border/60">
          {timeline.map((row, i) => {
            if (row.kind === 'r') {
              const b = berries.find((x) => x.id === row.r.berryId)
              return (
                <li key={`r${i}`}>
                  <button
                    onClick={() => setReceipt(row.r)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/60"
                  >
                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                      {shortDate(row.date)}
                    </span>
                    <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                      {row.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">
                        {b?.name} · {kg(row.r.net, 1)}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {num(row.r.gross, 2)} брутто − {num(row.r.tareWeight, 2)} тара ·{' '}
                        {num(effectivePrice(row.r.price, row.r.bonus))} ₴/кг
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-medium">
                        {uah(row.r.amount)}
                      </span>
                      {row.r.debt > 0.009 ? (
                        <span className="block font-mono text-[11px] text-[var(--amber)]">
                          у залишок {uahAuto(row.r.debt)}
                        </span>
                      ) : row.r.debt < -0.009 ? (
                        // переплата: вона зводиться в найстаріші залишки, і без цього рядка
                        // «Відкриті залишки» вище не сходились би зі своєю ж арифметикою
                        <span className="block font-mono text-[11px] text-[var(--leaf)]">
                          переплата {uahAuto(-row.r.debt)}
                        </span>
                      ) : null}
                    </span>
                    <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            }
            return (
              <li key={`p${i}`} className="flex items-center gap-3 bg-[var(--leaf)]/6 px-4 py-2.5">
                <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                  {shortDate(row.date)}
                </span>
                <span className="w-10 shrink-0 font-mono text-[11px] text-muted-foreground">
                  {row.time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">Видано залишок</span>
                  <span className="block text-xs text-muted-foreground">
                    закрито ягоду за{' '}
                    {originDates(row.p.allocations).map(shortDate).join(', ')}
                  </span>
                </span>
                <span
                  className={cn('shrink-0 font-mono text-sm font-medium text-[var(--leaf)]')}
                >
                  {uah(row.p.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>

      <ReceiptDialog
        reception={receipt}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
      <SettleDialog supplierId={id} open={settle} onOpenChange={setSettle} />
    </div>
  )
}
