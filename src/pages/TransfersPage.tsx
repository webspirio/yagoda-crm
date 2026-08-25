import * as React from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Send, TriangleAlert, Undo2 } from 'lucide-react'
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
import { PointTransferHistory } from '@/components/transfers/PointTransferHistory'
import { SendTransferDialog } from '@/components/transfers/SendTransferDialog'
import { TransferStateBadge } from '@/components/transfers/TransferStateBadge'
import { cashStanding, crateStanding, owedToPoints, sum } from '@/lib/calc'
import { addDays, num, shortDate, uah, uahAuto, weekday } from '@/lib/format'
import { CASH_BOOK_FROM, SEASON_START, TODAY } from '@/lib/seed'
import { useScope, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { ISODate, Transfer } from '@/lib/types'

/** «—», а не 0: наділу на цю дату ще не призначали (`21 §5`, спільне правило пʼяти екранів). */
const money = (v: number | null) => (v === null ? '—' : uahAuto(v))

/** Найпізніший документ: спершу день, потім час відправлення. */
const latest = (list: Transfer[]) =>
  list.reduce((best, t) =>
    t.date > best.date || (t.date === best.date && t.sentTime > best.sentTime) ? t : best,
  )

/**
 * Н18 · Перекази й заборгованість перед точками (`21 §5`, `§7`; реалізує `M44` і `M45` з
 * боку керівника; сценарії `UC-36`, `UC-37`).
 *
 * Один список усіх точок: наділ, скільки в касі, скільки не хватає, скільки ящиків у мінусі
 * і що зараз їде дорогою. «Чи буде відображатися на сторінці керівника заборгованість перед
 * точками?» (1187) — оце вона і є.
 *
 * Чотири рішення, які легко «полагодити» назад і які тут навмисно так:
 *
 * 1. **Екран бачить ЛИШЕ керівник, і приймальникові не малюється жодного числа.** Не
 *    «показати і заблокувати»: заборгованість перед іншими точками — не його справа
 *    (`21 §7`, `G16`). Маршрут теж керівницький, тому на точці цей чанк навіть не
 *    завантажується.
 * 2. **Дата ЛОКАЛЬНА**, як на Н8 і Н10: `useState` від `workDate`, і `‹ ›` НЕ кличуть
 *    `setWorkDate`. Керівник дивиться вчорашній день, поки на пунктах іде сьогоднішня торгівля.
 *    Наслідок, який названий на екрані вголос: надіслати можна лише з сьогоднішнього дня,
 *    бо документ народжується сьогоднішнім числом.
 * 3. **Стан рахується з документів, а не з дня.** Заявлений «не сходиться» і виїхалий «у
 *    дорозі» лишаються видними, поки їх хтось не закрив, — навіть якщо вони вчорашні: обидва
 *    не рухають ні касу, ні наділ (`I68`), тому мовчки зникнути вони не мають права.
 *    А «прийняв» показується лише за той день, на який дивимось: підтвердження триденної
 *    давнини — не новина, це просто історія, і вона є в розгорнутому рядку.
 * 4. **Таблиця читає рушій напряму, а не через `useCashStanding`.** Не з примхи:
 *    `points.map(useCashStanding)` — це виклик хука в колбеку, тобто `react/rules-of-hooks`
 *    червоним. Тому багатоточковий список кличе ті самі `cashStanding()`/`crateStanding()` з
 *    тією самою `CASH_BOOK_FROM`, що й хуки, а односторінкові однокрапкові місця (форма
 *    надсилання й розгорнута історія) користуються саме хуками. Дві дороги, один рушій і
 *    одна дата відкриття книги — розійтися їм нема на чому.
 */
export function TransfersPage() {
  // Без селектора свідомо: рядок точки складається з восьми масивів стору, і підписатися на
  // них поштучно означає вісім шансів забути один — рівно те, від чого рятують хуки каси.
  const st = useStore()
  const { role } = useScope()
  const [date, setDate] = React.useState<ISODate>(st.workDate)
  const [openPointId, setOpenPointId] = React.useState<string | null>(null)
  const [form, setForm] = React.useState<{ pointId: string; originalId: string | null } | null>(
    null,
  )

  // Роль перевіряється ПЕРЕД будь-яким числом: приймальник не бачить ні таблиці, ні
  // підсумку, ні станів — нічого, що стосується інших точок (`21 §7`).
  if (role !== 'owner') {
    return (
      <div className="mx-auto max-w-xl">
        <PageHeader
          eyebrow="Керівництву"
          title="Перекази"
          description="Цей розділ доступний лише керівникові."
        />
      </div>
    )
  }

  // Точки БЕЗ наділу каси сюди не потрапляють. Це не фільтр «для краси»: каса бази —
  // поза обсягом фаз 5-6 (`21 §9`, `Q-17`: база це керівник, свого підзвіту в неї немає).
  // Без цього рядка «Склад» стояв у таблиці боргів із відʼємною касою — числом, якого не
  // існує, бо книги в нього немає взагалі. Знайдено ручним обходом, не тестом.
  const active = st.points.filter(
    (p) => p.active && st.cashFloats.some((f) => f.pointId === p.id),
  )
  const nameOf = (id: string) => st.points.find((p) => p.id === id)?.name ?? id

  const rows = owedToPoints(active, (pointId) => ({
    cash: cashStanding({
      pointId,
      date,
      openedOn: CASH_BOOK_FROM,
      floats: st.cashFloats,
      receptions: st.receptions,
      payouts: st.payouts,
      transfers: st.transfers,
      issues: st.crateIssues,
      returns: st.crateReturns,
    }),
    crates: crateStanding({
      pointId,
      date,
      allotments: st.crateAllotments,
      issues: st.crateIssues,
      returns: st.crateReturns,
      shipments: st.crateShipments,
      transfers: st.transfers,
    }),
  }))

  // Через sum(), а не через `+`: звичайне додавання дає тут 505043.49000000005 — саме той
  // клас похибки, від якого в цьому рушії існує round2.
  const totalOwed = sum(rows, (r) => r.owed ?? 0)
  const totalCratesMissing = -rows.reduce((n, r) => n + r.crateShortfall, 0)

  /**
   * Що показувати в колонці «стан». Незакритий документ живе далі свого дня, підтвердження —
   * ні: див. рішення 3 у шапці файла.
   */
  const stateOf = (pointId: string) => {
    const mine = st.transfers.filter((t) => t.pointId === pointId && t.date <= date)
    const disputedOnes = mine.filter((t) => t.status === 'disputed')
    if (disputedOnes.length) return latest(disputedOnes)
    const onTheRoad = mine.filter((t) => t.status === 'sent')
    if (onTheRoad.length) return latest(onTheRoad)
    const acceptedToday = mine.filter((t) => t.status === 'accepted' && t.date === date)
    return acceptedToday.length ? latest(acceptedToday) : null
  }

  const disputes = st.transfers
    .filter((t) => t.status === 'disputed' && t.date <= date && active.some((p) => p.id === t.pointId))
    .sort((a, b) => b.date.localeCompare(a.date))

  // Документ народжується сьогоднішнім числом (`sendTransfer` ставить `TODAY`), тому з
  // минулого дня надіслати не можна: кнопка, яка створює запис іншою датою, ніж показує
  // екран, — це тиха помилка, а не зручність.
  const canSend = date === TODAY
  const original = form?.originalId
    ? (st.transfers.find((t) => t.id === form.originalId) ?? null)
    : null

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={`Керівництву · ${weekday(date)}`}
        title="Перекази"
        description="Скільки база винна кожній точці до її наділу і скільки порожніх ящиків має привезти. Перевізник везе гроші й ящики однією поїздкою; поки точка не натисне «Прийняв», ні те, ні те їй не зараховане."
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
            {canSend ? null : (
              <Button variant="outline" size="sm" onClick={() => setDate(TODAY)}>
                Сьогодні
              </Button>
            )}
          </>
        }
      />

      <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border pb-3">
          <Eyebrow>Заборгованість перед точками</Eyebrow>
          <div className="text-right">
            <span className="mr-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              разом
            </span>
            <span className="font-mono text-lg font-semibold tabular-nums">
              {uah(totalOwed, { decimals: 2 })}
            </span>
            <div className="font-mono text-xs text-muted-foreground tabular-nums">
              ящиків {num(totalCratesMissing)}
            </div>
          </div>
        </div>

        {active.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Жодна точка зараз не працює.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg ring-1 ring-foreground/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Точка</TableHead>
                  <TableHead className="text-right">наділ</TableHead>
                  <TableHead className="text-right">у касі</TableHead>
                  <TableHead className="text-right">не хватає</TableHead>
                  <TableHead className="text-right">ящиків</TableHead>
                  <TableHead className="text-right">стан</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const state = stateOf(r.pointId)
                  const expanded = openPointId === r.pointId
                  // Мінус — це «в мінусі має бути 140» (1049): ящики, яких на точці зараз
                  // немає. Знак ставиться ТУТ, у змінній, а не всередині форматера.
                  const cratesMissing = -r.crateShortfall
                  return (
                    <React.Fragment key={r.pointId}>
                      <TableRow className={cn(expanded ? 'bg-muted/40' : null)}>
                        <TableCell>
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-left font-medium hover:text-primary"
                            aria-expanded={expanded}
                            onClick={() => setOpenPointId(expanded ? null : r.pointId)}
                          >
                            <ChevronDown
                              className={cn(
                                'size-4 shrink-0 text-muted-foreground transition-transform',
                                expanded ? null : '-rotate-90',
                              )}
                            />
                            {nameOf(r.pointId)}
                          </button>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {money(r.float)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {uahAuto(r.berryCash)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold tabular-nums">
                          {money(r.owed)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            'text-right font-mono tabular-nums',
                            r.crateShortfall > 0 ? 'text-[var(--amber)]' : null,
                          )}
                        >
                          {num(cratesMissing)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {state ? <TransferStateBadge status={state.status} /> : null}
                            {canSend ? (
                              <Button
                                size="sm"
                                variant={state ? 'outline' : 'default'}
                                onClick={() =>
                                  setForm({ pointId: r.pointId, originalId: null })
                                }
                              >
                                <Send className="size-3.5" />
                                Надіслати
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                      {expanded ? (
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={6} className="p-0">
                            <PointTransferHistory pointId={r.pointId} date={date} />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </React.Fragment>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {canSend ? null : (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Ви дивитесь минулий день. Переказ завжди народжується сьогоднішнім числом, тому
            надіслати звідси не можна — поверніться на сьогодні.
          </p>
        )}

        {/* ---------- РОЗБІЖНОСТІ · заявка точки, яку закриває керівник ---------- */}
        {disputes.length ? (
          <div className="mt-5 flex flex-col gap-2">
            {disputes.map((t) => (
              <div
                key={t.id}
                className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-medium">{nameOf(t.pointId)}</span>: відправлено{' '}
                    {uahAuto(t.cash)} і {num(t.crates)} ящ., точка нарахувала{' '}
                    {t.reportedCash === undefined ? '—' : uahAuto(t.reportedCash)} і{' '}
                    {t.reportedCrates === undefined ? '—' : num(t.reportedCrates)} ящ.
                  </div>
                  {t.disputeNote ? (
                    <div className="mt-1 text-xs opacity-90">«{t.disputeNote}»</div>
                  ) : null}
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canSend}
                      onClick={() => setForm({ pointId: t.pointId, originalId: t.id })}
                    >
                      <Undo2 className="size-3.5" />
                      Сторнувати і подати заново
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <p className="mt-5 border-t border-border pt-3 text-sm leading-relaxed text-muted-foreground">
          Поки точка не натиснула «Прийняв», ні гроші, ні ящики їй не зараховані — тому виїхалий
          переказ борг не зменшує.
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          «Не сходиться» — це заявка точки, і вона теж не рухає нічого: розбіжність закриває
          керівник новим документом, а на точці цю цифру не правлять. Гасити борг можна
          частинами: сума в формі підставлена повністю, але її можна зменшити. Прочерк у
          колонці «наділ» означає, що наділу цій точці ще не призначали, — це не нуль.
        </p>
      </div>

      <SendTransferDialog
        open={form !== null}
        onOpenChange={(v) => {
          if (!v) setForm(null)
        }}
        pointId={form ? form.pointId : null}
        pointName={form ? nameOf(form.pointId) : ''}
        date={date}
        original={original}
      />
    </div>
  )
}
