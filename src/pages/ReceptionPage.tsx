import * as React from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
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
import { Switch } from '@/components/ui/switch'
import { SupplierPicker } from '@/components/reception/SupplierPicker'
import { ReceiptDialog } from '@/components/reception/ReceiptDialog'
import { PointStatePanel } from '@/components/reception/PointStatePanel'
import { Eyebrow, EmptyState } from '@/components/common/bits'
import { useCashStanding, useStore } from '@/lib/store'
import {
  allocatePayout,
  checkBerryPayout,
  checkSurcharge,
  maskDecimalInput,
  openDebts,
  originDates,
  parseNumeric,
  reconcileDay,
  round2,
  sum,
  visitMath,
  weigh,
} from '@/lib/calc'
import { kg, longDate, num, plural, shortDate, tonnage, uah, uahAuto } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { VisitLineInput } from '@/lib/ports'
import type { Payout, Reception, TareLine } from '@/lib/types'

/** 284 з 1 369 візитів — багаторядкові, найдовший має 5 позицій ✓ PART C 15 */
const MAX_LINES = 5
/** Найбільший рядок сезону — 701,5 кг брутто ✓ PART A; вище цього питаємо, але не блокуємо */
const GROSS_HINT_KG = 750
/** Реальне навантаження Чешки — 3…12 кг; поза 2…14 це майже завжди помилка вводу ✓ H7 */
const PER_CRATE_MIN = 2
const PER_CRATE_MAX = 14

/** Позиція візиту: те саме, що йде в store.addVisit, плюс ключ і тара в штуках для показу */
interface DraftLine extends VisitLineInput {
  key: string
  tareUnits: number
}

