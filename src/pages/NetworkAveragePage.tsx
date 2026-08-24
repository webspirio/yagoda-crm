import * as React from 'react'
import { ChevronLeft, ChevronRight, Printer, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { networkAverage } from '@/lib/calc'
import {
  addDays,
  kg,
  longDate,
  num,
  plural,
  shortDate,
  uah,
  uahAuto,
  weekday,
} from '@/lib/format'
import { SEASON_START, TODAY } from '@/lib/seed'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Violation } from '@/lib/calc'
import type { ISODate } from '@/lib/types'

/**
 * Ставки друкуються ЧОТИРМА знаками, як і на Н8: саме на четвертому видно роздачу копійок
 * (`09 §3.4`).
 *
 * Три різні «нічого» зводяться в один символ «—», і жодне з них не «0,00». `undefined` у
 * `byPoint` буває з ДВОХ причин, і це не одне й те саме:
 *
 * 1. пункт того дня цього товару не приймав узагалі;
 * 2. **прийняв, але не зважив** (`I50`, `kgBase === 0`) — і саме тоді порожня клітинка
 *    ХОВАЄ гроші: вага виходить із мережевої суми, а нарахована сума лишається в пулі того
 *    самого пункту. Зміряно на демо-даних, 22.07.2026, Гайове: Ожина 46,90 кг / 3 470,60 ₴
 *    стоїть порожньою клітинкою, а пул пункту через це роздувся до 7 143,12 ₴.
 *    Єдине, що про це говорить, — попередження `I50` у списку під таблицею.
 *
 * `null` — третій випадок: вага нуль, тобто ділити нема на що.
 * Нуль на цьому місці зіпсував би саму середню, а «NaN» — довіру до екрана.
 */
const rate4 = (v: number | null | undefined) => (v === null || v === undefined ? '—' : num(v, 4))

/**
 * Н10 · Середня ціна по мережі (`09 §5`, `§3.5`, `UC-32`; реалізує `M23`).
 *
 * Матриця «товар × пункт» із собівартістю кілограма в клітинці, і праві три колонки —
 * зведення по мережі: вага, сума, **зважена** середня.
 *
 * Чотири речі, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. **Дата ЛОКАЛЬНА** (`09 §5`): `useState` від `workDate`, і `‹ ›` НЕ кличуть
 *    `setWorkDate` — той самий жест, що на Н8. Керівник розбирає вчорашній день, поки на
 *    пунктах іде сьогоднішня торгівля.
 * 2. **Середня — це завжди `сума / вага`, НІКОЛИ середнє середніх.** Тут вона не рахується
 *    зовсім: `products[].avg` і `total.avg` приходять із рушія готовими.
 * 3. **Колонка бази (Склад) у таблиці Є** (`13 §4 S-22`, `M37`): склад — звичайний пункт
 *    прийому з вищими цінами, і сховати його означало б занизити мережеву середню.
 *    Порядок колонок — порядок довідника, склад колонки лишає рушій у `pointIds`.
 * 4. **Періодів немає.** Кнопки «тиждень» і «місяць» неактивні й ПІДПИСАНІ як окремий
 *    обсяг (`M28`, `D-4`, `C-03`). Формула періоду вже записана в `09 §3.5`, але це обсяг,
 *    а не невідомість; неактивний ескіз без слів був би найгіршим із варіантів. Чому саме
 *    `Button`, а не `tabs.tsx`, як просить спека — зміряна причина у коментарі біля смужки.
 *
 * Чого тут немає й не буде: рядка «Мережеві витрати нерозподілені» і «частки рейсу
 * попередньої» — скасовано цілком (`13 §1 П-2`, `I53`, `D-6`). Пул належить ПУНКТУ.
 */
