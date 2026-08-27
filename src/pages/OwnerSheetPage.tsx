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
import { PageHeader } from '@/components/common/bits'
import { networkAverage } from '@/lib/calc'
import { addDays, kg, longDate, num, shortDate, uah, uahAuto, weekday } from '@/lib/format'
import { useScope, useStore } from '@/lib/store'
import type { ISODate } from '@/lib/types'

/**
 * ╔══════════════════════════════════════════════════════════════════════════════════╗
 * ║ АРКУШ ПОПЕРЕДНІЙ. Зроблений ЗІ СТЕНОГРАМИ, до отримання дії `A-14` («Зразок      ║
 * ║ аркуша середньої ціни, який вона рахує руками; Юля, Viber»). Станом на           ║
 * ║ 24.08.2026 `A-14` НЕ ЗАКРИТА, зразка немає, і замовник вирішив робити без нього, ║
 * ║ знаючи ризик `R-13` (`docs/14`): формульна частина відновлена зі стенограми, у   ║
 * ║ якій розробник сам сказав «трішки заплутався».                                   ║
 * ║                                                                                  ║
 * ║ Тому цей аркуш НЕ УЗГОДЖЕНИЙ і найімовірніше переробиться ЦІЛКОМ, коли зразок    ║
 * ║ прийде. Наступний читач не має права вважати його погодженим із клієнтом.        ║
 * ╚══════════════════════════════════════════════════════════════════════════════════╝
 *
 * Н13 · Аркуш керівника (`M39`). Номер саме **Н13**, а не Н12: `Н12` у `docs/09 §5` уже
 * зайнятий — це «Маркер і підказка» (`SupplierPicker.tsx`). Наступний читач писав би спеку
 * з цього коментаря, тому колізію виправлено тут, а не в документі.
 *
 * Побудований РІВНО за дослівною цитатою клієнта (дзвінок №4, ряд. 828–834):
 *
 * > «на керівника малина середня ціна, вага, сума, потом ожина… А в кінці такий
 * > полосочка і написано, скільки кілограм вообще»
 *
 * Тобто рядок на кожну ягоду — **вага · середня ціна · сума** — і знизу **смужка**:
 * разом кілограмів і разом сума. Оскільки зразка немає, кожна колонка понад ці —
 * вигадана, і її доведеться прибирати, коли зразок прийде. Тому тут НЕМА і не має
 * зʼявитися: ні недостачі, ні собівартості окремою колонкою, ні пулу, ні відсотків,
 * ні часток, ні попунктних колонок. Порожній є навмисно і один — клітинка «середня
 * ціна» у смужці: клієнт назвала там кілограми й суму, середньої не називала, а
 * дописати її означало б додати число від себе.
 *
 * Чотири речі, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. **Числа беруться з `networkAverage()`, і тільки звідти.** Вага — `kg` (наша вага
 *    після переважування, Σ kgBase по пунктах), середня ціна — `avg` (зважена, cost/kg),
 *    сума — `cost`, смужка — `total.kg` і `total.cost`. Інакше той самий день на Н10 і
 *    на аркуші показував би різні цифри.
 * 2. **Дата ЛОКАЛЬНА**, як на Н8 і Н10: `useState` від `workDate`, і `‹ ›` НЕ кличуть
 *    `setWorkDate`. Керівник друкує вчорашній аркуш, поки на пунктах іде сьогоднішня
 *    торгівля.
 * 3. **День, у якому не переважений жоден пункт** (`awaitingReweigh` від рушія), аркушем
 *    не друкується взагалі: спокійний бейдж «Очікує переважування» замість таблиці. Нулі
 *    в цьому стані були б неправдою — ягода не зникла, її просто ще не зважили.
 * 4. **Позначка неповного дня** при `!reconciliation.ok` — ВСЕРЕДИНІ `.printable`, тобто й
 *    на папері. День, у якому зведені не всі пункти, друкувався тут як повний: зміряно на
 *    29.07.2026 — аркуш дає `РАЗОМ 906,04 кг · 127 241,69 ₴`, а Попівці (`p4`) того дня не
 *    зведені, і їхні `139,88 кг` з `17 419,07 ₴` нарахованого та `4 430,00 ₴` витрат у ці
 *    числа не входять: `розбіжність −21 849,07 ₴`, 14 % дня. Н10 на тому самому дні пише
 *    про це двома рядками, аркуш не писав нічого.
 *    Це НЕ порушує правила «жодної вигаданої колонки» з абзацу вище: колонок як не було,
 *    так і немає — додано попередження про НЕПОВНОТУ тих самих чисел. Папір, який виходить
 *    із будівлі з числами, про неповноту яких застосунок ЗНАЄ, — гірше за зайву колонку.
 */
