import * as React from 'react'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Eyebrow, EmptyState, PageHeader, StatTile } from '@/components/common/bits'
import { CashCountPanel } from '@/components/cash/CashCountPanel'
import { CashFloatDialog } from '@/components/cash/CashFloatDialog'
import { CashLedger } from '@/components/cash/CashLedger'
import { IncomingTransfers } from '@/components/cash/IncomingTransfers'
import { crateBalance, effectiveAt, reconcileDay } from '@/lib/calc'
import { addDays, longDate, num, plural, shortDate, uah, weekday } from '@/lib/format'
import { scopedPayouts, scopedReceptions, useCashStanding, useScope, useStore } from '@/lib/store'
import type { CrateIssue, CrateReturn, ISODate } from '@/lib/types'

/**
 * Скільки ящиків стоїть за завдатками, які лежать у шухляді. Рушій віддає ГРОШІ
 * (`crateCash`), а це — їхній склад: у людей 195 ящиків, але 80 із них узяті за розписку,
 * і грошей за них ми не брали взагалі (`I66`). Тому «завдатків за 115 ящиків», а не за 195.
 *
 * Кількість, не гроші: тут рахується штука, і жоден форматер грошей цього не бачить.
 */
function depositUnits(
  issues: CrateIssue[],
  returns: CrateReturn[],
  pointId: string,
  date: ISODate,
) {
  const mine = issues.filter((i) => i.pointId === pointId && i.date <= date)
  const back = returns.filter((r) => r.pointId === pointId && r.date <= date)
  return [...new Set(mine.map((i) => i.supplierId))].reduce(
    (n, supplierId) => n + crateBalance(supplierId, mine, back).deposit,
    0,
  )
}

/**
 * Н17 · Каса точки (`21 §5`, реалізує `M45` з боку точки).
 *
 * П'ЯТЬ РІШЕНЬ, ЯКІ ЛЕГКО «ПОЛАГОДИТИ» НАЗАД:
 *
 * 1. **Два числа зверху, а не одне** (`Q-16`). «У касі за ягоду» і «не хватає до наділу»
 *    стоять поруч навмисно: «ну вони будуть бачити цю різницю. Просто щоб бачили вони, що
 *    їм не хватає до 200» (1193). Друге число — це і є заборгованість бази перед точкою,
 *    те саме, що керівник бачить у «Переказах».
 * 2. **Жодного числа тут не пораховано.** Усе приходить із `useCashStanding()` — тієї
 *    самої згортки подій, якою стор перевіряє виплати (`G12`, `store.addPayout`) і якою сід зробив
 *    перерахунок о 16:00. Другий примірник арифметики на екрані розійшовся б мовчки.
 * 3. **«На початок дня» — це каса ВЧОРАШНЬОГО дня**, прочитана тим самим рушієм на
 *    `date − 1`, а не наділ мінус щось. Інакше довелося б рахувати тут, а рахувати тут
 *    не можна: каса — згортка подій (`I56`), і два способи її отримати — це два числа.
 * 4. **Дати на цьому екрані НЕ перемикають, але ДАТУ ВИДНО.** Стрілок тут немає (їх немає
 *    й в ескізі): приймальник дивиться свій сьогоднішній день, а керівник розбирає минуле в
 *    «Переказах» і «Касі за день». Але `workDate` — СПІЛЬНА робоча дата, і перемикається
 *    вона на «Касі за день»; поки в шапці стояла лише назва дня тижня («вівторок»), людина
 *    читала залишок чужого дня і ніде не бачила якого. Тепер у шапці стоїть сама дата,
 *    як на «Ящиках».
 * 5. **Плашка «касову книгу ведемо з …» бере ПУНКТОВУ дату, а не мережеву константу.**
 *    `cashStanding()` відкриває книгу точки не раніше, ніж зʼявився її перший наділ
 *    (`cash.openedOn`), і на Конищеві це 01.08 при мережевій 29.07. З константою плашка
 *    мовчала б на трьох днях, у яких залишок дорівнює наділу саме тому, що книги ще немає.
 */
