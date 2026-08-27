import { Eyebrow } from '@/components/common/bits'
import { longDate, num } from '@/lib/format'
import { cn } from '@/lib/utils'
import { crateWord } from './helpers'
import type { CrateStanding } from '@/lib/calc'
import type { CrateAllotment } from '@/lib/types'

/**
 * Смужка складу наділу (`21 §Н14`). Це дослівна вимога клієнтки, і вона просила саме
 * ВИГЛЯД, а не звіт: «щоб вони знали, що на користуванні в них люди користуються 300
 * ящиків, 100 ящиків в них пустих. І от ми должні там 65 і щоб ця сумарність була 600…
 * щоб вони візуально це бачили» (1128–1129).
 *
 * Тому під трьома числами стоїть четвертий рядок — сама тотожність `I61`
 * («800 = 341 + 195 + 264»). Він нічого не додає до даних і саме тому потрібен: це та
 * «сумарність», яку вона просила бачити очима, а не перевіряти в голові.
 *
 * ЖОДНОГО ПІДРАХУНКУ ТУТ НЕМАЄ. Усі п'ять чисел приходять із `crateStanding()`; навіть
 * ширини смужок беруться з них, а не рахуються заново.
 *
 * `compact` — той самий склад наділу в панелі «Стан точки» на прийомці, де приймальник
 * тримає весь свій день на одному екрані. ВАРІАНТ, А НЕ ДРУГИЙ КОМПОНЕНТ, і це рішення:
 * тотожність `800 = 341 + 195 + 264` — те єдине, що клієнтка просила бачити ОЧИМА
 * (1128–1129), і другий її рендерер розійшовся б із першим мовчки, без жодного червоного
 * тесту. Компактний варіант знімає лише хром сторінки — картку-обгортку, рядок «з якої
 * дати й хто призначив» і блок «Не хватає до наділу»; смужка, три числа, тотожність і
 * червоне попередження про пробитий наділ лишаються ті самі.
 */
export function CrateStandingBar({
  standing,
  record,
  compact = false,
}: {
  standing: CrateStanding
  /** Не потрібен у `compact`: рядок походження наділу там не малюється */
  record?: CrateAllotment | null
  compact?: boolean
}) {
  const { allotment, onHand, inField, atBase, shortfall } = standing
  // Наділу немає — «—», і НІКОЛИ 0: нуль стверджував би, що ящиків на точці нема, тоді
  // як насправді ми просто не знаємо, скільки їх має бути. Обидва поля перевіряються
  // разом, бо рушій віддає їх разом: без наділу `onHand` теж `null`.
  const known = allotment !== null && onHand !== null
  const short = onHand !== null && onHand < 0

  // Ширини смужки. Від'ємні пусті в смужці не малюються — від'ємної ширини не буває;
  // те, що наділ пробитий, каже окремий рядок нижче, а не зникла заливка.
  const bars = [
    { key: 'onHand', value: Math.max(0, onHand ?? 0), className: 'bg-[var(--leaf)]' },
    { key: 'inField', value: Math.max(0, inField), className: 'bg-[var(--amber)]' },
    { key: 'atBase', value: Math.max(0, atBase), className: 'bg-primary' },
  ]
  const barTotal = bars.reduce((s, b) => s + b.value, 0)

  return (
    <div className={compact ? undefined : 'rounded-xl bg-card p-5 ring-1 ring-foreground/10'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex items-baseline gap-2">
          <Eyebrow>Наділ</Eyebrow>
          <span
            className={cn(
              'font-mono leading-none font-semibold',
              compact ? 'text-2xl' : 'text-3xl',
              known ? undefined : 'text-muted-foreground',
            )}
          >
            {known ? num(allotment) : '—'}
          </span>
          {known ? <span className="text-sm text-muted-foreground">{crateWord(allotment)}</span> : null}
        </div>
        {compact ? null : (
          <div className="text-xs text-muted-foreground">
            {record
              ? `з ${longDate(record.effectiveFrom)} · ${record.setBy}`
              : 'наділу цій точці ще не призначали'}
          </div>
        )}
      </div>

      <div
        className={cn(
          'flex w-full gap-[2px] overflow-hidden rounded-full bg-muted',
          compact ? 'mt-3 h-2' : 'mt-4 h-2.5',
        )}
      >
        {barTotal > 0
          ? bars.map((b) => (
              <div
                key={b.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', b.className)}
                style={{ width: `${(b.value / barTotal) * 100}%` }}
              />
            ))
          : null}
      </div>

      <div className={cn('grid', compact ? 'mt-3 grid-cols-3 gap-2' : 'mt-4 gap-3 sm:grid-cols-3')}>
        <Figure
          label="Пустих на точці"
          value={known ? num(onHand) : '—'}
          dot="bg-[var(--leaf)]"
          tone={short ? 'text-destructive' : undefined}
          compact={compact}
        />
        <Figure label="У людей" value={num(inField)} dot="bg-[var(--amber)]" compact={compact} />
        <Figure label="У нас з ягодою" value={num(atBase)} dot="bg-primary" compact={compact} />
      </div>

      {known ? (
        <p className={cn('font-mono text-xs text-muted-foreground', compact ? 'mt-2.5' : 'mt-3')}>
          {num(allotment)} = {num(onHand)} + {num(inField)} + {num(atBase)}
        </p>
      ) : null}

      {compact ? null : (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-border pt-3">
          <span className="text-sm font-medium">Не хватає до наділу:</span>
          <span className="font-mono text-lg font-semibold">{known ? num(shortfall) : '—'}</span>
          <span className="text-xs text-muted-foreground">
            (у людей {num(inField)} + у нас {num(atBase)})
          </span>
        </div>
      )}

      {short ? (
        <p
          className={cn(
            'mt-2 font-medium text-destructive',
            compact ? 'text-xs leading-relaxed' : 'text-sm',
          )}
        >
          Наділ не покриває цього дня: пустих на точці менше, ніж нуль. Взяти їх нема
          звідки, поки не повернуть люди або не привезе база.
        </p>
      ) : null}
    </div>
  )
}

function Figure({
  label,
  value,
  dot,
  tone,
  compact,
}: {
  label: string
  value: string
  dot: string
  tone?: string
  compact?: boolean
}) {
  /*
    У ВУЗЬКІЙ КОЛОНЦІ ПРИЙОМКИ ЧИСЛО СТОЇТЬ ПЕРШИМ, А ПІДПИС ПІД НИМ — і це не смак.
    Підписи мають різну довжину («У людей» — рядок, «Пустих на точці» — два), тому при
    порядку «підпис зверху» три числа сідають на різні базові лінії й перестають
    порівнюватися очима — а порівняти їх і є вся робота цієї смужки. Обрізати підписи
    («ПУСТИХ НА Т…») не можна: різниця між ними саме в останньому слові. Скоротити їх у
    компактному варіанті — теж ні: тоді те саме число називалося б по-різному на «Ящиках»
    і на прийомці.
  */
  if (compact) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn('size-2 shrink-0 rounded-[3px]', dot)} />
          <span className={cn('font-mono text-lg leading-none font-semibold', tone)}>
            {value}
          </span>
        </div>
        <Eyebrow className="mt-1 leading-tight">{label}</Eyebrow>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('size-2.5 shrink-0 rounded-[3px]', dot)} />
      <div className="min-w-0">
        <Eyebrow className="truncate">{label}</Eyebrow>
        <div className={cn('mt-0.5 font-mono text-xl leading-none font-semibold', tone)}>
          {value}
        </div>
      </div>
    </div>
  )
}