export function OwnerSheetPage() {
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const receptions = useStore((s) => s.receptions)
  const reweighs = useStore((s) => s.reweighs)
  const expenses = useStore((s) => s.expenses)
  const policies = useStore((s) => s.policies)
  const workDate = useStore((s) => s.workDate)
  const { role } = useScope()
  const config = useStore((s) => s.config)

  const [date, setDate] = React.useState<ISODate>(workDate)

  // «тільки керівник має до цього всього доступ» — дзвінок №4, ряд. 617–621
  if (role !== 'owner') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Керівництву"
          title="Аркуш керівника"
          description="Цей розділ доступний лише керівникові."
        />
      </div>
    )
  }

  const net = networkAverage({
    date,
    points,
    receptions,
    berries,
    reweighs,
    expenses,
    policies,
  })

  const nothingReceived = net.pointIds.length === 0
  const awaiting = net.awaitingReweigh
  const empty = !nothingReceived && !awaiting && net.products.length === 0

  // Звірка мережі (`I46`) — те саме число, що Н10 друкує рядком «Розбіжність …». Тут воно
  // потрібне не як число в колонці, а як умова позначки: `ok === false` означає, що
  // собівартість мережі не дорівнює нарахованому з витратами, тобто аркуш неповний.
  const rec = net.reconciliation
  // Назви пунктів, які того дня не зведені (`status === 'awaiting-reweigh'`, той самий
  // критерій, що підписує колонку «не зведено» на Н10). Саме вони і є звичайна причина
  // розбіжності: їхня ягода з грошима у числа аркуша не входить.
  const notSummed = net.pointIds
    .filter((id) => net.byPoint.get(id)?.status === 'awaiting-reweigh')
    .map((id) => points.find((p) => p.id === id)?.name ?? id)

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow={`Керівництву · ${weekday(date)}`}
        title="Аркуш керівника"
        description="Один лист на день: рядок на кожну ягоду — вага, середня ціна, сума — і смужка разом унизу."
        actions={
          <>
            {/* Дата ЛОКАЛЬНА: setWorkDate тут не викликається жодного разу */}
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

      {/* Усе, що йде на папір, лежить ВСЕРЕДИНІ цієї обгортки; кнопки — поза нею.
          Класи оголошує src/index.css (іменована сторінка `@page landscape-sheet`);
          ця сторінка їх лише навішує, так само як CostOfDayPage. */}
      <div className="printable print-landscape rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        {/* Шапка для паперу: на екрані дату видно з PageHeader, на аркуші її мусить
            бути видно окремо — інакше надрукований лист не має дати. */}
        <div className="print-only mb-4">
          <div className="font-display text-lg font-semibold">
            Аркуш керівника за {longDate(date)}
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
          <span className="font-display text-lg leading-none font-medium">{longDate(date)}</span>
          <span className="font-mono text-xs text-muted-foreground">{weekday(date)}</span>
          {awaiting ? (
            <Badge
              variant="outline"
              className="ml-auto border-[var(--amber)]/40 text-[var(--amber)]"
            >
              Очікує переважування
            </Badge>
          ) : null}
        </div>

        {/* ---------- ПОЗНАЧКА НЕПОВНОГО ДНЯ ----------
            Стоїть ПЕРЕД таблицею і ВСЕРЕДИНІ `.printable`: на папері попередження після
            чисел прочитали б уже після того, як числа переписали. Заливка `bg-[var(--amber)]`
            друкується (index.css: `print-color-adjust: exact` рівно для тих класів, де колір
            несе зміст), тому на аркуші це не сірий текст, а видима смуга.

            Умова та сама, що в підпису під таблицею, плюс `rec.ok`: позначка потрібна саме
            там, де аркуш ДРУКУЄ ЧИСЛА. У станах «прийомки не було», «очікує переважування»
            і «переважених товарів немає» чисел на папері немає взагалі, а про незведений
            день там уже говорять бейдж і абзац — друга копія того самого попередження лише
            вчила б його не читати. */}
        {nothingReceived || awaiting || empty || rec.ok ? null : (
          <div className="mb-4 flex items-start gap-2 rounded-lg bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--amber)]">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            <span className="leading-relaxed">
              <span className="font-semibold">Цей аркуш — не весь день.</span> Розбіжність{' '}
              <span className="font-mono">{uah(rec.diff, { decimals: 2, sign: true })}</span>
              {notSummed.length
                ? `: того дня не зведено ${notSummed.join(', ')} — ягода й гроші цього пункту в числа нижче не входять.`
                : ': собівартість мережі не дорівнює нарахованому з витратами.'}{' '}
              Перед тим як віддавати лист, день треба звести на «Переважуванні».
            </span>
          </div>
        )}

        {nothingReceived ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Цього дня прийомки не було.
          </p>
        ) : awaiting ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Того дня не переважений жоден пункт — аркуш ще нічого не показує. Числа
            зʼявляться після переважування.
          </p>
        ) : empty ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Цього дня переважених товарів немає.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>товар</TableHead>
                  <TableHead className="text-right">вага</TableHead>
                  <TableHead className="text-right">середня ціна, ₴/кг</TableHead>
                  <TableHead className="text-right">сума</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* «на керівника малина середня ціна, вага, сума, потом ожина» — рядок на
                    кожну ягоду, і більше в рядку нічого. Порядок рядків — від рушія
                    (за вагою), він же порядок решти екранів. */}
                {net.products.map((r) => (
                  <TableRow key={r.product}>
                    <TableCell className="font-medium uppercase">{r.product}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {kg(r.kg)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {/* `avg` — число з рушія; null («—») буває при нульовій вазі.
                          НІКОЛИ «NaN» і ніколи «0,00» замість порожнього. */}
                      {r.avg === null ? '—' : num(r.avg, 2)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {uahAuto(r.cost)}
                    </TableCell>
                  </TableRow>
                ))}
                {/* «А в кінці такий полосочка і написано, скільки кілограм вообще» —
                    смужка: разом кілограмів і разом сума. Клітинка середньої ціни тут
                    порожня навмисно (див. заголовок файлу). */}
                <TableRow className="border-t-2 border-border">
                  <TableCell className="font-semibold">РАЗОМ</TableCell>
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {kg(net.total.kg)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono font-semibold tabular-nums">
                    {uahAuto(net.total.cost)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}

        {/* Рівно ОДИН рядок-підпис, не колонка: без нього аркуш друкує числа без назви. */}
        {nothingReceived || awaiting || empty ? null : (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Вага — наша вага після переважування; сума — собівартість цієї ягоди, а середня
            ціна — сума, поділена на вагу.
          </p>
        )}
      </div>
    </div>
  )
}