export function PointCashPage() {
  const points = useStore((s) => s.points)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const cashFloats = useStore((s) => s.cashFloats)
  const crateIssues = useStore((s) => s.crateIssues)
  const crateReturns = useStore((s) => s.crateReturns)
  const workDate = useStore((s) => s.workDate)
  const { role, activePointId, allPoints } = useScope()

  // Керівник дивиться мережу і його `activePointId` — 'all'. «Каса точки» без точки не
  // існує, тому тут свій вибір пункту, як на «Собівартості дня».
  // Точки БЕЗ наділу каси сюди не потрапляють — так само, як у «Переказах». Каса бази поза
  // обсягом (`21 §9`, `Q-17`: база це керівник, свого підзвіту в неї немає), а `Point.active`
  // у неї `true`. Без цього фільтра керівник, обравши «Склад», читав «У касі за ягоду
  // −98 420,00 ₴» і плашку «наділ не покриває цього дня» — про наділ, якого не існує.
  const withBook = React.useMemo(
    () => points.filter((p) => p.active && cashFloats.some((f) => f.pointId === p.id)),
    [points, cashFloats],
  )
  const [picked, setPicked] = React.useState(() => withBook[0]?.id ?? '')
  const [floatOpen, setFloatOpen] = React.useState(false)
  const pointId = allPoints ? picked : activePointId

  const cash = useCashStanding(pointId, workDate)
  const before = useCashStanding(pointId, addDays(workDate, -1))
  // Потрібен РІВНО один рядок: виплата, що закрила залишок, створений цього ж дня. Він не
  // потрапляє ні в «сьогоднішню ягоду», ні в «інші дні», але з каси гроші забирає.
  const day = reconcileDay(
    workDate,
    scopedReceptions(receptions, pointId),
    scopedPayouts(payouts, pointId),
  )

  const point = points.find((p) => p.id === pointId)
  const floatRecord = effectiveAt(cashFloats, pointId, workDate)
  const units = depositUnits(crateIssues, crateReturns, pointId, workDate)
  const shortfall = cash.floatShortfall
  const hasBook = cashFloats.some((f) => f.pointId === pointId)

  // §7: наділ каси ставить КЕРІВНИК, із причиною. Приймальникові цієї кнопки не існує —
  // не «є, але сіра»: заблокована кнопка вчить шукати обхід, відсутня не вчить нічого.
  // Порожній фрагмент сюди не передається: `PageHeader` малює контейнер під будь-який
  // truthy-вузол, а фрагмент із двох `null` truthy так само, як справжня кнопка.
  const canSetFloat = role === 'owner' && point !== undefined
  const actions =
    allPoints || canSetFloat ? (
      <>
        {allPoints ? (
          <Select value={pointId} onValueChange={setPicked}>
            <SelectTrigger className="h-8 w-[200px]">
              <SelectValue placeholder="Оберіть точку" />
            </SelectTrigger>
            <SelectContent>
              {withBook.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {canSetFloat ? (
          <Button variant="outline" size="sm" onClick={() => setFloatOpen(true)}>
            <Wallet className="size-4" />
            {hasBook ? 'Змінити наділ каси' : 'Призначити наділ каси'}
          </Button>
        ) : null}
      </>
    ) : null

  const header = (
    <PageHeader
      eyebrow={point ? `${point.name} · ${longDate(workDate)}, ${weekday(workDate)}` : 'Каса'}
      title="Каса точки"
      description="Скільки грошей на точці має бути просто зараз і скільки не хватає до наділу. Гроші за ягоду й завдатки за ящики лежать в одній шухляді, а рахуються окремо."
      actions={actions}
    />
  )

  const body = !point ? (
    <EmptyState
      title="Точку не обрано"
      hint="Каса ведеться на конкретній точці: оберіть її вгорі."
    />
  ) : !hasBook ? (
    // Друга двері до того самого: точку можна обрати й повз селектор — через шапку
    // (`Shell` пропонує «Склад») або через збережений `activePointId`. Тоді книги немає, і
    // чесна відповідь — сказати це, а не порахувати наділ від нуля і намалювати мінус.
    // Керівникові поруч є кнопка, якою цю книгу можна відкрити тут-таки.
    <EmptyState
      title={`${point.name}: каси-підзвіту немає`}
      hint="Наділ каси цій точці не призначали. База ягоду приймає, але підзвітної каси не веде — гроші на ній рахує керівник."
    />
  ) : (
    <>
      <div className="grid gap-3 pb-5 sm:grid-cols-3">
        <StatTile
          label="Наділ"
          value={cash.float === null ? '—' : uah(cash.float, { decimals: 2 })}
          hint={
            floatRecord
              ? `з ${shortDate(floatRecord.effectiveFrom)}`
              : 'наділу цій точці ще не призначали'
          }
        />
        <StatTile
          label="У касі за ягоду"
          value={uah(cash.berryCash, { decimals: 2 })}
          tone={cash.berryCash < 0 ? 'amber' : 'berry'}
          hint="готівка, якою можна платити за ягоду"
        />
        {/* Бурштин тут означає «база винна». Коли наділ на місці, підсвічувати нема чого. */}
        <StatTile
          label="Не хватає до наділу"
          value={shortfall === null ? '—' : uah(shortfall, { decimals: 2 })}
          tone={shortfall !== null && shortfall > 0.009 ? 'amber' : 'leaf'}
          hint={
            shortfall === null
              ? 'без наділу порівнювати нема з чим'
              : shortfall > 0.009
                ? 'керівник ще не переказав'
                : shortfall < -0.009
                  ? 'у касі більше, ніж наділ'
                  : 'наділ на точці відновлено'
          }
        />
      </div>

      {/* Дата — ПУНКТОВА (`cash.openedOn`), а не мережева константа: книга точки не
          відкривається раніше за її перший наділ, інакше згортка брала б видатки з дня, на
          який підсумку ще не існує. */}
      {workDate < cash.openedOn ? (
        <p className="mb-5 rounded-lg bg-muted px-4 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Касову книгу цієї точки ведемо з {longDate(cash.openedOn)}. За раніші дні подій у
          ній немає, тому залишок дорівнює наділу — це межа даних, а не стан шухляди того дня.
        </p>
      ) : null}

      <IncomingTransfers pointId={pointId} canAct={role === 'operator'} />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <CashLedger
          opening={before.berryCash}
          openingFloat={before.float}
          openingOwed={before.floatShortfall}
          paidToday={cash.paidToday}
          paidForPastDays={cash.paidForPastDays}
          settledSameDay={day.settledSameDay}
          cashInToday={cash.cashInToday}
          berryCash={cash.berryCash}
        />

        <div className="flex flex-col gap-5">
          <div className="rounded-xl bg-card p-5 ring-1 ring-foreground/10">
            <Eyebrow className="mb-2">Каса за ящики</Eyebrow>
            <div className="font-mono text-[26px] leading-none font-semibold tracking-tight">
              {uah(cash.crateCash, { decimals: 2 })}
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              завдатків за {num(units)} {plural(units, 'ящик', 'ящики', 'ящиків')}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Ці гроші лежать окремо від ягідних: людині віддамо за її ящики, навіть якщо
              каса за ягоду порожня. За розписку завдатку не брали — такі ящики сюди не
              рахуються.
            </p>
          </div>

          <div className="rounded-xl bg-foreground px-5 py-4 text-background">
            <div className="text-[11px] font-medium tracking-[0.16em] uppercase opacity-70">
              У шухляді має бути
            </div>
            <div className="mt-1.5 font-mono text-3xl leading-none font-semibold tracking-tight">
              {uah(cash.expectedCash, { decimals: 2 })}
            </div>
            <div className="mt-2 text-xs opacity-70">
              ягода {uah(cash.berryCash, { decimals: 2 })} + ящики{' '}
              {uah(cash.crateCash, { decimals: 2 })}
            </div>
          </div>

          <CashCountPanel pointId={pointId} date={workDate} />
        </div>
      </div>
    </>
  )

  return (
    <div className="mx-auto max-w-[1100px]">
      {header}
      {body}
      {canSetFloat && point ? (
        <CashFloatDialog
          open={floatOpen}
          onOpenChange={setFloatOpen}
          pointId={pointId}
          pointName={point.name}
          standing={cash}
          record={floatRecord}
        />
      ) : null}
    </div>
  )
}
