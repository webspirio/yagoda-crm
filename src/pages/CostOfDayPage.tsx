import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Plus,
  Printer,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
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
import { costOfDay, maskDecimalInput, ownerName, parseNumeric, sum } from '@/lib/calc'
import { addDays, kg, longDate, num, shortDate, uah, uahAuto, weekday } from '@/lib/format'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { CostRow, Violation } from '@/lib/calc'
import type { ExpensePolicy, ISODate } from '@/lib/types'

/** Префікс значення селектора «усе на один товар» — правило `R-09`. */
const SINGLE = 'single:'

/**
 * Ставки в цій таблиці друкуються ЧОТИРМА знаками свідомо: саме на четвертому видно
 * роздачу копійок (`09 §3.4`) — 6,3934 у малини й смородини проти 6,3940 у порічки.
 * `null` (товар без переважування, `I50`) — це «—», і НІКОЛИ не «NaN».
 */
const rate4 = (v: number | null) => (v === null ? '—' : num(v, 4))

/** Те саме зі знаком: «+6,3934» / «−6,3934». Мінус — типографський, як в `uah()`. */
function signed(v: number | null, decimals: number) {
  if (v === null) return '—'
  return v < 0 ? `−${num(Math.abs(v), decimals)}` : `+${num(v, decimals)}`
}

/**
 * Н8 · Собівартість дня по прийомці (`09 §5`, реалізує `M15`, `M16`, `M18`…`M22`).
 *
 * Три речі, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. **Дата ЛОКАЛЬНА** (`09 §5`): `useState` від `workDate`, і `‹ ›` НЕ кличуть
 *    `setWorkDate`. Керівник розбирає вчорашній день, поки на пунктах іде сьогоднішня
 *    торгівля — глобальний перемикач дати зіпсував би роботу приймальникам.
 * 2. **Права колонка — єдине місце вводу.** Ліва половина тільки читає, і колонка грошей
 *    підписана «нараховано», а не «виплачено»: борги існують (`M30`), тому `paid` — це
 *    нарахована сума закупки, а не готівка з каси (`09 §3.1`).
 * 3. **Коли переважування немає ЗОВСІМ** (`status === 'awaiting-reweigh'`), рушій за
 *    загальною формулою читає всю вагу дня як недостачу (`kgBase = 0 → shortKg = −kgPoint`)
 *    — це те саме правило `I50`, яким тримається `I46`. Але показати «Недостача в ягоді
 *    17 419,07 ₴» на дні, коли ніхто нічого не важив, означало б назвати клієнтові вигадану
 *    цифру: ягода не зникла, її просто ще не зважили. Тому в цьому стані на екрані стоять
 *    лише РУЧНІ витрати — рівно те число, яке називає і сам рушій у тексті `I51`.
 */
