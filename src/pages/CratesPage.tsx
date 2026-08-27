import * as React from 'react'
import { Boxes, ChevronRight, PackageCheck, PackagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/common/bits'
import { AllotmentDialog } from '@/components/crates/AllotmentDialog'
import { CrateStandingBar } from '@/components/crates/CrateStandingBar'
import { InFieldTable } from '@/components/crates/InFieldTable'
import { IssueCratesDialog } from '@/components/crates/IssueCratesDialog'
import { ReturnCratesDialog } from '@/components/crates/ReturnCratesDialog'
import { ShipmentDialog } from '@/components/crates/ShipmentDialog'
import { crateWord, inFieldRows } from '@/components/crates/helpers'
import { effectiveAt, shipmentTotal } from '@/lib/calc'
import { longDate, num } from '@/lib/format'
import { TODAY } from '@/lib/seed'
import { useCashStanding, useCrateStanding, useScope, useStore } from '@/lib/store'

/**
 * Н14 · Ящики на точці (`21 §5`, реалізує `M40`). Це той самий блок, який клієнтка
 * просила поставити поруч із прийомкою: «блок прийомка окремо, блок ящики» (1076).
 *
 * ЧОМУ ДАТА ТУТ `TODAY`, А НЕ `workDate`. Це не звіт, який гортають, а стан точки просто
 * зараз: ящики видають і приймають у момент, коли людина стоїть біля столу. Команди
 * стора (`issueCrates`, `returnCrates`) прибиті до `TODAY` навмисно — і якби екран показав
 * вчорашній склад наділу, видача вписалася б у сьогоднішній день, а число на екрані не
 * ворухнулося б. Гортати дні — робота «Журналу», не цього екрана.
 *
 * ЩО РАХУЄ ЦЕЙ ФАЙЛ: нічого. Склад наділу дає `useCrateStanding()`, касу за ящики —
 * `useCashStanding()`, баланс людини — `crateBalance()` всередині `inFieldRows()`.
 * Тут лишається розкладка й те, кому яку кнопку показати.
 */
export function CratesPage() {
  const points = useStore((s) => s.points)
  const suppliers = useStore((s) => s.suppliers)
  const issues = useStore((s) => s.crateIssues)
  const returns = useStore((s) => s.crateReturns)
  const allotments = useStore((s) => s.crateAllotments)
  const shipments = useStore((s) => s.crateShipments)
  const { role, activePointId } = useScope()

  // Керівник у режимі «Усі точки» однаково працює з ОДНІЄЮ точкою: ящики лежать на точці,
  // а не в мережі. Той самий хід, що на прийомці — і так само з підписом, щоб не здалося,
  // ніби це зведення.
  const fallbackId = points.find((p) => p.active)?.id ?? ''
  const pointId = activePointId === 'all' ? fallbackId : activePointId
  const point = points.find((p) => p.id === pointId)

  const standing = useCrateStanding(pointId, TODAY)
  const cash = useCashStanding(pointId, TODAY)
  const record = effectiveAt(allotments, pointId, TODAY)
  const rows = React.useMemo(
    () => inFieldRows(pointId, suppliers, issues, returns),
    [pointId, suppliers, issues, returns],
  )

  const [issueOpen, setIssueOpen] = React.useState(false)
  const [returnOpen, setReturnOpen] = React.useState(false)
  const [shipOpen, setShipOpen] = React.useState(false)
  const [allotOpen, setAllotOpen] = React.useState(false)

  const postedToday = shipments.filter(
    (s) => s.pointId === pointId && s.date === TODAY && !s.voidedDate,
  )
  const shippedToday = postedToday.reduce((n, s) => n + shipmentTotal(s), 0)
  const withBerryToday = postedToday.reduce((n, s) => n + s.withBerryUnits, 0)
  const brokenToday = postedToday.reduce((n, s) => n + s.brokenUnits, 0)

  if (!point) {
    return (
      <div className="mx-auto max-w-[1000px]">
        <PageHeader title="Ящики" />
        <EmptyState
          title="Немає жодної відкритої точки"
          hint="Ящики лежать на точці. Поки жодна точка не відкрита, показувати нема чого."
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader
        eyebrow={`${point.name} · ${point.village} · ${longDate(TODAY)}`}
        title="Ящики"
        actions={
          /* §7: наділ змінює КЕРІВНИК. Приймальникові цієї кнопки не існує — не «є, але
             сіра»: заблокована кнопка вчить шукати обхід, відсутня не вчить нічого. */
          role === 'owner' ? (
            <Button variant="outline" onClick={() => setAllotOpen(true)}>
              <Boxes className="size-4" />
              Змінити наділ
            </Button>
          ) : null
        }
      />

      {activePointId === 'all' ? (
        <p className="mb-4 inline-block rounded-lg bg-[var(--amber)]/12 px-2.5 py-1.5 text-xs text-[var(--amber)]">
          Ящики рахуємо по точці «{point.name}» — змінити можна в шапці
        </p>
      ) : null}

      <div className="flex flex-col gap-5">
        <CrateStandingBar standing={standing} record={record} />

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setIssueOpen(true)}>
            <PackagePlus className="size-4" />
            Видати ящики
          </Button>
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            <PackageCheck className="size-4" />
            Прийняти ящики
          </Button>
          <Button variant="outline" className="sm:ml-auto" onClick={() => setShipOpen(true)}>
            Відправлення за сьогодні
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {postedToday.length ? (
          <p className="-mt-3 text-xs text-muted-foreground">
            Сьогодні вже відправлено {num(shippedToday)} {crateWord(shippedToday)}: з ягодою{' '}
            {num(withBerryToday)}, бій {num(brokenToday)}.
          </p>
        ) : null}

        <InFieldTable rows={rows} inField={standing.inField} pointId={pointId} />

        <p className="text-xs leading-relaxed text-muted-foreground">
          Ящики, узяті за розписку, грошового покриття не мають узагалі — у колонці
          «завдаток» за ними стоїть «—», а не нуль. Тому «ящиків у людей» і «завдатків у
          нас» — два різні числа, і поруч вони стоять навмисно: саме цієї різниці не видно
          в журналі на аркуші, де повернення від узятого не віднімаються взагалі.
        </p>
      </div>

      <IssueCratesDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        pointId={pointId}
        onHand={standing.onHand}
      />
      <ReturnCratesDialog
        open={returnOpen}
        onOpenChange={setReturnOpen}
        pointId={pointId}
        rows={rows}
        crateCash={cash.crateCash}
      />
      <ShipmentDialog
        open={shipOpen}
        onOpenChange={setShipOpen}
        pointId={pointId}
        date={TODAY}
        standing={standing}
      />
      {role === 'owner' ? (
        <AllotmentDialog
          open={allotOpen}
          onOpenChange={setAllotOpen}
          pointId={pointId}
          standing={standing}
          record={record}
        />
      ) : null}
    </div>
  )
}
