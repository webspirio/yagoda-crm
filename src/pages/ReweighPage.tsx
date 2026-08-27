import * as React from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Minus, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { useStore } from '@/lib/store'
import {
  maskDecimalInput,
  ownerName,
  parseNumeric,
  productDay,
  reweighLineValid,
  round2,
  sum,
  tareWeight,
} from '@/lib/calc'
import { addDays, kg, num, shortDate, uahAuto } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ReweighLine, TareLine } from '@/lib/types'

/**
 * Пороги підозри — ті самі, що на прийомці, нових чисел ми не вводимо
 * (`03-scenarios-owner.md:899-900`): рекорд сезону — 701,5 кг брутто і 115 ящиків.
 * Це ПОПЕРЕДЖЕННЯ поруч із полем, не блок: керівник біля ваг бачить вагу краще за нас.
 */
const GROSS_SUSPECT_KG = 800
const TARE_SUSPECT_UNITS = 120

/** Позиція, яка живе в памʼяті СТОРІНКИ: документа ще немає (`D-5`). */
type Draft = Omit<ReweighLine, 'id' | 'order'> & { key: string }

/** Різниця зі знаком: надлишок мусить бути видно так само, як недостача. */
function signedKg(v: number) {
  return v > 0 ? `+${kg(v)}` : kg(v)
}

export function ReweighPage() {
  const role = useStore((s) => s.role)

  // Переважування — ВИКЛЮЧНО керівник: «тільки керівник має до цього всього доступ»
  // (дзвінок №4, ряд. 617–621; `13 §4 S-20`). Роль читається в цій обгортці, а сам екран
  // — окремий компонент нижче, тому решта хуків ніколи не стоїть під умовою.
  if (role !== 'owner') {
    return (
      <div className="mx-auto max-w-[1500px]">
        <PageHeader eyebrow="Керівництву" title="Переважування" />
        <p className="text-sm text-muted-foreground">Цей розділ доступний лише керівникові.</p>
      </div>
    )
  }
  return <ReweighScreen />
}