export function ReceptionPage() {
  const store = useStore()
  const {
    berries,
    tareTypes,
    suppliers,
    receptions,
    payouts,
    prices,
    settings,
    config,
    activePointId,
    points,
    priceFor,
    addVisit,
    go,
  } = store

  const pointId = activePointId === 'all' ? 'p1' : activePointId
  const point = points.find((p) => p.id === pointId) ?? points[0]

  const [supplierId, setSupplierId] = React.useState<string>()
  const [berryId, setBerryId] = React.useState<string>()
  const [gross, setGross] = React.useState('')
  const [palletInput, setPalletInput] = React.useState('')
  const [palletOpen, setPalletOpen] = React.useState(false)
  const [tare, setTare] = React.useState<TareLine[]>([{ tareId: config.crateTareId, count: 0 }])
  const [bonusInput, setBonusInput] = React.useState('0')
  const [lines, setLines] = React.useState<DraftLine[]>([])
  // null = ще не торкались, тоді перемикач стоїть так, як просить M10: увімкнено, якщо є залишок
  const [includeOverride, setIncludeOverride] = React.useState<boolean | null>(null)
  const [paidInput, setPaidInput] = React.useState('')
  const [paidTouched, setPaidTouched] = React.useState(false)
  const [receipt, setReceipt] = React.useState<Reception | null>(null)
  const [receiptPayout, setReceiptPayout] = React.useState<Payout>()

  const supplier = suppliers.find((s) => s.id === supplierId)

  const availableBerries = React.useMemo(
    () =>
      berries
        // сорт, виведений з обігу, на прийомці не пробивається — але історичні
        // квитанції на нього лишаються валідними (рішення D-8, «Опт забрати просто вже»)
        .filter((b) => !b.retired)
        .map((b) => ({ berry: b, price: priceFor(config.businessToday, pointId, b.id) }))
        .filter((x) => x.price !== undefined),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `prices` не зайва: priceFor — метод стора, який читає get().prices всередині, тож саме цей ключ і перевираховує мемо після зміни ціни дня. Прибрати його — лишити на прийомці вчорашню ціну.
    [berries, config.businessToday, pointId, priceFor, prices],
  )

  /** Товар → сорти: два рівні на екрані, один плаский `Berry` у коді */
  const berryGroups = React.useMemo(() => {
    const groups: { product: string; items: typeof availableBerries }[] = []
    for (const item of availableBerries) {
      const group = groups.find((g) => g.product === item.berry.product)
      if (group) group.items.push(item)
      else groups.push({ product: item.berry.product, items: [item] })
    }
    return groups
  }, [availableBerries])

  React.useEffect(() => {
    // сорт підставляється сам тільки для першої позиції — далі його обирають свідомо
    if (!berryId && !lines.length && availableBerries.length) {
      setBerryId(availableBerries[0].berry.id)
    }
  }, [availableBerries, berryId, lines.length])

  const price = berryId ? (priceFor(config.businessToday, pointId, berryId) ?? 0) : 0
  const bonusNum = parseNumeric(bonusInput)
  const surcharge = checkSurcharge(bonusNum, settings)
  // понад межу значення НЕ обрізається тихо: позиція йде без надбавки, а різниця — керівнику (M7)
  const bonus = surcharge.ok ? bonusNum : 0
  const grossNum = parseNumeric(gross)
  const palletNum = parseNumeric(palletInput)

  const result = weigh({ gross: grossNum, pallet: palletNum, tare, price, bonus }, tareTypes)

  const draft: DraftLine | null =
    berryId && result.net > 0
      ? {
          key: 'draft',
          berryId,
          gross: result.gross,
          pallet: result.pallet,
          tare: tare.filter((t) => t.count > 0),
          tareWeight: result.tareWeight,
          tareUnits: result.tareUnits,
          net: result.net,
          price,
          bonus,
          amount: result.amount,
        }
      : null

  // позиція, яку саме вводять, рахується в «Разом» одразу — інакше 79 % однорядкових
  // візитів отримали б зайвий клік «додати позицію» ні за що
  const allLines = draft ? [...lines, draft] : lines
  const netTotal = sum(allLines, (l) => l.net)

  // книга кожного пункту своя — у їхньому світі це буквально окрема таблиця, — тому
  // «Попередній залишок» і FIFO беруться по прийомках ЦЬОГО пункту. Інакше видача тут
  // гасила б ягоду, прийняту на іншому пункті, і жоден денний звіт не зійшовся б.
  const pointReceptions = React.useMemo(
    () => receptions.filter((r) => r.pointId === pointId),
    [receptions, pointId],
  )
  const supplierOpen = supplier ? openDebts(supplier.id, pointReceptions, payouts) : []
  const balance = sum(supplierOpen, (o) => o.open)
  const openDates = [...new Set(supplierOpen.map((o) => shortDate(o.reception.date)))]
  const openDatesText = openDates.join(', ')
  /** У постачальника на 47 квитанцій буває 15 відкритих дат — називаємо найстаріші, решту рахуємо */
  const openDatesShort =
    openDates.length > 4
      ? `${openDates.slice(0, 3).join(', ')} і ще ${openDates.length - 3}`
      : openDatesText
  const includeBalance = includeOverride ?? balance > 0.009

  const math = visitMath({
    lineAmounts: allLines.map((l) => l.amount),
    balance,
    includeBalance,
    paidInput: parseNumeric(paidInput),
  })

  // G12/I58: у касі за ЯГОДУ лежить стільки, скільки лежить. Це не сума шухляди —
  // завдатки за ящики чужі (21 §3.5), і виплата за ягоду їх не чіпає.
  const berryCash = useCashStanding(pointId, config.businessToday).berryCash

  React.useEffect(() => {
    // «Видано готівкою» за замовчуванням — уся сума РАЗОМ, як вона й видається найчастіше.
    // АЛЕ не більше, ніж є в касі за ягоду: `G12` — це block у сторі, і підставляти в поле
    // число, яке гарантовано впреться в нього, означало б вести людину в глухий кут.
    // Різниця не зникає — вона лягає в ЗАЛИШОК, і саме для цього залишки й існують.
    if (!paidTouched) {
      const suggested = Math.min(math.total, Math.max(0, berryCash))
      setPaidInput(suggested > 0 ? String(suggested) : '')
    }
  }, [math.total, paidTouched, berryCash])

  // які саме залишки закриє надлишок — той самий FIFO, що потім зробить addPayout,
  // тому на екрані стоять рівно ті дати, які спишуться, а не всі відкриті
  const willCloseDates =
    math.paidToPast > 0.009
      ? originDates(allocatePayout(math.paidToPast, supplierOpen)).map(shortDate).join(', ')
      : ''

  const tareUnits = result.tareUnits
  const perCrate = tareUnits > 0 && result.net > 0 ? result.net / tareUnits : 0
  // D і F — найпомилковіші поля бізнесу, і в їхньому файлі на них нема жодної перевірки ✓ H7
  const grossHint =
    grossNum > GROSS_HINT_KG
      ? `${num(grossNum, 2)} кг — більше за найбільший рядок сезону (701,5 кг). Перевірте брутто.`
      : grossNum > 0 && tareUnits === 0
        ? 'Тару не додано — брутто пішло б у чисту вагу цілком. Перевірте кількість тари.'
        : perCrate && (perCrate > PER_CRATE_MAX || perCrate < PER_CRATE_MIN)
          ? `${num(perCrate, 1)} кг у ящику. Перевірте брутто або кількість тари.`
          : ''

  const showPallet = palletOpen || palletNum > 0 || tareUnits >= 20
  const atCap = lines.length >= MAX_LINES - 1
  // вага введена, але позиція незавершена — без цього «Прийняти» тихо викинуло б її
  const draftIncomplete = grossNum > 0 && (!draft || tareUnits === 0)
  const draftHint = !draftIncomplete
    ? ''
    : !berryId
      ? 'Оберіть сорт для цієї позиції — інакше вона не потрапить у квитанцію.'
      : tareUnits === 0
        ? 'Вкажіть кількість тари — без неї брутто пішло б у чисту вагу цілком.'
        : 'Чиста вага виходить нульова: піддон і тара зʼїдають усе брутто.'
  /**
   * G12/I58 на кнопці. Досі гейт про касу не знав нічого: підказка на :951 світилася
   * бурштином, кнопка лишалася активною, стор відмовляв — і відмову ніхто не показував.
   * `math.paid` тут ДОРІВНЮЄ `cashLeaving` зі `store.addVisit` за побудовою `visitMath()`:
   * `paidToday + paidToPast === paid`. Тому кнопка тепер вимикається РІВНО тоді, коли
   * рушій відмовить, а не приблизно.
   */
  /**
   * Гейт кнопки викликає ТУ САМУ функцію рушія, що й block у сторі, — `checkBerryPayout()`.
   * Не свою копію умови: `ports.ts` про `check*` каже «правило одне на двох», і саме тут
   * друга копія вже завелася і вже була НЕПРАВИЛЬНОЮ.
   *
   * ⚠️ ЩО БУЛО. Перша версія рахувала `math.paid > berryCash + 0.009` руками. Рушій же
   * затискає касу нулем (`max = Math.max(0, round2(berryCash))`) і перевіряє лише тоді,
   * коли з шухляди справді щось виходить. При відʼємній касі — а вона досяжна, керівник
   * може знизити наділ заднім числом, і `cashStanding()` фіксує зміряні −51 130,18 ₴ —
   * умова `0 > берykash + 0.009` ставала правдивою, і кнопка блокувала візит із
   * «Видано = 0», тобто прийомку В БОРГ, яку рушій приймає без питань. Саме її порожня
   * каса й вимагає: ягоду беруть, гроші лягають у залишок постачальника.
   *
   * `math.paid` тут дорівнює `cashLeaving` зі `store.addVisit` за побудовою `visitMath()`:
   * `paidToday + paidToPast === paid`. Тому гейт і block тепер тотожні за визначенням.
   */
  const payCheck = checkBerryPayout(math.paid, berryCash)
  // `CrateCheck.max` — `number | null`, бо той самий тип обслуговує `checkCrateIssue()`, де
  // «наділу ще не було» це null. `checkBerryPayout()` завжди віддає число, тому 0 тут — не
  // здогадка, а недосяжна гілка, яку все одно треба назвати замість `!`.
  const payCeiling = payCheck.max ?? 0
  const overBerryCash = math.paid > 0.009 && !payCheck.ok
  const ready = Boolean(supplierId) && allLines.length > 0 && !draftIncomplete && !overBerryCash

  const todayReceptions = receptions
    .filter((r) => r.date === config.businessToday && r.pointId === pointId)
    .sort((a, b) => b.time.localeCompare(a.time))
  /** Візит — це один рядок у журналі дня, скільки б позицій у ньому не було (M5) */
  const todayVisits = (() => {
    const groups = new Map<string, Reception[]>()
    for (const r of todayReceptions) {
      const list = groups.get(r.visitId ?? r.id) ?? []
      list.push(r)
      groups.set(r.visitId ?? r.id, list)
    }
    return [...groups.values()].map((rows) => [...rows].sort((a, b) => a.code.localeCompare(b.code)))
  })()

  const day = reconcileDay(
    config.businessToday,
    receptions.filter((r) => r.pointId === pointId),
    payouts.filter((p) => p.pointId === pointId),
  )

  function clearDraft() {
    setGross('')
    setPalletInput('')
    setPalletOpen(false)
    setTare([{ tareId: config.crateTareId, count: 0 }])
    setBonusInput('0')
  }

  function reset() {
    setSupplierId(undefined)
    setBerryId(undefined)
    setLines([])
    setIncludeOverride(null)
    setPaidInput('')
    setPaidTouched(false)
    clearDraft()
  }

  function addLine() {
    if (!draft) {
      toast.error('Спочатку заповніть цю позицію')
      return
    }
    setLines((prev) => [...prev, { ...draft, key: `l_${Math.random().toString(36).slice(2, 8)}` }])
    setBerryId(undefined)
    clearDraft()
  }

  function save() {
    if (!supplierId) {
      toast.error('Оберіть постачальника')
      return
    }
    if (!allLines.length) {
      toast.error('Оберіть сорт і введіть брутто більше за тару')
      return
    }
    const res = addVisit({
      date: config.businessToday,
      pointId,
      supplierId,
      carriedIn: math.carriedIn,
      paid: math.paid,
      lines: allLines.map(({ berryId: id, gross: g, pallet, tare: t, tareWeight, net, price: p, bonus: b, amount }) => ({
        berryId: id,
        gross: g,
        pallet,
        tare: t,
        tareWeight,
        net,
        price: p,
        bonus: b,
        amount,
      })),
    })
    // Відмова рушія — `undefined`. Раніше вона поверталася порожнім масивом, тост
    // «Прийнято …» друкувався поверх неї, форма очищалася, і візит зникав без слова.
    // З фази 4 причин відмови дві, і друга — «ця точка не ваша»: підпис під квитанцією
    // тепер імʼя людини з сесії, а не назва точки, тому чужу книгу писати нема чим.
    if (!res) {
      toast.error('Прийомку не проведено', {
        description: `У касі за ягоду ${uah(Math.max(0, berryCash), { decimals: 2 })} — видати ${uahAuto(math.paid)} нема з чого. Якщо каса не порожня, перевірте, чи ця точка ваша.`,
      })
      return
    }
    const { receptions: created, payout } = res
    // квитанція візиту: діалог сам збирає всі його позиції за visitId
    setReceipt(created[0])
    setReceiptPayout(payout)
    toast.success(`Прийнято ${kg(netTotal)} — ${uahAuto(math.accrued)}`, {
      description:
        math.paidToPast > 0.009
          ? `З них ${uahAuto(math.paidToPast)} на попередні залишки`
          : math.remainder > 0.009
            ? `Залишок за нами: ${uahAuto(math.remainder)}`
            : 'Розраховано повністю',
    })
    reset()
  }

  const positionsWord = plural(allLines.length, 'позиція', 'позиції', 'позицій')

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
        <div>
          <Eyebrow className="mb-1.5">
            {point.name} · {point.village} · {longDate(config.businessToday)}
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
          {/* ------------- left: form ------------- */}
          <div className="flex flex-col gap-5">
            <div className="rounded-xl bg-card ring-1 ring-foreground/10">
              {/* supplier */}
              <div className="border-b border-border/70 p-4">
                <div className="mb-2 flex items-center justify-between">
                  <Eyebrow>1 · Постачальник</Eyebrow>
                  {supplier ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      {supplier.phone ?? 'телефон не вказано'}
                    </span>
                  ) : null}
                </div>
                <SupplierPicker
                  value={supplierId}
                  onChange={(id) => {
                    setSupplierId(id)
                    setIncludeOverride(null)
                    setPaidTouched(false)
                    // позиції належать людині, а не екрану: інший постачальник — новий візит
                    if (lines.length) {
                      setLines([])
                      toast.info('Позиції очищено — вони належали попередньому постачальнику')
                    }
                  }}
                  pointId={pointId}
                />

                {supplier && balance > 0.009 ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-sm">
                    <HandCoins className="size-4 shrink-0 text-[var(--amber)]" />
                    <span>
                      Попередній залишок <b className="font-mono">{uahAuto(balance)}</b>
                    </span>
                    <span className="text-xs text-muted-foreground">з {openDatesText}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      додасться в «Разом» нижче
                    </span>
                  </div>
                ) : null}
                {supplier && balance < -0.009 ? (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--leaf)]/10 px-3 py-2 text-sm">
                    <HandCoins className="size-4 shrink-0 text-[var(--leaf)]" />
                    <span>
                      Переплата за нами <b className="font-mono">{uahAuto(Math.abs(balance))}</b>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      видано наперед — у «Разом» не додається
                    </span>
                  </div>
                ) : null}
              </div>

              {/* weight — M9 диктує: спочатку вага, і тільки потім сорт */}
              <div className="border-b border-border/70 p-4">
                <Eyebrow className="mb-2">2 · Вага з тарою</Eyebrow>
                <div className="flex flex-col gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="gross" className="text-xs text-muted-foreground">
                      Брутто — ягода разом із тарою
                    </Label>
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="relative min-w-[180px] flex-1">
                        <Input
                          id="gross"
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
                      {showPallet ? (
                        <div className="grid gap-1">
                          <Label htmlFor="pallet" className="text-xs text-muted-foreground">
                            Піддон
                          </Label>
                          <div className="relative w-[124px]">
                            <Input
                              id="pallet"
                              value={palletInput.replace('.', ',')}
                              onChange={(e) => setPalletInput(maskDecimalInput(e.target.value))}
                              inputMode="decimal"
                              placeholder="0,0"
                              className="h-10 pr-9 font-mono text-base font-semibold"
                            />
                            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground">
                              кг
                            </span>
                          </div>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="mt-6 text-muted-foreground"
                          onClick={() => setPalletOpen(true)}
                        >
                          <Plus className="size-3.5" />
                          Піддон
                        </Button>
                      )}
                    </div>
                    {grossHint || draftHint ? (
                      <div className="flex items-start gap-2 text-xs text-[var(--amber)]">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" />
                        <span>{grossHint || draftHint}</span>
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Тара — знімається автоматично
                    </Label>
                    {tare.map((line, idx) => {
                      const t = tareTypes.find((x) => x.id === line.tareId)
                      return (
                        <div key={line.tareId} className="flex items-center gap-2">
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
                      <Button
                        variant="ghost"
                        size="sm"
                        // всі чотири види вже в кошику — інакше додався б другий рядок Чешки
                        disabled={tare.length >= tareTypes.length}
                        onClick={() => {
                          const free = tareTypes.find((t) => !tare.some((l) => l.tareId === t.id))
                          if (free) setTare((prev) => [...prev, { tareId: free.id, count: 0 }])
                        }}
                      >
                        <Package className="size-3.5" />
                        Інша тара
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              {/* berry + surcharge */}
              <div className="border-b border-border/70 p-4">
                <Eyebrow className="mb-2">3 · Товар, сорт і ціна дня</Eyebrow>
                <div className="flex flex-col gap-2.5">
                  {berryGroups.map((group) => (
                    <div key={group.product}>
                      <div className="mb-1.5 text-xs text-muted-foreground">{group.product}</div>
                      <div className="flex flex-wrap gap-2">
                        {group.items.map(({ berry, price: p }) => {
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
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="bonus" className="text-xs text-muted-foreground">
                      Дод. ціна — на цю позицію, ₴/кг
                    </Label>
                    <div
                      className={cn(
                        'flex items-center gap-1 rounded-lg border bg-background p-1',
                        surcharge.ok ? 'border-border' : 'border-[var(--amber)]',
                      )}
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setBonusInput(
                            String(Math.max(settings.surchargeMin, round2(bonusNum - 1))),
                          )
                        }
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <input
                        id="bonus"
                        value={bonusInput}
                        onChange={(e) => setBonusInput(maskDecimalInput(e.target.value, 2, true))}
                        inputMode="decimal"
                        className="w-16 bg-transparent text-center font-mono text-base font-semibold outline-none"
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() =>
                          setBonusInput(
                            String(Math.min(settings.surchargeMax, round2(bonusNum + 1))),
                          )
                        }
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="pb-2 text-xs text-muted-foreground">
                    межі керівника: {num(settings.surchargeMin)} … +{num(settings.surchargeMax)} ₴/кг
                  </div>
                </div>
                {!surcharge.ok ? (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-xs">
                    <AlertTriangle className="mt-px size-3.5 shrink-0 text-[var(--amber)]" />
                    <span>
                      <b className="font-mono">{num(bonusNum, 2)} ₴/кг</b>{' '}
                      {surcharge.over
                        ? `понад стелю +${num(settings.surchargeMax)} ₴`
                        : `нижче межі ${num(settings.surchargeMin)} ₴`}
                      . Понад межу — потрібен дозвіл керівника — позиція поки рахується без Дод. ціни.
                    </span>
                  </div>
                ) : null}
              </div>

              {/* basket — M5: один постачальник, N позицій, один «Разом» */}
              <div className="border-b border-border/70 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" onClick={addLine} disabled={!draft || atCap}>
                    <Plus className="size-4" />
                    Ще позиція
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {atCap
                      ? 'У реальних даних максимум 5 позицій на візит — більше не додаємо.'
                      : 'Кілька сортів від одного постачальника підбиваються в один «Разом» і один чек.'}
                  </span>
                  {lines.length ? (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {allLines.length} {positionsWord} · {kg(netTotal)}
                    </span>
                  ) : null}
                </div>

                {lines.length ? (
                  <div className="mt-3 overflow-x-auto">
                    <div className="min-w-[560px]">
                      <div className="grid grid-cols-[minmax(110px,1.6fr)_repeat(6,minmax(50px,1fr))_28px] gap-2 px-2 pb-1 text-[10px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
                        <span>Сорт</span>
                        <span className="text-right">Брутто</span>
                        <span className="text-right">Піддон</span>
                        <span className="text-right">Тара</span>
                        <span className="text-right">Нетто</span>
                        <span className="text-right">Ціна</span>
                        <span className="text-right">Сума</span>
                        <span />
                      </div>
                      <ul className="divide-y divide-border/60 rounded-lg bg-muted/40">
                        {lines.map((l) => (
                          <li
                            key={l.key}
                            className="grid grid-cols-[minmax(110px,1.6fr)_repeat(6,minmax(50px,1fr))_28px] items-center gap-2 px-2 py-1.5 font-mono text-xs"
                          >
                            <span className="truncate font-sans">
                              {berries.find((b) => b.id === l.berryId)?.name ?? '—'}
                            </span>
                            <span className="text-right">{num(l.gross, 2)}</span>
                            <span className="text-right text-muted-foreground">
                              {l.pallet > 0 ? num(l.pallet, 2) : '—'}
                            </span>
                            <span className="text-right text-muted-foreground">{l.tareUnits}</span>
                            <span className="text-right font-semibold">{num(l.net, 2)}</span>
                            <span className="text-right">
                              {num(l.price)}
                              {l.bonus ? (
                                <span className="text-[var(--amber)]">
                                  {l.bonus > 0 ? ' +' : ' −'}
                                  {num(Math.abs(l.bonus))}
                                </span>
                              ) : null}
                            </span>
                            <span className="text-right font-semibold">{num(l.amount, 2)}</span>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* payout — M10 */}
              <div className="p-4">
                <Eyebrow className="mb-2">4 · Розрахунок</Eyebrow>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1.15fr)_minmax(220px,0.85fr)]">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="text-muted-foreground">
                        Нараховано сьогодні
                        {allLines.length > 1 ? ` · ${allLines.length} ${positionsWord}` : ''}
                      </span>
                      <span className="font-mono">{uah(math.accrued, { decimals: 2 })}</span>
                    </div>

                    {balance > 0.009 ? (
                      <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--amber)]/10 px-3 py-2">
                        <div className="flex min-w-0 items-center gap-2 text-sm">
                          <Switch
                            aria-label="Враховувати залишок"
                            checked={includeBalance}
                            onCheckedChange={(v) => {
                              setIncludeOverride(v)
                              setPaidTouched(false)
                            }}
                          />
                          <span className="shrink-0">Враховувати залишок</span>
                          <span className="truncate text-xs text-muted-foreground">
                            з {openDatesShort}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'shrink-0 font-mono text-sm',
                            includeBalance ? '' : 'text-muted-foreground line-through',
                          )}
                        >
                          + {uah(balance, { decimals: 2 })}
                        </span>
                      </div>
                    ) : null}

                    <div className="my-1 border-t border-foreground/20" />

                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Eyebrow>Разом до видачі</Eyebrow>
                      <span className="font-mono text-[34px] leading-none font-semibold tracking-tight">
                        {uah(math.total, { decimals: 2 })}
                      </span>
                    </div>

                    <div className="mt-2 grid gap-1.5">
                      <Label htmlFor="paid" className="text-xs text-muted-foreground">
                        Видано готівкою
                      </Label>
                      <div className="relative">
                        <Input
                          id="paid"
                          value={paidInput.replace('.', ',')}
                          onChange={(e) => {
                            setPaidTouched(true)
                            setPaidInput(maskDecimalInput(e.target.value))
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
                            setPaidInput(String(math.total))
                          }}
                        >
                          Уся сума
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          // під 100 ₴ округляти нікуди — інакше кнопка тихо означала б «нічого не видати»
                          disabled={math.total < 100}
                          onClick={() => {
                            setPaidTouched(true)
                            setPaidInput(String(Math.floor(math.total / 100) * 100))
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
                      {math.paidToPast > 0.009 ? (
                        <div className="text-xs text-muted-foreground">
                          З них{' '}
                          <b className="font-mono text-foreground">
                            {uah(math.paidToPast, { decimals: 2 })}
                          </b>{' '}
                          закриють попередні залишки — {willCloseDates}
                        </div>
                      ) : null}
                      {parseNumeric(paidInput) > math.payCap + 0.009 ? (
                        <div className="text-xs text-[var(--amber)]">
                          Більше за РАЗОМ видати не можна — рахуємо{' '}
                          <b className="font-mono">{uah(math.paid, { decimals: 2 })}</b>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div
                    className={cn(
                      'flex flex-col justify-center rounded-lg px-4 py-3',
                      math.remainder > 0.009 ? 'bg-[var(--amber)]/10' : 'bg-[var(--leaf)]/10',
                    )}
                  >
                    <Eyebrow>
                      {math.remainder > 0.009 ? 'Залишок за нами' : 'Розраховано повністю'}
                    </Eyebrow>
                    <div
                      className={cn(
                        'mt-1 font-mono text-2xl font-semibold',
                        math.remainder > 0.009 ? 'text-[var(--amber)]' : 'text-[var(--leaf)]',
                      )}
                    >
                      {math.remainder > 0.009 ? uah(math.remainder, { decimals: 2 }) : uah(0)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {math.remainder > 0.009
                        ? 'Додасться до залишку постачальника — датою сьогодні'
                        : 'Нічого не зависає на балансі'}
                    </div>
                  </div>
                </div>

                {/*
                  G12/I58 названий вголос, а не застосований мовчки. Без цього рядка людина
                  бачила б, що «Разом» одне, а видається менше, і не знала б чому. Текст —
                  той самий, що в `06 §2`: у касі стільки, видати треба стільки, різниця йде
                  в залишок, і відновлює касу переказ від керівника.
                */}
                {overBerryCash || (math.total > payCeiling + 0.009 && !paidTouched) ? (
                  <p className="mt-3 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--amber)]">
                    У касі за ягоду {uah(payCeiling, { decimals: 2 })} — більше зараз
                    видати нема з чого. Різниця лягає в залишок постачальника; касу відновлює
                    переказ від керівника.
                  </p>
                ) : null}

                <Button className="mt-4 h-14 w-full text-base" disabled={!ready} onClick={save}>
                  <Check className="size-5" />
                  {ready
                    ? `Прийняти ${allLines.length > 1 ? `${allLines.length} ${positionsWord} · ` : ''}${kg(netTotal)} · видати ${uahAuto(math.paid)}`
                    : 'Прийняти'}
                </Button>
              </div>
            </div>
          </div>

          {/* ------------- right: стан точки + журнал дня ------------- */}
          <div className="flex flex-col gap-4">
            {/*
              Тонаж і лічильник квитанцій переїхали в шапку списку, під яким вони й так
              стоять: інакше праворуч вишикувалося б одинадцять чисел поспіль, і жодне з
              них не читалося б з першого погляду. Каса й ящики — окремим блоком, бо це
              стан ТОЧКИ, а не підсумок дня.
            */}
            <PointStatePanel
              pointId={pointId}
              date={config.businessToday}
              cashOut={day.cashOut}
              newDebt={day.newDebt}
            />

            <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
                <Eyebrow className="truncate">Сьогоднішні квитанції</Eyebrow>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    {tonnage(day.netKg)}
                  </span>
                  <Badge variant="secondary" className="font-mono">
                    {todayVisits.length}
                  </Badge>
                </div>
              </div>
              <div className="max-h-[560px] overflow-y-auto">
                {todayVisits.length === 0 ? (
                  <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Ще нічого не прийнято. Перша квитанція зʼявиться тут.
                  </div>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {todayVisits.map((rows) => {
                      const first = rows[0]
                      const s = suppliers.find((x) => x.id === first.supplierId)
                      const b = berries.find((x) => x.id === first.berryId)
                      const visitNet = sum(rows, (r) => r.net)
                      const visitAmount = sum(rows, (r) => r.amount)
                      const visitDebt = sum(rows, (r) => r.debt)
                      return (
                        <li key={first.id}>
                          <button
                            onClick={() => {
                              setReceipt(first)
                              setReceiptPayout(undefined)
                            }}
                            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/60"
                          >
                            <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">
                              {first.time}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {s?.name ?? '—'}
                              </span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {rows.length > 1
                                  ? `${rows.length} ${plural(rows.length, 'позиція', 'позиції', 'позицій')}`
                                  : b?.short}{' '}
                                · {kg(visitNet)}
                                {visitDebt > 0 ? (
                                  <span className="text-[var(--amber)]">
                                    {' '}
                                    · залишок {uah(visitDebt)}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block font-mono text-sm font-medium">
                                {uah(visitAmount)}
                              </span>
                              {rows.some((r) => !r.synced) ? (
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
        payout={receiptPayout}
        open={Boolean(receipt)}
        onOpenChange={(v) => !v && setReceipt(null)}
      />
    </div>
  )
}
