import { Eyebrow } from '@/components/common/bits'
import { uah } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Рядок розкладу каси. Арифметики тут немає й бути не може: значення приходить УЖЕ
 * порахованим рушієм (`cashStanding()`, `reconcileDay()`), а мінус перед видачею ставить
 * той, хто передає проп — рівно так само, як у «Касі за день». Форматер друкує число,
 * а не рахує його.
 */
function Row({
  label,
  hint,
  value,
  indent,
  strong,
  tone,
}: {
  label: string
  hint?: string
  value: number
  indent?: boolean
  strong?: boolean
  tone?: 'amber' | 'bad'
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', indent && 'pl-3')}>
      <span className={cn('text-sm', strong ? 'font-medium' : 'text-muted-foreground')}>
        {label}
        {hint ? <span className="ml-2 text-xs text-muted-foreground/70">{hint}</span> : null}
      </span>
      <span
        className={cn(
          'shrink-0 font-mono tabular-nums',
          strong ? 'text-lg font-semibold' : 'text-sm',
          tone === 'amber' && 'text-[var(--amber)]',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {uah(value, { decimals: 2 })}
      </span>
    </div>
  )
}

/**
 * Розклад «звідки взялося число в касі» (`21 §Н17`).
 *
 * ЧОМУ ВИДАЧА СТОЇТЬ ДВОМА РЯДКАМИ, А НЕ ОДНИМ. На їхній точці 2 за пʼять днів
 * нарахували 1 012 883 ₴, а видали 1 313 158 ₴ — на 300 275 ₴ більше (`H9`), бо гасили
 * давні борги. Одне число «видано» цього не пояснює, і саме на ньому в Excel народжується
 * підозра, що приймальник видав зайве.
 *
 * ТРЕТІЙ РЯДОК ВИДАЧІ (`погашено сьогоднішній залишок`) стоїть тут не для краси. Каса за
 * ягоду міняється рівно на `reconcileDay().cashOut`, а це `paidToday + Σ payout.amount`;
 * виплата, що закриває залишок, створений ЦЬОГО Ж дня, не потрапляє ні в «сьогоднішню
 * ягоду» (там лише `Reception.paid`), ні в «інші дні» (там лише інші дати ягоди). Без
 * цього рядка на такому дні стовпчик не сходився б із власним підсумком — а підсумок тут
 * не сума показаних рядків, а число рушія, тому розбіжність була б тихою.
 */
export function CashLedger({
  opening,
  openingFloat,
  openingOwed,
  paidToday,
  paidForPastDays,
  settledSameDay,
  cashInToday,
  berryCash,
}: {
  /** каса за ягоду на кінець попереднього дня — вона ж «на початок дня» */
  opening: number
  /** наділ, що діяв учора; `null`, коли наділу тоді ще не було */
  openingFloat: number | null
  /** скільки база була винна точці на початок дня */
  openingOwed: number | null
  paidToday: number
  paidForPastDays: number
  settledSameDay: number
  cashInToday: number
  berryCash: number
}) {
  // «наділ − борг бази 53 129,98». Обидва числа — з рушія; тут лише підпис, і він
  // зникає, коли наділу вчора ще не було або база нічого не винна.
  const hint =
    openingFloat === null
      ? undefined
      : openingOwed !== null && openingOwed > 0.009
        ? `наділ ${uah(openingFloat, { decimals: 2 })} − борг бази ${uah(openingOwed, { decimals: 2 })}`
        : `наділ ${uah(openingFloat, { decimals: 2 })}`

  return (
    <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <Eyebrow className="mb-3">Звідки взялося це число</Eyebrow>
      <div className="flex flex-col">
        <Row label="на початок дня" hint={hint} value={opening} />
        <Row label="видано за сьогоднішню ягоду" value={-paidToday} indent />
        <Row label="видано за ягоду інших днів" value={-paidForPastDays} indent />
        {settledSameDay > 0.009 ? (
          <Row label="погашено сьогоднішній залишок" value={-settledSameDay} indent />
        ) : null}
        <Row label="прийнято переказом сьогодні" value={cashInToday} indent />
        <div className="my-2 border-t border-border" />
        <Row
          label="У КАСІ ЗА ЯГОДУ"
          value={berryCash}
          strong
          tone={berryCash < 0 ? 'bad' : undefined}
        />
      </div>

      {berryCash < 0 ? (
        <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive">
          Каса за ягоду пішла в мінус: наділ не покриває цього дня. Це не помилка вводу —
          це означає, що видали більше, ніж на точці було грошей на ягоду.
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Видача стоїть двома рядками навмисно: на точці 2 за пʼять днів нарахували
        1 012 883 ₴, а видали 1 313 158 ₴ — на 300 275 ₴ більше, бо гасили давні борги.
        Одне число «видано» цього не пояснює.
      </p>
    </div>
  )
}