export function NetworkAveragePage() {
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const receptions = useStore((s) => s.receptions)
  const reweighs = useStore((s) => s.reweighs)
  const expenses = useStore((s) => s.expenses)
  const policies = useStore((s) => s.policies)
  const workDate = useStore((s) => s.workDate)
  const role = useStore((s) => s.role)

  // Дата ЛОКАЛЬНА: `setWorkDate` на цьому екрані не викликається жодного разу (09 §5)
  const [date, setDate] = React.useState<ISODate>(workDate)

  // «тільки керівник має до цього всього доступ» — дзвінок №4
  if (role !== 'owner') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Керівництву"
          title="Середня ціна по мережі"
          description="Цей розділ доступний лише керівникові."
        />
      </div>
    )
  }

  // Політику рушій бере ПОПУНКТНО сам (`D-3`) — сюди їде весь масив, без вибору
  const net = networkAverage({ date, points, receptions, berries, reweighs, expenses, policies })
  const cols = net.pointIds
  const rec = net.reconciliation
  const awaiting = net.awaitingReweigh
  const nameOf = (id: string) => points.find((p) => p.id === id)?.name ?? id
  const notSummedPoint = (id: string) => net.byPoint.get(id)?.status === 'awaiting-reweigh'

  /**
   * Порушення всіх пунктів одним списком. Це не косметика: `I50`/`I51` — єдине, чим товар,
   * якого не переважили, лишається видним. У мережеву вагу він не входить, тому без цього
   * списку мережева звірка «зеленіла» б тихо, а ягода зникала б із таблиці без слова.
   */
  const dayFlags = cols.flatMap((id) => {
    const day = net.byPoint.get(id)
    if (!day) return []
    return day.violations.map((v) => ({
      pointId: id,
      violation: v,
      calm: day.status === 'awaiting-reweigh',
    }))
  })

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow={`Керівництву · ${weekday(date)}`}
        title="Середня ціна по мережі"
        description="Скільки нам справді став кілограм по всій мережі за цей день. Сума додається, а середня береться формулою: сума розділити на вагу."
        actions={
          <>
            {/* Дата ЛОКАЛЬНА: setWorkDate тут не викликається жодного разу (09 §5) */}
            <div className="flex items-center rounded-lg border border-border bg-card">
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-r-none"
                disabled={date <= SEASON_START}
                onClick={() => setDate(addDays(date, -1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="px-2.5 font-mono text-xs">{shortDate(date)}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="rounded-l-none"
                disabled={date >= TODAY}
                onClick={() => setDate(addDays(date, 1))}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
            {date !== TODAY ? (
              <Button variant="outline" size="sm" onClick={() => setDate(TODAY)}>
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

      {/* Аркуш на папір: усе, що друкується, лежить ВСЕРЕДИНІ обгортки, а кнопки й
          перемикачі — або поза нею, або з класом `print-hide`. Класи оголошує
          src/index.css; ця сторінка їх лише навішує, як і Н8. */}
      <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="print-only mb-4">
          <div className="font-display text-lg font-semibold">
            Середня ціна по мережі за {longDate(date)}
          </div>
          <div className="text-sm text-muted-foreground">
            {cols.length} {plural(cols.length, 'пункт', 'пункти', 'пунктів')} · денний зріз
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
          <span className="font-display text-lg leading-none font-medium">Мережа</span>
          <span className="font-mono text-xs text-muted-foreground">
            {shortDate(date)} · {weekday(date)}
          </span>
          <span className="ml-auto">
            {awaiting ? (
              <Badge variant="outline" className="border-[var(--amber)]/40 text-[var(--amber)]">
                Очікує переважування
              </Badge>
            ) : net.total.avg === null ? null : (
              <span className="font-mono text-sm font-medium">
                середня по мережі {rate4(net.total.avg)} ₴/кг
              </span>
            )}
          </span>
        </div>

        {/* ---------- ПЕРІОД · день ▪ тиждень ✕ місяць ✕ ----------

            Спека просить зробити цю смужку на `src/components/ui/tabs.tsx`, і це БУЛО
            зроблено першим заходом. Не лишилося з однієї зміряної причини: щойно `tabs.tsx`
            стає імпортованим, `knip` починає бачити його експорти поштучно, і
            `tabsListVariants` (cva-хелпер, який уживається лише всередині того файлу) вилазить
            НОВОЮ знахідкою — рівно як `buttonVariants` і `badgeVariants`, які вже лежать
            записами в `baselines/dead-exports.json`. Перевірено, не припущено:
            `npm run deadcode` дав «НОВА ЗНАХІДКА: export tabsListVariants у
            src/components/ui/tabs.tsx — не в baseline».

            Дописати її в baseline означало б позеленіти, розширивши виняток, — а це не
            позеленіти (`CLAUDE.md`, правило 3). Зняти `export` у вендорованому примітиві
            shadcn — каскад на `.oxlintrc.json` і `baselines/lint-exempt.json`, які поза межею
            цієї роботи. Тому смужка стоїть на `Button`, а запис `tabs.tsx` лишився в baseline
            недоторканим.

            Перемикач на папері не потрібен — тому `print-hide`. */}
        <div className="print-hide flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              aria-current="page"
              className="border-foreground/25 bg-muted font-medium"
            >
              день
            </Button>
            {/* `M28` — окремий обсяг (`D-4`, `C-03`). Неактивна кнопка БЕЗ підпису була б
                найгіршим варіантом: людина читала б її як поломку, а не як межу обсягу.
                Формула періоду вже записана в `09 §3.5` — це обсяг, а не невідомість. */}
            <Button variant="outline" size="sm" disabled>
              тиждень
            </Button>
            <Button variant="outline" size="sm" disabled>
              місяць
            </Button>
          </div>
          <span className="text-xs text-muted-foreground">
            тиждень і місяць — окремий обсяг, у цій фазі не робимо
          </span>
        </div>

        <div className="mt-4">
          {cols.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Цього дня в мережі ягоди не приймали і витрат не заводили.
            </p>
          ) : (
            <>
              {awaiting ? (
                /* Ні пулу, ні недостачі тут НЕ друкуємо — те саме рішення, що на Н8:
                   без переважування загальна формула читає всю вагу дня як недостачу, і
                   пул роздутий на ціну всієї ягоди. Називаємо саме РУЧНІ витрати —
                   рівно те число, яке називає і сам рушій у тексті `I51`. */
                <div className="rounded-lg bg-[var(--amber)]/10 px-4 py-3 text-[var(--amber)]">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium">Очікує переважування</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {uah(rec.expensesManual, { decimals: 2 })} не розподілено
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed opacity-90">
                    Того дня жоден пункт мережі ще не переважений, тому собівартості
                    кілограма поки немає ні по товарах, ні по мережі: ділити нема на що.
                    Ягода не зникла — її просто ще не зважили на базі.
                  </p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Товар</TableHead>
                        {/* Порядок колонок — порядок довідника; склад (`база`) серед них
                            звичайна колонка (`13 §4 S-22`, `M37`) */}
                        {cols.map((id) => (
                          <TableHead key={id} className="text-right">
                            {nameOf(id)}
                            {notSummedPoint(id) ? (
                              <span className="block text-[10px] font-normal text-[var(--amber)]">
                                не зведено
                              </span>
                            ) : null}
                          </TableHead>
                        ))}
                        {/* «НАША вага», не «вага»: тут стоїть Σ `kgBase` — вага після
                            переважування, а Н8 словом «вага» називає `kgPoint` і те саме
                            `kgBase` підписує «наша вага». Одне слово на два різні числа —
                            це те, що клієнт читав би як помилку (словник, `11 §A`). */}
                        <TableHead className="border-l border-border text-right">
                          наша вага
                        </TableHead>
                        <TableHead className="text-right">сума</TableHead>
                        <TableHead className="text-right">середня</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {net.products.map((r) => (
                        <TableRow key={r.product}>
                          <TableCell className="font-medium uppercase">{r.product}</TableCell>
                          {cols.map((id) => (
                            <TableCell
                              key={id}
                              className={cn(
                                'text-right font-mono tabular-nums',
                                r.byPoint.has(id) ? null : 'text-muted-foreground',
                              )}
                            >
                              {rate4(r.byPoint.get(id))}
                            </TableCell>
                          ))}
                          <TableCell className="border-l border-border text-right font-mono tabular-nums">
                            {kg(r.kg)}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {uahAuto(r.cost)}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold tabular-nums">
                            {rate4(r.avg)}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="border-t-2 border-border">
                        <TableCell className="font-semibold">РАЗОМ</TableCell>
                        {/* «—» під кожним пунктом стоїть за ескізом (`09 §5`) свідомо:
                            підсумок по одному пункту — це вже Н8, і друга цифра на те
                            саме питання на одному аркуші тільки збиває. */}
                        {cols.map((id) => (
                          <TableCell key={id} className="text-right text-muted-foreground">
                            —
                          </TableCell>
                        ))}
                        <TableCell className="border-l border-border text-right font-mono font-semibold tabular-nums">
                          {kg(net.total.kg)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {uahAuto(net.total.cost)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {rate4(net.total.avg)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* ---------- МЕРЕЖЕВА ЗВІРКА · `I46` видимим рядком, не assert у тесті ---------- */}
              <div className="mt-4 flex flex-col gap-2">
                {awaiting ? (
                  /* Чому в цьому стані не друкується САМЕ число собівартості: воно
                     дорівнює НУЛЮ. При нульових вагах `allocateByLargestRemainder()`
                     віддає нулі (`calc.ts`: `total === 0n` → мапа нулів), тому
                     `costTotal = baseSum + alloc = 0`, тоді як пул роздутий на всю вагу
                     дня, прочитану як недостача (зміряно на 29.07.2026, Попівці:
                     `costTotal 0,00` проти пулу `21 849,07`). Друкувати «0,00 ₴
                     собівартості» на дні, коли ягоду прийняли, означало б назвати
                     неправду; тому друкується лише розбіжність — те, чи гроші сходяться. */
                  <span
                    className={cn(
                      'font-mono text-sm',
                      rec.ok ? 'text-muted-foreground' : 'text-[var(--amber)]',
                    )}
                  >
                    Мережева звірка: розбіжність {uah(rec.diff, { decimals: 2, sign: true })}{' '}
                    {rec.ok ? '✓' : '✗'}
                  </span>
                ) : (
                  <span
                    className={cn(
                      'font-mono text-sm',
                      rec.ok ? 'text-[var(--leaf)]' : 'text-[var(--amber)]',
                    )}
                  >
                    Σ собівартість {uah(rec.costTotal, { decimals: 2 })} = нараховано{' '}
                    {uahAuto(rec.paidTotal)} + витрати {uahAuto(rec.expensesManual)}{' '}
                    {rec.ok ? '✓' : '✗'}
                  </span>
                )}
                {rec.ok ? null : (
                  /* Тиха зелена галочка на розбіжності — саме те, чого тут не буде:
                     розбіжність стоїть окремим рядком і своїм числом. */
                  <span className="flex items-start gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--amber)]">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span>
                      Розбіжність {uah(rec.diff, { decimals: 2, sign: true })}: собівартість
                      мережі не дорівнює нарахованому з витратами. Дивіться порушення
                      пунктів нижче — гроші дня десь не сходяться, і це не округлення.
                    </span>
                  </span>
                )}
              </div>

              {dayFlags.length ? (
                <div className="mt-4 flex flex-col gap-1.5">
                  <Eyebrow className={awaiting ? 'text-[var(--amber)]' : undefined}>
                    {awaiting ? 'День ще не зведений' : 'Що каже рушій по пунктах'}
                  </Eyebrow>
                  {dayFlags.map((f) => (
                    <ViolationLine
                      key={f.pointId + f.violation.code + f.violation.message}
                      point={nameOf(f.pointId)}
                      violation={f.violation}
                      calm={f.calm}
                    />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Рядок-підпис знизу, дослівно з ескіза `09 §5`: пул належить ПУНКТУ, а не мережі
            (`13 §1 П-1`) — мережевим стає тільки ЗВІТ. */}
        <p className="mt-5 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
          Пул кожного пункту = його витрати + його недостача
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Порожня клітинка — або пункт того дня цього товару не приймав, або прийняв, але його
          ще не зважили: тоді про це є попередження нижче. В обох випадках у середню він не
          входить узагалі, і нуля там немає. Середня по мережі — завжди сума розділити на вагу,
          ніколи середнє середніх.
        </p>
      </div>
    </div>
  )
}

/**
 * Порушення звичайною розміткою, як на Н8 і в `DayPage.tsx`, плюс назва пункту: на мережевому
 * аркуші «Малину прийняли, а зважити забули» без пункту не має адресата.
 *
 * `calm` — стан «цей пункт ще не зведений»: за легендою `09 §4` `block` там означає «тримає
 * день у стані „не зведено“», а не «щось поламалося», тому колір бурштиновий.
 */
function ViolationLine({
  point,
  violation,
  calm,
}: {
  point: string
  violation: Violation
  calm: boolean
}) {
  const hard = violation.severity === 'block' && !calm
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm',
        hard ? 'bg-destructive/10 text-destructive' : 'bg-[var(--amber)]/10 text-[var(--amber)]',
      )}
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>
        <span className="mr-1.5 font-medium">{point}</span>
        <span className="mr-1.5 font-mono text-xs opacity-70">{violation.code}</span>
        {violation.message}
      </span>
    </div>
  )
}