export function CostOfDayPage() {
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const receptions = useStore((s) => s.receptions)
  const reweighs = useStore((s) => s.reweighs)
  const expenses = useStore((s) => s.expenses)
  const policies = useStore((s) => s.policies)
  const workDate = useStore((s) => s.workDate)
  const role = useStore((s) => s.role)
  const users = useStore((s) => s.users)
  const config = useStore((s) => s.config)
  const addExpense = useStore((s) => s.addExpense)
  const removeExpense = useStore((s) => s.removeExpense)
  const setExpensePolicy = useStore((s) => s.setExpensePolicy)

  const [date, setDate] = React.useState<ISODate>(workDate)
  const [pointId, setPointId] = React.useState(() => points.find((p) => p.active)?.id ?? '')
  const [label, setLabel] = React.useState('')
  const [amount, setAmount] = React.useState('')

  // «тільки керівник має до цього всього доступ» — дзвінок №4
  if (role !== 'owner') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Керівництву"
          title="Собівартість дня"
          description="Цей розділ доступний лише керівникові."
        />
      </div>
    )
  }

  /*
   * ФІЛЬТРА ПО `kind` ТУТ НЕМА НАВМИСНО. «Склад тоже считається як одна прийомка… Також
   * фіксується як прийомний пункт» (дзвінок №4, ряд. 545–547), і `13 §4 S-22` прямо каже:
   * «`Point.kind` лишається, але фільтрів по ньому в селекторах НЕ ставимо». База — це
   * звичайний пункт прийому з вищими, оптовими цінами (`M37`) ПЛЮС місце переважування.
   * Поки тут стояло `kind === 'reception'`, той самий день показував Склад зведеним на Н10
   * (98 420,00 ₴) і віддав би `awaiting-reweigh` + `I51` на Н8 — дві правди про один день.
   */
  const pickablePoints = points.filter((p) => p.active)
  const selectedPoint = points.find((p) => p.id === pointId)
  const pointName = selectedPoint?.name ?? '—'
  // Правило розподілу належить ПАРІ (пункт, день) — `D-3`. Глобальною настройкою воно бути
  // не може: зміна правила сьогодні переписала б собівартість усіх минулих днів.
  const policy = policies.find((p) => p.date === date && p.pointId === pointId)
  const day = costOfDay({
    date,
    pointId,
    receptions,
    berries,
    reweighs,
    expenses,
    policy,
    // ТОЙ САМИЙ прапорець, що його передає `networkAverage()`: пункт, який важить сам себе,
    // отримує `kgBase = kgPoint`. Без нього Рішення 1 замовника («база важить сама себе»)
    // застосоване наполовину — на мережі є, на аркуші пункту немає.
    selfWeighed: selectedPoint?.kind === 'base',
  })

  const notSummed = day.status === 'awaiting-reweigh'
  const shortKgTotal = sum(day.rows, (r) => r.shortKg)
  const shortUahTotal = sum(day.rows, (r) => r.shortUah)
  /**
   * «надлишок» — той самий показник зі знаком `+` (`09 §1`, словник клієнта). Слово не
   * вигадане: воно стоїть у спеці поруч із «недостачею», і `I47` існує саме для цього дня.
   *
   * Без нього екран дня надлишку писав «недостача −9 850,83 ₴» і «пул −6 150,83 ₴» —
   * арифметично правильно (демо: Шипинки 15.07, надлишок 73,35 кг перекриває 3 700 ₴
   * витрат), але читається як збій. Мінус перед словом «недостача» — це не мінус, це
   * ІНШЕ СЛОВО.
   */
  const surplus = shortKgTotal > 0.009
  const allocTotal = sum(day.rows, (r) => r.alloc)

  // `day.basis`/`day.singleProduct` — це ДІЙСНЕ правило, а не запитане: при відкоті рушій
  // віддає `byWeight` і `Violation{code:'policy-fallback'}`, і саме цей текст видно нижче.
  const policyValue = day.singleProduct !== null ? SINGLE + day.singleProduct : day.basis
  const basisLabel =
    day.singleProduct !== null
      ? `усе на ${day.singleProduct}`
      : day.basis === 'byValue'
        ? 'по сумі'
        : 'по вазі'

  const addRow = () => {
    const trimmed = label.trim()
    const value = parseNumeric(amount)
    if (!trimmed || value === 0) return
    addExpense({ date, pointId, label: trimmed, amount: value, createdBy: ownerName(users) })
    setLabel('')
    setAmount('')
  }

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow={`Керівництву · ${weekday(date)}`}
        title="Собівартість дня"
        description="Недостача й розтрати дня, розкидані на кожен кілограм ягоди. Ліва половина тільки читає, права — єдине місце вводу."
        actions={
          <>
            <Select value={pointId} onValueChange={setPointId}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pickablePoints.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Дата ЛОКАЛЬНА: setWorkDate тут не викликається жодного разу (09 §5) */}
            <div className="flex items-center rounded-lg border border-border bg-card">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-r-none"
                disabled={date <= config.seasonStart}
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2.5 font-mono text-xs">{shortDate(date)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-l-none"
                disabled={date >= config.businessToday}
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {date !== config.businessToday ? (
              <Button variant="outline" size="sm" onClick={() => setDate(config.businessToday)}>
                Сьогодні
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              Друк
            </Button>
          </>
        }
      />

      {/* Аркуш, який керівниця понесе з собою: усе, що має потрапити на папір, лежить
          ВСЕРЕДИНІ цієї обгортки, а кнопки — або поза нею, або з класом `print-hide`.
          Класи оголошує src/index.css; ця сторінка їх лише навішує. */}
      <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="print-only mb-4">
          <div className="font-display text-lg font-semibold">
            Собівартість за {longDate(date)} · {pointName}
          </div>
          <div className="text-sm text-muted-foreground">
            нараховано {uahAuto(day.paidTotal)} · розподіл {basisLabel}
          </div>
        </div>

        {/* «або вверху, там де шипинки, можна тут писати недостача» — прямі слова клієнта:
            недостача за день дублюється ВГОРІ, біля назви пункту */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
          <span className="font-display text-lg leading-none font-medium">{pointName}</span>
          <span className="font-mono text-xs text-muted-foreground">
            {shortDate(date)} · {weekday(date)}
          </span>
          {day.fromSnapshot ? (
            <Badge variant="secondary" className="font-normal">
              середня ціна зі знімка переважування
            </Badge>
          ) : null}
          <span className="ml-auto">
            {notSummed ? (
              <Badge variant="outline" className="border-[var(--amber)]/40 text-[var(--amber)]">
                Очікує переважування
              </Badge>
            ) : (
              <span className="flex items-center gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-1.5 text-sm font-medium text-[var(--amber)]">
                <TriangleAlert className="size-4" />
                {surplus ? 'Надлишок' : 'Недостача'} за день: {kg(Math.abs(shortKgTotal))} ·{' '}
                {uah(Math.abs(shortUahTotal), { decimals: 2 })}
              </span>
            )}
          </span>
        </div>

        {day.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Цього дня на цьому пункті прийомки не було.
          </p>
        ) : (
          <>
            {/* Порушення — ВСІ, звичайною розміткою. У стані «не зведено» `I45` і `I46`
                стоять як block навмисно (`09 §4`: block тримає день у стані «не зведено»),
                тому тут вони бурштинові й спокійні, а не аварійні. */}
            {day.violations.length ? (
              <div className="mb-4 flex flex-col gap-1.5">
                {notSummed ? (
                  <Eyebrow className="text-[var(--amber)]">День ще не зведений</Eyebrow>
                ) : null}
                {day.violations.map((v) => (
                  <ViolationLine key={v.code + v.message} violation={v} calm={notSummed} />
                ))}
              </div>
            ) : null}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(290px,0.6fr)]">
              {/* ---------- ЛІВО · ЯГОДА. Тільки читає, жодного поля вводу ---------- */}
              <div>
                <Eyebrow className="mb-2">Ягода</Eyebrow>
                <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>товар</TableHead>
                        <TableHead className="text-right">вага</TableHead>
                        <TableHead className="text-right">₴/кг</TableHead>
                        <TableHead className="text-right">нараховано</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.rows.map((r) => (
                        <React.Fragment key={r.product}>
                          <TableRow>
                            <TableCell className="font-medium uppercase">
                              {r.product}
                              {r.foreign ? (
                                <Badge variant="destructive" className="ml-1.5 font-normal">
                                  товар не з цього пункту
                                </Badge>
                              ) : null}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {kg(r.kgPoint)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {num(r.avgPoint, 2)}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {uahAuto(r.paid)}
                            </TableCell>
                          </TableRow>
                          {notSummed ? (
                            <TableRow>
                              <TableCell
                                colSpan={4}
                                className="pl-6 text-xs text-muted-foreground"
                              >
                                не перезважено
                              </TableCell>
                            </TableRow>
                          ) : (
                            <>
                              {Math.abs(r.shortKg) > 0.009 ? (
                                <TableRow className="text-[var(--amber)]">
                                  <TableCell className="pl-6">
                                    {r.shortKg > 0.009 ? 'надлишок' : 'недостача'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono tabular-nums">
                                    {kg(r.shortKg)}
                                  </TableCell>
                                  <TableCell />
                                  <TableCell className="text-right font-mono tabular-nums">
                                    {uahAuto(r.shortUah)}
                                  </TableCell>
                                </TableRow>
                              ) : null}
                              <TableRow className="bg-muted/40">
                                <TableCell className="pl-6 font-medium">
                                  {/* «осьо зірочка стоїть… красним надо было» — позначку
                                      просив сам клієнт, тому вона помітна */}
                                  <span className="mr-1.5 text-base text-primary">★</span>
                                  наша вага
                                  {r.reweighed ? null : (
                                    <Badge variant="outline" className="ml-1.5 font-normal">
                                      не перезважено
                                    </Badge>
                                  )}
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium tabular-nums">
                                  {r.reweighed ? kg(r.kgBase) : '—'}
                                </TableCell>
                                <TableCell className="text-right font-mono tabular-nums">
                                  {num(r.avgPoint, 2)}
                                </TableCell>
                                <TableCell className="text-right font-mono font-medium tabular-nums">
                                  {uahAuto(r.baseSum)}
                                </TableCell>
                              </TableRow>
                            </>
                          )}
                        </React.Fragment>
                      ))}
                      <TableRow className="border-t-2 border-border">
                        <TableCell className="font-semibold">РАЗОМ по пункту</TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {kg(day.kgPointTotal)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {uahAuto(day.paidTotal)}
                        </TableCell>
                      </TableRow>
                      {notSummed ? null : (
                        <TableRow>
                          <TableCell className="font-medium">
                            <span className="mr-1.5 text-base text-primary">★</span>
                            наша вага, разом
                          </TableCell>
                          <TableCell className="text-right font-mono font-medium tabular-nums">
                            {kg(day.kgBaseTotal)}
                          </TableCell>
                          <TableCell />
                          <TableCell />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  «Нараховано» — це нарахована сума закупки, а не готівка з каси: борги
                  існують, тому готівка, що вийшла з каси за цей день, — інше число, і воно
                  на собівартість не впливає.
                </p>
              </div>

              {/* ---------- ПРАВО · ВИТРАТИ ЗА ДЕНЬ. Єдине місце вводу ---------- */}
              <div className="flex h-fit flex-col gap-3 rounded-lg bg-muted/40 p-4 ring-1 ring-foreground/5">
                <Eyebrow>Витрати за день</Eyebrow>

                {day.manualExpenses.length ? (
                  day.manualExpenses.map((e) => (
                    <div key={e.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm">{e.label}</span>
                      <span className="font-mono text-sm tabular-nums">
                        {uah(e.amount, { decimals: 2 })}
                      </span>
                      {/* Прибрати рядок — розширення проти 09 §2.3, свідоме: без нього
                          одруківка «13 000 замість 1 300» лишається в собівартості назавжди */}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="print-hide text-muted-foreground"
                        title={`Прибрати «${e.label}»`}
                        onClick={() => removeExpense(e.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Витрат за цей день ще не заводили.
                  </p>
                )}

                {/* «+ ще рядок» необмежено (M19). Область «цей пункт / вся мережа» тут
                    НЕМАЄ: скасовано цілком (13 §1 П-2) — «ви ділите пальне в себе і
                    записуєте, куди треба», тобто одну машину на три пункти керівник ділить
                    сам і заводить трьома рядками. */}
                <div className="print-hide flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Підпис витрати"
                    className="h-8 min-w-28 flex-1 text-xs"
                  />
                  <Input
                    value={amount}
                    onChange={(e) => setAmount(maskDecimalInput(e.target.value, 2, true))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addRow()
                    }}
                    inputMode="decimal"
                    placeholder="₴"
                    className="h-8 w-24 text-right font-mono text-xs"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={addRow}
                    disabled={!label.trim() || parseNumeric(amount) === 0}
                  >
                    <Plus className="size-3.5" />
                    ще рядок
                  </Button>
                </div>

                {notSummed ? (
                  /* Тут НЕ показуємо ні `shortfallTotal`, ні `pool`: без переважування
                     рушій читає всю вагу дня як недостачу, і «Недостача в ягоді
                     17 419,07 ₴» на дні, коли ніхто нічого не важив, було б вигаданою
                     цифрою. Називаємо саме ручні витрати — так само, як текст `I51`. */
                  <div className="rounded-lg bg-[var(--amber)]/10 px-3 py-2.5 text-[var(--amber)]">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium">Очікує переважування</span>
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {uah(day.expensesManual, { decimals: 2 })} не розподілено
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed opacity-90">
                      Поки партію не зважили на базі, недостачі ще немає — витрати дня нікуди
                      не лягли.
                    </p>
                  </div>
                ) : (
                  <>
                    {day.shortfallRow ? (
                      <div className="border-t border-border pt-3">
                        <div className="flex items-baseline justify-between gap-3">
                          {/* Підпис рушія — «Недостача в ягоді»: у ДАНИХ рядок один, і його
                              знак несе сенс. На ПАПЕРІ ж «Недостача −9 850,83 ₴» читається
                              як збій, тому надлишок називається своїм словом (09 §1), а
                              сума друкується без мінуса. Рядок лишається похідним і
                              нередагованим (I43) — змінюється тільки те, як він звучить. */}
                          <span className="text-sm">
                            {surplus ? 'Надлишок у ягоді' : day.shortfallRow.label}
                          </span>
                          <span className="font-mono text-sm tabular-nums">
                            {uah(Math.abs(day.shortfallRow.amount), { decimals: 2 })}
                          </span>
                        </div>
                        {/* `I43`: рядок похідний — ні поля вводу, ні кнопки видалення */}
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CircleDot className="size-3" />
                          рахує система
                        </div>
                      </div>
                    ) : null}
                    <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                      <span className="text-sm font-semibold uppercase">Пул на розподіл</span>
                      <span className="font-mono text-base font-semibold tabular-nums">
                        {uah(day.pool, { decimals: 2 })}
                      </span>
                    </div>
                    {/* Рядка «у розподіл 3 800» більше немає: весь пул іде в розподіл,
                        бо `I44` скасовано (13 §1 П-1) */}
                    <div className="text-xs text-muted-foreground">
                      {uahAuto(day.expensesManual)} ручних {surplus ? '−' : '+'}{' '}
                      {uahAuto(Math.abs(day.shortfallTotal))}{' '}
                      {surplus ? 'надлишку' : 'недостачі'}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ---------- рядок під колонками ---------- */}
            {notSummed ? null : (
              <div className="mt-5 flex flex-col gap-1 rounded-lg bg-[var(--amber)]/10 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium text-[var(--amber)]">
                  <TriangleAlert className="size-4" />
                  {surplus ? 'Надлишок' : 'Недостача'} за день: {kg(Math.abs(shortKgTotal))} ·{' '}
                {uah(Math.abs(shortUahTotal), { decimals: 2 })}
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  Пул = витрати {uahAuto(day.expensesManual)} {surplus ? '−' : '+'}{' '}
                  {surplus ? 'надлишок' : 'недостача'}{' '}
                  {uahAuto(Math.abs(day.shortfallTotal))} = {uah(day.pool, { decimals: 2 })} ·
                  ставка{' '}
                  {num(day.pool, 2)} / {num(day.kgBaseTotal, 2)} = {num(day.rate, 5)}
                </span>
              </div>
            )}

            {/* ---------- СЕРЕДНЯ ЦІНА ПІСЛЯ ВИТРАТ ---------- */}
            {notSummed ? null : (
              <div className="mt-6">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <Eyebrow>Середня ціна після витрат</Eyebrow>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">
                      розподіл: {basisLabel}
                    </span>
                    <Select
                      value={policyValue}
                      onValueChange={(v) =>
                        // правило пишеться в ЦЮ пару (пункт, день); минулі дні не
                        // переписуються (`D-3`)
                        setExpensePolicy({
                          date,
                          pointId,
                          basis: v.startsWith(SINGLE) ? 'byWeight' : (v as ExpensePolicy['basis']),
                          singleProduct: v.startsWith(SINGLE) ? v.slice(SINGLE.length) : null,
                        })
                      }
                    >
                      <SelectTrigger className="print-hide h-8 w-[210px] text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="byWeight">Розподіл: по вазі</SelectItem>
                        <SelectItem value="byValue">Розподіл: по сумі</SelectItem>
                        {/* товари ЦЬОГО дня на ЦЬОМУ пункті, а не весь довідник (`D-3`) */}
                        {day.rows
                          .filter((r) => !r.foreign)
                          .map((r) => (
                            <SelectItem key={r.product} value={SINGLE + r.product}>
                              Усе на {r.product}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {/* «≈» стоїть свідомо: після роздачі копійок ставка не однакова до
                        ЧЕТВЕРТОГО знака (6,3934 у малини й смородини, 6,3940 у порічки) */}
                    <span className="font-mono text-xs font-medium">
                      ≈ {num(day.rate, 4)} ₴/кг на всіх
                    </span>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Товар</TableHead>
                        <TableHead className="text-right">наша вага</TableHead>
                        <TableHead className="text-right">із пулу</TableHead>
                        <TableHead className="text-right">разом</TableHead>
                        <TableHead className="text-right">собівартість</TableHead>
                        <TableHead className="text-right">було</TableHead>
                        <TableHead className="text-right">зміна</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {day.rows.map((r) => (
                        <TableRow key={r.product}>
                          <TableCell>
                            <span className="font-medium">{r.product}</span>
                            {/* `I50`: нулі в рядку товару без переважування мусять бути
                                підписані, інакше «разом 0,00 ₴» поруч із нарахованими
                                300 ₴ читається як зникла ягода, а не як незважена */}
                            {r.reweighed ? null : (
                              <Badge variant="outline" className="ml-1.5 font-normal">
                                не перезважено
                              </Badge>
                            )}
                            {r.foreign ? (
                              <Badge variant="destructive" className="ml-1.5 font-normal">
                                товар не з цього пункту
                              </Badge>
                            ) : null}
                            <UpliftBreakdown row={r} />
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {r.reweighed ? kg(r.kgBase) : '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {uah(r.alloc, { decimals: 2 })}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {uah(r.costTotal, { decimals: 2 })}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold tabular-nums">
                            {rate4(r.avgFinal)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                            {num(r.avgPoint, 4)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {signed(r.uplift, 4)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 border-border">
                        <TableCell className="font-semibold">РАЗОМ</TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {kg(day.kgBaseTotal)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {uah(allocTotal, { decimals: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {uah(day.costTotal, { decimals: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {rate4(day.avgFinalTotal)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>

                {/* Головна новина правила П-1, одним реченням — саме те, що клієнт просила
                    словами «розкиньте на все» */}
                <p className="mt-3 text-sm leading-relaxed">
                  Витрати дня разом із недостачею — {uah(day.pool)} на {kg(day.kgBaseTotal)} —
                  це{' '}
                  <span className="font-semibold">
                    {signed(day.rate, 2)} ₴ на кожен кілограм будь-якої ягоди
                  </span>
                  .
                </p>

                {/* Дві звірки — показані ЛЮДИНІ, а не сховані в тестах. Друга порівнюється
                    з НАРАХОВАНИМ плюс ручні витрати, а не з «Σ baseSum + пул»: друге —
                    тавтологія, зелена завжди, і не варта пікселя (`09 §3.2`). */}
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span
                    className={cn(
                      'font-mono',
                      day.checks.allocEqualsPool
                        ? 'text-[var(--leaf)]'
                        : 'text-destructive',
                    )}
                  >
                    Σ із пулу {uah(allocTotal, { decimals: 2 })} = пул{' '}
                    {uah(day.pool, { decimals: 2 })} {day.checks.allocEqualsPool ? '✓' : '✗'}
                  </span>
                  <span
                    className={cn(
                      'font-mono',
                      day.checks.conservation ? 'text-[var(--leaf)]' : 'text-destructive',
                    )}
                  >
                    Σ разом {uah(day.costTotal, { decimals: 2 })} = нараховано{' '}
                    {uahAuto(day.paidTotal)} + витрати {uahAuto(day.expensesManual)}{' '}
                    {day.checks.conservation ? '✓' : '✗'}
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Розклад надбавки — те, чого клієнт не могла порахувати на папері: вона просила «+6,8»
 * одним числом, але сама ж питала «щоб визначити, ну, типу де мінус пішов».
 */
function UpliftBreakdown({ row }: { row: CostRow }) {
  if (row.uplift === null) return null
  return (
    <span className="block text-xs text-muted-foreground">
      ↳ недостача {signed(row.upliftShort, 4)} · витрати {signed(row.upliftExpense, 4)}
    </span>
  )
}

/**
 * Порушення звичайною розміткою, як у `DayPage.tsx`. `calm` — це стан «день ще не
 * зведений»: за легендою `09 §4` `block` там означає «тримає день у стані „не зведено“»,
 * а не «щось поламалося», тому колір бурштиновий і слова «помилка» немає.
 */
function ViolationLine({ violation, calm }: { violation: Violation; calm: boolean }) {
  const hard = violation.severity === 'block' && !calm
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        hard
          ? 'bg-destructive/10 text-destructive'
          : 'bg-[var(--amber)]/10 text-[var(--amber)]',
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="mr-1.5 font-mono text-xs opacity-70">{violation.code}</span>
        {violation.message}
      </span>
    </div>
  )
}
