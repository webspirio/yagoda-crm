import * as React from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Grid2x2,
  HandCoins,
  Minus,
  Package,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScaleTerminal } from '@/components/reception/ScaleTerminal'
import { SupplierPicker } from '@/components/reception/SupplierPicker'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { NumPad } from '@/components/reception/NumPad'
import { SettleDialog } from '@/components/debts/SettleDialog'
import { Eyebrow, EmptyState } from '@/components/common/bits'
import { useStore } from '@/lib/store'
import { openDebts, reconcileDay, round2, supplierBalance, weigh } from '@/lib/calc'
import { kg, longDate, num, shortDate, tonnage, uah, uahAuto } from '@/lib/format'
import { OPERATORS, TODAY } from '@/lib/seed'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Reception, TareLine } from '@/lib/types'

export function ReceptionPage() {
  const store = useStore()
  const {
    berries,
    tareTypes,
    suppliers,
    receptions,
    payouts,
    activePointId,
    points,
    priceFor,
    addReception,
    go,
  } = store

  const pointId = activePointId === 'all' ? 'p1' : activePointId
  const point = points.find((p) => p.id === pointId)!

  const [supplierId, setSupplierId] = React.useState<string>()
  const [berryId, setBerryId] = React.useState<string>()
  const [gross, setGross] = React.useState('')
  const [tare, setTare] = React.useState<TareLine[]>([{ tareId: 't1', count: 0 }])
  const [paidInput, setPaidInput] = React.useState('')
  const [paidTouched, setPaidTouched] = React.useState(false)
  const [padOpen, setPadOpen] = React.useState(true)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)
  const [settleFor, setSettleFor] = React.useState<string | null>(null)

  const supplier = suppliers.find((s) => s.id === supplierId)

  const availableBerries = React.useMemo(
    () =>
      berries
        .map((b) => ({ berry: b, price: priceFor(TODAY, pointId, b.id) }))
        .filter((x) => x.price !== undefined),
    [berries, pointId, priceFor],
  )

  React.useEffect(() => {
    if (!berryId && availableBerries.length) setBerryId(availableBerries[0].berry.id)
  }, [availableBerries, berryId])

  const price = berryId ? (priceFor(TODAY, pointId, berryId) ?? 0) : 0
  const bonus = supplier?.bonus ?? 0
  const grossNum = Number(gross.replace(',', '.')) || 0

  const result = weigh({ gross: grossNum, tare, price, bonus }, tareTypes)

  React.useEffect(() => {
    if (!paidTouched) setPaidInput(result.amount > 0 ? String(result.amount) : '')
  }, [result.amount, paidTouched])

  const paid = Math.max(0, Math.min(result.amount, Number(paidInput.replace(',', '.')) || 0))
  const debt = round2(result.amount - paid)

  const balance = supplier ? supplierBalance(supplier.id, receptions, payouts) : 0
  const supplierOpen = supplier ? openDebts(supplier.id, receptions, payouts) : []

  const ready = Boolean(supplierId && berryId && result.net > 0)

  const todayReceptions = receptions
    .filter((r) => r.date === TODAY && r.pointId === pointId)
    .sort((a, b) => b.time.localeCompare(a.time))
  const day = reconcileDay(
    TODAY,
    receptions.filter((r) => r.pointId === pointId),
    payouts.filter((p) => p.pointId === pointId),
  )

  function reset() {
    setSupplierId(undefined)
    setGross('')
    setTare([{ tareId: 't1', count: 0 }])
    setPaidInput('')
    setPaidTouched(false)
  }

  function save() {
    if (!supplierId || !berryId) {
      toast.error('Оберіть постачальника і сорт')
      return
    }
    if (result.net <= 0) {
      toast.error('Введіть брутто більше за тару')
      return
    }
    const created = addReception({
      date: TODAY,
      pointId,
      supplierId,
      berryId,
      gross: result.gross,
      tare: tare.filter((t) => t.count > 0),
      tareWeight: result.tareWeight,
      net: result.net,
      price,
      bonus,
      amount: result.amount,
      paid,
      operator: OPERATORS[pointId] ?? point.name,
    })
    setReceipt(created)
    toast.success(`Прийнято ${kg(result.net)} — ${uah(result.amount)}`, {
      description: debt > 0 ? `Залишок за нами: ${uah(debt)}` : 'Розраховано повністю',
    })
    reset()
  }

  const tareTypeName = tareTypes.find((t) => t.id === tare[0]?.tareId)?.name ?? ''

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <Eyebrow className="mb-1.5">
            {point.name} · {point.village} · {longDate(TODAY)}
          </Eyebrow>
          <h1 className="font-display text-2xl leading-tight font-medium">Прийомка ягоди</h1>
        </div>
        <div className="flex items-center gap-2">
          {activePointId === 'all' ? (
            <span className="rounded-lg bg-[var(--amber)]/12 px-2.5 py-1.5 text-xs text-[var(--amber)]">
              Пробиваємо на точці «{point.name}» — змінити можна в шапці
            </span>
          ) : null}
          <Button variant="outline" onClick={() => go({ name: 'prices' })}>
            Ціни дня
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="secondary" onClick={() => go({ name: 'day' })}>
            Каса за день
          </Button>
        </div>
      </div>

      {availableBerries.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="size-6" />}
          title="На сьогодні ще не виставлені ціни"
          hint="Поки ціна дня не встановлена, прийомка заблокована — щоб ніхто не порахував по вчорашній."
          action={
            <Button className="mt-2" onClick={() => go({ name: 'prices' })}>
              Встановити ціни
            </Button>
          }
        />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
          {/* ------------- left: terminal + form ------------- */}
          <div className="flex flex-col gap-5">
            <ScaleTerminal
              berryName={berries.find((b) => b.id === berryId)?.name}
              gross={result.gross}
              tareWeight={result.tareWeight}
              tareUnits={result.tareUnits}
              tareLabel={tareTypeName}
              net={result.net}
              price={price}
              bonus={bonus}
              amount={result.amount}
              ready={ready}
            />

            <div className="rounded-xl bg-card ring-1 ring-foreground/10">
              {/* supplier */}
              <div className="border-b border-border/70 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Eyebrow>1 · Постачальник</Eyebrow>
                  {supplier ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {supplier.phone}
                    </span>
                  ) : null}
                </div>
                <SupplierPicker value={supplierId} onChange={setSupplierId} pointId={pointId} />

                {supplier && balance > 0.009 ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-sm">
                    <HandCoins className="size-4 shrink-0 text-[var(--amber)]" />
                    <span>
                      Залишок за нами <b className="font-mono">{uahAuto(balance)}</b>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      з {[...new Set(supplierOpen.map((o) => shortDate(o.reception.date)))].join(', ')}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => setSettleFor(supplier.id)}
                    >
                      Видати зараз
                    </Button>
                  </div>
                ) : null}
              </div>

              {/* berry */}
              <div className="border-b border-border/70 p-4">
                <Eyebrow className="mb-2">2 · Сорт і ціна дня</Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {availableBerries.map(({ berry, price: p }) => {
                    const active = berryId === berry.id
                    return (
                      <button
                        key={berry.id}
                        onClick={() => setBerryId(berry.id)}
                        className={cn(
                          'flex min-w-[128px] flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                          active
                            ? 'border-primary bg-primary/8 ring-1 ring-primary'
                            : 'border-border bg-background hover:bg-muted',
                        )}
                      >
                        <span className="text-sm font-medium">{berry.name}</span>
                        <span
                          className={cn(
                            'font-mono text-xs',
                            active ? 'text-primary' : 'text-muted-foreground',
                          )}
                        >
                          {num(p!)} ₴/кг
                          {bonus ? ` +${num(bonus)}` : ''}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* weight */}
              <div className="border-b border-border/70 p-4">
                <Eyebrow className="mb-2">3 · Вага</Eyebrow>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="flex flex-col gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="gross" className="text-xs text-muted-foreground">
                        Брутто — ягода разом із тарою
                      </Label>
                      <div className="relative">
                        <Input
                          id="gross"
                          value={gross}
                          onChange={(e) => setGross(e.target.value.replace(',', '.'))}
                          inputMode="decimal"
                          placeholder="0.00"
                          className="h-14 pr-12 font-mono text-2xl font-semibold"
                        />
                        <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                          кг
                        </span>
                      </div>
                    </div>

                    <div className="grid gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Тара — знімається автоматично
                      </Label>
                      {tare.map((line, idx) => {
                        const t = tareTypes.find((x) => x.id === line.tareId)
                        return (
                          <div key={idx} className="flex items-center gap-2">
                            <Select
                              value={line.tareId}
                              onValueChange={(v) =>
                                setTare((prev) =>
                                  prev.map((l, i) => (i === idx ? { ...l, tareId: v } : l)),
                                )
                              }
                            >
                              <SelectTrigger className="h-10 flex-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {tareTypes.map((t) => (
                                  <SelectItem key={t.id} value={t.id}>
                                    {t.name}
                                    <span className="ml-1.5 font-mono text-muted-foreground">
                                      {num(t.weight, 2)} кг
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  setTare((prev) =>
                                    prev.map((l, i) =>
                                      i === idx ? { ...l, count: Math.max(0, l.count - 1) } : l,
                                    ),
                                  )
                                }
                              >
                                <Minus className="size-3.5" />
                              </Button>
                              <input
                                value={line.count}
                                onChange={(e) => {
                                  const v = Math.max(0, Number(e.target.value) || 0)
                                  setTare((prev) =>
                                    prev.map((l, i) => (i === idx ? { ...l, count: v } : l)),
                                  )
                                }}
                                inputMode="numeric"
                                className="w-11 bg-transparent text-center font-mono text-base font-semibold outline-none"
                              />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                  setTare((prev) =>
                                    prev.map((l, i) =>
                                      i === idx ? { ...l, count: l.count + 1 } : l,
                                    ),
                                  )
                                }
                              >
                                <Plus className="size-3.5" />
                              </Button>
                            </div>
                            <span className="w-20 text-right font-mono text-xs text-muted-foreground">
                              {num((t?.weight ?? 0) * line.count, 2)} кг
                            </span>
                            {tare.length > 1 ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => setTare((prev) => prev.filter((_, i) => i !== idx))}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        )
                      })}
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {[5, 10, 20].map((n) => (
                          <Button
                            key={n}
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setTare((prev) =>
                                prev.map((l, i) => (i === 0 ? { ...l, count: l.count + n } : l)),
                              )
                            }
                          >
                            +{n} ящ.
                          </Button>
                        ))}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setTare((prev) => [...prev, { tareId: 't3', count: 0 }])
                          }
                        >
                          <Package className="size-3.5" />
                          Інша тара
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="w-full sm:w-[172px]">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mb-1.5 w-full justify-start text-muted-foreground"
                      onClick={() => setPadOpen((v) => !v)}
                    >
                      <Grid2x2 className="size-3.5" />
                      {padOpen ? 'Сховати клавіатуру' : 'Клавіатура'}
                    </Button>
                    {padOpen ? <NumPad value={gross} onChange={setGross} /> : null}
                  </div>
                </div>
              </div>

              {/* payout */}
              <div className="p-4">
                <Eyebrow className="mb-2">4 · Розрахунок</Eyebrow>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="paid" className="text-xs text-muted-foreground">
                      Видано готівкою
                    </Label>
                    <div className="relative">
                      <Input
                        id="paid"
                        value={paidInput}
                        onChange={(e) => {
                          setPaidTouched(true)
                          setPaidInput(e.target.value.replace(',', '.'))
                        }}
                        inputMode="decimal"
                        placeholder="0"
                        className="h-12 pr-9 font-mono text-xl font-semibold"
                      />
                      <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                        ₴
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPaidTouched(true)
                          setPaidInput(String(result.amount))
                        }}
                      >
                        Уся сума
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPaidTouched(true)
                          setPaidInput(String(Math.floor(result.amount / 100) * 100))
                        }}
                      >
                        До сотні
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setPaidTouched(true)
                          setPaidInput('0')
                        }}
                      >
                        Усе в залишок
                      </Button>
                    </div>
                  </div>

                  <div
                    className={cn(
                      'flex flex-col justify-center rounded-lg px-4 py-3',
                      debt > 0.009 ? 'bg-[var(--amber)]/10' : 'bg-[var(--leaf)]/10',
                    )}
                  >
                    <Eyebrow>{debt > 0.009 ? 'Залишок за нами' : 'Розраховано повністю'}</Eyebrow>
                    <div
                      className={cn(
                        'mt-1 font-mono text-3xl font-semibold',
                        debt > 0.009 ? 'text-[var(--amber)]' : 'text-[var(--leaf)]',
                      )}
                    >
                      {debt > 0.009 ? uah(debt, { decimals: 2 }) : uah(0)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {debt > 0.009
                        ? 'Пристане до картки постачальника з датою сьогодні'
                        : 'Нічого не зависає на балансі'}
                    </div>
                  </div>
                </div>

                <Button
                  className="mt-4 h-14 w-full text-base"
                  disabled={!ready}
                  onClick={save}
                >
                  <Check className="size-5" />
                  {ready
                    ? `Прийняти ${num(result.net, 2)} кг · ${uah(result.amount)}`
                    : 'Прийняти'}
                </Button>
              </div>
            </div>
          </div>

          {/* ------------- right: day log ------------- */}
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <MiniStat label="Прийнято сьогодні" value={tonnage(day.netKg)} />
              <MiniStat label="Квитанцій" value={String(day.receptionCount)} />
              <MiniStat label="Видано з каси" value={uah(day.cashOut)} />
              <MiniStat
                label="Залишків створено"
                value={uah(day.newDebt)}
                tone={day.newDebt > 0 ? 'amber' : 'default'}
              />
            </div>

            <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <Eyebrow>Сьогоднішні квитанції</Eyebrow>
                <Badge variant="secondary" className="font-mono">
                  {todayReceptions.length}
                </Badge>
              </div>
              <div className="max-h-[560px] overflow-y-auto">
                {todayReceptions.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Ще нічого не прийнято. Перша квитанція зʼявиться тут.
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {todayReceptions.map((r) => {
                      const s = suppliers.find((x) => x.id === r.supplierId)
                      const b = berries.find((x) => x.id === r.berryId)
                      return (
                        <li key={r.id}>
                          <button
                            onClick={() => setReceipt(r)}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                          >
                            <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                              {r.time}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {s?.name ?? '—'}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {b?.short} · {kg(r.net)}
                                {r.debt > 0 ? (
                                  <span className="text-[var(--amber)]">
                                    {' '}
                                    · залишок {uah(r.debt)}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-mono text-sm font-medium">
                                {uah(r.amount)}
                              </span>
                              {!r.synced ? (
                                <span className="block font-mono text-[10px] text-[var(--amber)]">
                                  у черзі
                                </span>
                              ) : null}
                            </span>
                            <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <ReceiptDialog
        reception={receipt}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
      <SettleDialog
        supplierId={settleFor}
        open={Boolean(settleFor)}
        onOpenChange={(v) => !v && setSettleFor(null)}
      />
    </div>
  )
}

function MiniStat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'amber'
}) {
  return (
    <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-foreground/10">
      <Eyebrow className="truncate">{label}</Eyebrow>
      <div
        className={cn(
          'mt-1.5 font-mono text-xl font-semibold',
          tone === 'amber' ? 'text-[var(--amber)]' : '',
        )}
      >
        {value}
      </div>
    </div>
  )
}