function ReweighScreen() {
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const tareTypes = useStore((s) => s.tareTypes)
  const receptions = useStore((s) => s.receptions)
  const reweighs = useStore((s) => s.reweighs)
  const workDate = useStore((s) => s.workDate)
  const users = useStore((s) => s.users)
  const config = useStore((s) => s.config)
  const addReweigh = useStore((s) => s.addReweigh)
  const voidReweigh = useStore((s) => s.voidReweigh)

  /** Звідки приїхала ягода — саме з цим пунктом порівнюємо вагу. */
  const fromPoints = React.useMemo(() => points.filter((p) => p.kind === 'reception'), [points])
  /** Де переважували. У демо база одна, тому селектор одразу стоїть на ній. */
  const basePoints = React.useMemo(() => points.filter((p) => p.kind === 'base'), [points])

  /**
   * ДАТА ЛОКАЛЬНА (`09 §5`): `setWorkDate` звідси не викликається ніколи. Керівник
   * розбирає вчорашній день, поки на пунктах іде сьогоднішня торгівля — глобальний
   * перемикач зіпсував би роботу приймальникам.
   */
  const [date, setDate] = React.useState(workDate)
  const [fromPointId, setFromPointId] = React.useState(fromPoints[0]?.id ?? '')
  const [atPointId, setAtPointId] = React.useState(basePoints[0]?.id ?? '')
  const [gross, setGross] = React.useState('')
  const [palletInput, setPalletInput] = React.useState('')
  const [tareId, setTareId] = React.useState(config.crateTareId)
  const [tareCount, setTareCount] = React.useState(0)
  const [berryId, setBerryId] = React.useState<string>()
  const [lines, setLines] = React.useState<Draft[]>([])
  const [voidingId, setVoidingId] = React.useState<string | null>(null)
  const [voidReason, setVoidReason] = React.useState('')

  const pointName = fromPoints.find((p) => p.id === fromPointId)?.name ?? '—'
  const tareLines: TareLine[] = [{ tareId, count: tareCount }]
  // та сама функція, що на прийомці: два екрани не мають права розійтися в тарі
  const tw = tareWeight(tareLines, tareTypes)
  const grossNum = parseNumeric(gross)
  const palletNum = parseNumeric(palletInput)
  /** `09 §7`: «Чиста вага» — похідна, полем вводу вона не є НІКОМУ. */
  const netKg = round2(Math.max(0, grossNum - palletNum - tw))

  const pointRows = React.useMemo(
    () => productDay(date, fromPointId, receptions, berries),
    [date, fromPointId, receptions, berries],
  )
  const dayProducts = React.useMemo(() => pointRows.map((r) => r.product), [pointRows])

  /**
   * `I49`, місце 1: у селекторі — ЛИШЕ сорти товарів, які того дня на цьому пункті
   * приймали. Порядок груп — від найважчого товару, як їх віддає `productDay()`.
   */
  const berryGroups = React.useMemo(
    () =>
      dayProducts
        .map((product) => {
          const all = berries.filter((b) => b.product === product)
          const live = all.filter((b) => !b.retired)
          // виведений з обігу сорт не пропонуємо — але якщо живих у товару не лишилось,
          // показуємо всі: інакше товар, який того дня приймали, ввести нічим
          return { product, items: live.length ? live : all }
        })
        .filter((g) => g.items.length > 0),
    [dayProducts, berries],
  )

  const chosen = berries.find((b) => b.id === berryId)
  const productOk = chosen ? reweighLineValid(chosen.product, dayProducts) : false

  const grossHint =
    grossNum > GROSS_SUSPECT_KG
      ? `${num(grossNum, 2)} кг — понад ${GROSS_SUSPECT_KG} кг. Найважчий рядок сезону — 701,5 кг. Перевірте вагу.`
      : ''
  const tareHint =
    tareCount > TARE_SUSPECT_UNITS
      ? `${tareCount} ящиків — понад ${TARE_SUSPECT_UNITS}. Найбільший рядок сезону — 115. Перевірте кількість.`
      : tareCount === 0 && grossNum > 0
        ? 'Тару не додано — вага з ягодою пішла б у чисту вагу цілком.'
        : ''

  /** Чому «+ ще позиція» неактивна. Порожній рядок = активна. */
  const addBlock = !berryGroups.length
    ? `На ${pointName} ${shortDate(date)} нічого не приймали. Перевірте пункт і дату`
    : !chosen
      ? 'Оберіть сорт — без нього позиція в документ не піде'
      : !productOk
        ? `Товар «${chosen.product}» на ${pointName} ${shortDate(date)} не приймали. Перевірте пункт і дату`
        : grossNum <= 0
          ? 'Введіть вагу з ягодою'
          : netKg <= 0
            ? 'Чиста вага виходить нульова: піддон і тара зʼїдають усю вагу з ягодою'
            : ''

  function resetDraft() {
    setGross('')
    setPalletInput('')
    setTareCount(0)
    setBerryId(undefined)
  }

  /** Позиції належать парі (день, пункт): змінили будь-що з двох — вони вже не про це. */
  function clearForContext() {
    resetDraft()
    if (lines.length) {
      setLines([])
      toast.info('Позиції очищено — вони належали іншому дню або пункту')
    }
  }

  function addLine() {
    if (!chosen || addBlock) {
      toast.error(addBlock || 'Оберіть сорт')
      return
    }
    setLines((prev) => [
      ...prev,
      {
        key: `rwl_${Math.random().toString(36).slice(2, 8)}`,
        berryId: chosen.id,
        // рівень звітності — ТОВАР: недостача рахується по ньому, не по сорту (`I49`)
        product: chosen.product,
        grossKg: round2(grossNum),
        palletKg: round2(palletNum),
        tare: tareCount > 0 ? [{ tareId, count: tareCount }] : [],
        tareWeightKg: tw,
        tareUnits: tareCount,
        netKg,
      },
    ])
    resetDraft()
  }

  /**
   * ЗВІРКА З ПУНКТОМ — до проведення, поки вагу ще можна перевірити на вагах.
   * Порівняння по ТОВАРУ (`I49`): якщо в дорозі Малина 1 «поїхала» в Малину 3, посортове
   * порівняння показало б недостачу там, де фізичної втрати немає.
   */
  const check = React.useMemo(() => {
    // «Наша» — те саме, що бачить зведення дня: усі НЕсторновані документи цього дня по
    // цьому пункту (`I54` — сторноване не рахується) плюс позиції, введені на екрані
    const ours = new Map<string, number>()
    for (const rw of reweighs) {
      if (rw.berryDate !== date || rw.fromPointId !== fromPointId) continue
      if (rw.status === 'voided') continue
      for (const l of rw.lines) ours.set(l.product, (ours.get(l.product) ?? 0) + l.netKg)
    }
    for (const l of lines) ours.set(l.product, (ours.get(l.product) ?? 0) + l.netKg)

    const products = [...new Set([...dayProducts, ...lines.map((l) => l.product)])]
    return products.map((product) => {
      const row = pointRows.find((r) => r.product === product)
      const kgPoint = row?.kgPoint ?? 0
      // ставка пункту НЕокруглена: округлена ламала б звірку на kgPoint × похибку.
      // Тут вона жива, з квитанцій; у зведеному дні її замінює ЗНІМОК, і розбіжність
      // між ними Н8 покаже попередженням (`I55`), а не мовчки
      const avgPoint = row?.avgPoint ?? 0
      const ourKg = round2(ours.get(product) ?? 0)
      const shortKg = round2(ourKg - kgPoint)
      return {
        product,
        kgPoint,
        ourKg,
        shortKg,
        shortUah: round2(shortKg * avgPoint),
        weighed: ourKg > 0.004,
        // товар, якого в прийомці того дня не було: захист від пункту або дати навмання
        foreign: row === undefined,
      }
    })
  }, [date, fromPointId, pointRows, dayProducts, reweighs, lines])

  const shortfallKg = round2(-sum(check, (c) => c.shortKg))
  const shortfallUah = round2(-sum(check, (c) => c.shortUah))
  const totalNet = sum(lines, (l) => l.netKg)
  const notWeighed = check.filter((c) => !c.weighed).length

  const dayDocs = reweighs
    .filter((r) => r.berryDate === date)
    .sort((a, b) => a.weighedTime.localeCompare(b.weighedTime))

  function post() {
    if (!lines.length || !atPointId) return
    addReweigh({
      berryDate: date,
      fromPointId,
      atPointId,
      operator: ownerName(users),
      lines: lines.map((l) => ({
        berryId: l.berryId,
        product: l.product,
        grossKg: l.grossKg,
        palletKg: l.palletKg,
        tare: l.tare,
        tareWeightKg: l.tareWeightKg,
        tareUnits: l.tareUnits,
        netKg: l.netKg,
      })),
    })
    toast.success(`Переважування проведено · ${kg(totalNet)}`, {
      description:
        shortfallKg > 0.004
          ? `${pointName} · ягода за ${shortDate(date)} — недостача ${kg(shortfallKg)}`
          : `${pointName} · ягода за ${shortDate(date)}`,
    })
    setLines([])
    resetDraft()
  }

  function confirmVoid(id: string) {
    if (!voidReason.trim()) return
    voidReweigh(id, voidReason.trim(), ownerName(users))
    setVoidingId(null)
    setVoidReason('')
    toast.success('Переважування сторновано', {
      description: 'Документ лишився в списку зі слідом. Зведення дня перерахується.',
    })
  }

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader
        eyebrow="Керівництву · робота на вагах"
        title="Переважування"
        description="Ягода приїхала з пункту на базу: переважуємо і бачимо недостачу до того, як машину розвантажили. Аркуш звідси не друкується — це екран біля ваг, а не папір."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">База</span>
            <Select value={atPointId} onValueChange={setAtPointId}>
              <SelectTrigger className="h-8 w-[132px]">
                <SelectValue placeholder="немає складу" />
              </SelectTrigger>
              <SelectContent>
                {basePoints.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xs text-muted-foreground">ягода за</span>
            <div className="flex items-center rounded-lg border border-border bg-card">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-r-none"
                disabled={date <= config.seasonStart}
                onClick={() => {
                  setDate(addDays(date, -1))
                  clearForContext()
                }}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Input
                type="date"
                aria-label="День ягоди"
                title="День ЯГОДИ, не день заїзду машини"
                value={date}
                min={config.seasonStart}
                max={config.businessToday}
                onChange={(e) => {
                  const d = e.target.value
                  // порожнє поле і дата поза сезоном не приймаються: календар межі тримає,
                  // а набрана руками дата — ні
                  if (d >= config.seasonStart && d <= config.businessToday) {
                    setDate(d)
                    clearForContext()
                  }
                }}
                className="h-7 w-[124px] rounded-none border-0 bg-transparent px-1.5 text-center font-mono text-xs shadow-none focus-visible:ring-0"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-l-none"
                disabled={date >= config.businessToday}
                onClick={() => {
                  setDate(addDays(date, 1))
                  clearForContext()
                }}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {date !== config.businessToday ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDate(config.businessToday)
                  clearForContext()
                }}
              >
                Сьогодні
              </Button>
            ) : null}

            <span className="text-xs text-muted-foreground">з пункту</span>
            <Select
              value={fromPointId}
              onValueChange={(v) => {
                setFromPointId(v)
                clearForContext()
              }}
            >
              <SelectTrigger className="h-8 w-[156px]">
                <SelectValue placeholder="Пункт" />
              </SelectTrigger>
              <SelectContent>
                {fromPoints.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.active ? null : (
                      <span className="ml-1.5 text-muted-foreground">закритий</span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />

      <p className="mb-5 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Дата тут — це день <b className="font-medium text-foreground">ягоди</b>, а не день
        заїзду машини: партія за {shortDate(date)}, переважена наступного ранку, усе одно
        належить {shortDate(date)}. Перемикач дати локальний — на пунктах робочий день від
        нього не зсувається.
      </p>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,1fr)]">
        {/* ---------- ліва колонка: форма позиції і стрічка ---------- */}
        <div className="flex flex-col gap-5">
          {/* Порядок полів — ДОСЛІВНО за клієнтом (`S-13`): вага з ягодою → піддон →
              кількість ящиків → сорт → «ще позиція» → стрічка. Іншого порядку тут немає. */}
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="border-b border-border/70 p-4">
              <Eyebrow className="mb-2">1 · Вага з ягодою і піддон</Eyebrow>
              <div className="flex flex-wrap items-start gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="rw-gross" className="text-xs text-muted-foreground">
                    Вага з ягодою
                  </Label>
                  <div className="relative w-[200px]">
                    <Input
                      id="rw-gross"
                      value={gross.replace('.', ',')}
                      onChange={(e) => setGross(maskDecimalInput(e.target.value))}
                      inputMode="decimal"
                      placeholder="0,00"
                      className="h-14 pr-12 font-mono text-2xl font-semibold"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 font-mono text-sm text-muted-foreground">
                      кг
                    </span>
                  </div>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rw-pallet" className="text-xs text-muted-foreground">
                    Піддон
                  </Label>
                  <div className="relative w-[132px]">
                    <Input
                      id="rw-pallet"
                      value={palletInput.replace('.', ',')}
                      onChange={(e) => setPalletInput(maskDecimalInput(e.target.value))}
                      inputMode="decimal"
                      placeholder="0,0"
                      className="h-14 pr-9 font-mono text-lg font-semibold"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                      кг
                    </span>
                  </div>
                </div>
              </div>
              {grossHint ? <FieldWarning text={grossHint} /> : null}
            </div>

            <div className="border-b border-border/70 p-4">
              <Eyebrow className="mb-2">2 · Кількість ящиків</Eyebrow>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={tareId} onValueChange={setTareId}>
                  <SelectTrigger className="h-10 w-[168px]">
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
                    onClick={() => setTareCount((c) => Math.max(0, c - 1))}
                  >
                    <Minus className="size-3.5" />
                  </Button>
                  <input
                    value={tareCount}
                    onChange={(e) => setTareCount(Math.max(0, Number(e.target.value) || 0))}
                    inputMode="numeric"
                    aria-label="Кількість ящиків"
                    className="w-12 bg-transparent text-center font-mono text-base font-semibold outline-none"
                  />
                  <Button variant="ghost" size="icon-sm" onClick={() => setTareCount((c) => c + 1)}>
                    <Plus className="size-3.5" />
                  </Button>
                </div>
                <span className="font-mono text-sm text-muted-foreground">= {kg(tw)}</span>
                {[5, 10, 20].map((n) => (
                  <Button
                    key={n}
                    variant="outline"
                    size="sm"
                    onClick={() => setTareCount((c) => c + n)}
                  >
                    +{n} ящ.
                  </Button>
                ))}
              </div>
              {tareHint ? <FieldWarning text={tareHint} /> : null}
            </div>

            <div className="border-b border-border/70 p-4">
              <Eyebrow className="mb-2">3 · Сорт</Eyebrow>
              <Select
                value={berryId ?? ''}
                onValueChange={setBerryId}
                disabled={!berryGroups.length}
              >
                <SelectTrigger className="h-10 w-full max-w-[320px]">
                  <SelectValue
                    placeholder={
                      berryGroups.length ? 'Оберіть сорт' : 'Того дня тут нічого не приймали'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {berryGroups.map((g) => (
                    <SelectGroup key={g.product}>
                      <SelectLabel>{g.product}</SelectLabel>
                      {g.items.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                У списку — лише сорти товарів, які того дня приймали на {pointName}:{' '}
                {dayProducts.join(', ') || '—'}. Сорт зберігається, але звіряємо по товару:
                пересортиця в дорозі — не втрата.
              </p>
            </div>

            <div className="flex flex-wrap items-end justify-between gap-3 p-4">
              <div>
                <Eyebrow className="mb-1">Чиста вага · рахує система</Eyebrow>
                <div className="font-mono text-[34px] leading-none font-semibold tracking-tight text-primary">
                  {kg(netKg)}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Вага з ягодою − піддон − тара. Полем вводу вона не є нікому.
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <Button size="lg" onClick={addLine} disabled={Boolean(addBlock)}>
                  <Plus className="size-4" />
                  ще позиція
                </Button>
                {addBlock ? (
                  <span className="max-w-[300px] text-right text-xs text-[var(--amber)]">
                    {addBlock}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          {/* ---------- стрічка введених позицій ---------- */}
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
              <Eyebrow>Введені позиції</Eyebrow>
              <span className="text-xs text-muted-foreground">
                (у памʼяті сторінки — документа ще немає)
              </span>
            </div>
            {lines.length ? (
              <ul className="divide-y divide-border/60">
                {lines.map((l) => (
                  <li
                    key={l.key}
                    className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 text-sm"
                  >
                    <span className="text-muted-foreground">▪</span>
                    <span className="font-medium">
                      {berries.find((b) => b.id === l.berryId)?.name ?? l.product}
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {num(l.grossKg, 2)} брутто
                    </span>
                    {l.tareUnits > 0 ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        {l.tareUnits} ×{' '}
                        {tareTypes.find((t) => t.id === l.tare[0]?.tareId)?.name ?? 'тара'}
                      </span>
                    ) : null}
                    {l.palletKg > 0 ? (
                      <span className="font-mono text-xs text-muted-foreground">
                        піддон {num(l.palletKg, 1)}
                      </span>
                    ) : null}
                    <span className="ml-auto font-mono font-semibold">{kg(l.netKg)}</span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Прибрати позицію"
                      onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </li>
                ))}
                <li className="flex items-baseline justify-between px-4 py-2.5 text-sm">
                  <span className="text-muted-foreground">Разом наша вага</span>
                  <span className="font-mono font-semibold">{kg(totalNet)}</span>
                </li>
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Позицій ще немає. Перезавантаження сторінки їх не збереже — документа поки не
                існує, і напівдокументів у базі теж.
              </p>
            )}
          </div>
        </div>

        {/* ---------- права колонка: звірка і проведення ---------- */}
        <div className="flex flex-col gap-5">
          <div className="rounded-xl bg-card ring-1 ring-foreground/10">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
              <Eyebrow>Звірка з пунктом</Eyebrow>
              <span className="text-xs text-muted-foreground">по товару, не по сорту</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Товар</TableHead>
                  <TableHead className="text-right">Пункт</TableHead>
                  <TableHead className="text-right">Наша</TableHead>
                  <TableHead className="text-right">Різниця</TableHead>
                  <TableHead className="text-right">У грошах</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {check.map((c) => (
                  <TableRow
                    key={c.product}
                    className={c.weighed ? undefined : 'bg-[var(--amber)]/8'}
                  >
                    <TableCell className="font-medium">
                      {c.product}
                      {c.foreign ? (
                        <span className="ml-1.5 text-xs text-destructive">немає в прийомці</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {kg(c.kgPoint)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {c.weighed ? (
                        kg(c.ourKg)
                      ) : (
                        <span className="text-[var(--amber)]">не перезважено ⚠</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono tabular-nums',
                        c.shortKg < -0.004 && 'text-destructive',
                      )}
                    >
                      {c.weighed ? signedKg(c.shortKg) : '—'}
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono tabular-nums',
                        c.shortUah < -0.004 && 'text-destructive',
                      )}
                    >
                      {c.weighed ? uahAuto(c.shortUah) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
                {check.length ? null : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">
                      Того дня на {pointName} нічого не приймали — порівнювати ні з чим.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <div className="border-t border-border/70 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {shortfallKg < -0.004 ? 'Надлишок разом' : 'Недостача разом'}
                </span>
                <span
                  className={cn(
                    'font-mono font-semibold',
                    shortfallKg > 0.004 && 'text-destructive',
                  )}
                >
                  {kg(Math.abs(shortfallKg))} · {uahAuto(Math.abs(shortfallUah))}
                </span>
              </div>
              {notWeighed > 0 ? (
                <p className="mt-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--amber)]">
                  Товарів без позиції: {notWeighed}. Це захист від «забули зважити порічку», а
                  не помилка — але поки ⚠ стоїть, недостача по цьому товару рахується на всю
                  вагу пункту.
                </p>
              ) : null}
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                «Наша» — це проведені документи цього дня по цьому пункту плюс введені позиції:
                рівно те, що побачить зведення дня. Гроші — недостача × середня ставка пункту;
                чека постачальника вони не торкаються, людині заплатили за вагу пункту.
              </p>
            </div>
          </div>

          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
            <Button
              size="lg"
              className="w-full"
              onClick={post}
              disabled={!lines.length || !atPointId}
            >
              Провести переважування · {kg(totalNet)}
            </Button>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Документ народжується одразу проведеним і разом зі знімком прийомки: окремої дії
              «провести чернетку» немає.
              {atPointId ? '' : ' У довіднику немає складу — переважувати нема де.'}
            </p>
          </div>
        </div>
      </div>

      {/* ---------- проведені документи дня: єдина поверхня права «сторнувати» ---------- */}
      <div className="mt-5 rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-3">
          <Eyebrow>Проведені переважування за {shortDate(date)}</Eyebrow>
          <span className="text-xs text-muted-foreground">по всіх пунктах</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>З пункту</TableHead>
              <TableHead>Час</TableHead>
              <TableHead className="text-right">Наша вага</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {dayDocs.map((doc) => (
              <React.Fragment key={doc.id}>
                <TableRow className={doc.status === 'voided' ? 'text-muted-foreground' : undefined}>
                  <TableCell className="font-medium">
                    {points.find((p) => p.id === doc.fromPointId)?.name ?? doc.fromPointId}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{doc.weighedTime}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {kg(sum(doc.lines, (l) => l.netKg))}
                  </TableCell>
                  <TableCell>
                    {doc.status === 'voided' ? (
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge variant="outline">сторновано</Badge>
                        <span className="font-mono">{doc.voidedTime}</span>
                        <span>· {doc.voidedBy} ·</span>
                        <span className="italic">«{doc.voidReason}»</span>
                      </span>
                    ) : (
                      <Badge variant="secondary">проведено</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {doc.status === 'voided' ? null : (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setVoidingId(doc.id)
                          setVoidReason('')
                        }}
                      >
                        Сторнувати
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
                {voidingId === doc.id ? (
                  <TableRow className="bg-destructive/8 hover:bg-destructive/8">
                    <TableCell colSpan={5}>
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="grid min-w-[240px] flex-1 gap-1.5">
                          <Label
                            htmlFor={`rw-reason-${doc.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Причина — обовʼязкова
                          </Label>
                          <Input
                            id={`rw-reason-${doc.id}`}
                            autoFocus
                            value={voidReason}
                            onChange={(e) => setVoidReason(e.target.value)}
                            placeholder="напр. двічі ввели ту саму машину"
                            className="h-9"
                          />
                        </div>
                        <Button
                          variant="destructive"
                          onClick={() => confirmVoid(doc.id)}
                          disabled={!voidReason.trim()}
                        >
                          Сторнувати
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setVoidingId(null)
                            setVoidReason('')
                          }}
                        >
                          Скасувати
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : null}
              </React.Fragment>
            ))}
            {dayDocs.length ? null : (
              <TableRow>
                <TableCell colSpan={5} className="text-sm text-muted-foreground">
                  За цей день переважувань ще немає.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <p className="border-t border-border/70 px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Сторноване не рахується, але й не пропадає: документ лишається в списку з часом,
          автором і причиною. Сторно перераховує зведення дня — «Собівартість дня» покаже це
          попередженням, а не мовчки.
        </p>
      </div>
    </div>
  )
}

function FieldWarning({ text }: { text: string }) {
  return (
    <div className="mt-2 flex items-start gap-2 text-xs text-[var(--amber)]">
      <AlertTriangle className="mt-px size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}
