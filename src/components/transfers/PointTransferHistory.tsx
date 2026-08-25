import { CornerDownRight } from 'lucide-react'
import { Eyebrow } from '@/components/common/bits'
import { TransferStateBadge } from '@/components/transfers/TransferStateBadge'
import { num, shortDate, uahAuto } from '@/lib/format'
import { useCrateStanding, useStore } from '@/lib/store'
import type { ISODate, Transfer } from '@/lib/types'

/** «—», а не 0: наділу на цю дату ще не призначали, і нуль сказав би неправду (`21 §5`). */
const units = (v: number | null) => (v === null ? '—' : num(v))

/** Найновіші зверху. Ключ сортування — день плюс час відправлення, як на решті журналів. */
const byNewest = (a: Transfer, b: Transfer) =>
  b.date === a.date ? b.sentTime.localeCompare(a.sentTime) : b.date.localeCompare(a.date)

/**
 * Історія переказів однієї точки і склад її наділу ящиків.
 *
 * Навіщо історія взагалі є на цьому екрані. Правило `06 §3` — **тільки INSERT**: виправлення
 * це новий документ із посиланням на старий, а не правка старого. Правило, якого не видно,
 * нічим не відрізняється від правила, якого немає, тому сторновані документи лишаються в
 * списку з причиною сторно, а виправлення підписане «замість переказу від такого-то дня».
 * Причина не теоретична: у файлі клієнтки 60 клітинок «Залишок» набрані руками поверх
 * формули, і 20 з них не сходяться зі своїм же рядком (`PART C 3`).
 *
 * Склад наділу друкується поруч свідомо: рядок таблиці каже лише «−459», а це число
 * складається з двох різних речей — «у людей» і «у нас» (`21 §3.3`, ряд. 1046). Перше база
 * повернути не може взагалі: ящики на руках у здавальників.
 *
 * `useCrateStanding` тут викликається РІВНО ОДИН раз, бо компонент показує одну точку — це
 * і є санкціонований спосіб екрана прочитати наділ (`store.ts`). Таблиця над ним читає
 * рушій напряму з тієї ж причини, з якої не може викликати цей хук: `points.map(useX)`
 * порушує `react/rules-of-hooks`.
 */
export function PointTransferHistory({ pointId, date }: { pointId: string; date: ISODate }) {
  const transfers = useStore((s) => s.transfers)
  const crates = useCrateStanding(pointId, date)

  const mine = transfers.filter((t) => t.pointId === pointId && t.date <= date).sort(byNewest)
  const originOf = (t: Transfer) =>
    t.correctionOf ? (transfers.find((x) => x.id === t.correctionOf) ?? null) : null

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      <div>
        <Eyebrow>Склад наділу ящиків</Eyebrow>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 font-mono text-sm">
          <span>
            наділ <span className="font-semibold">{units(crates.allotment)}</span>
          </span>
          <span className="text-muted-foreground">=</span>
          <span>
            пустих <span className="font-semibold">{units(crates.onHand)}</span>
          </span>
          <span className="text-muted-foreground">+</span>
          <span>
            у людей <span className="font-semibold">{num(crates.inField)}</span>
          </span>
          <span className="text-muted-foreground">+</span>
          <span>
            у нас <span className="font-semibold">{num(crates.atBase)}</span>
          </span>
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          «У нас» — це {num(crates.shipped)} відправлених з ягодою і боєм мінус{' '}
          {num(crates.returnedToPoint)} повернених переказами, які точка вже прийняла. Ящики «у
          людей» переказом не вертаються: вони на руках у здавальників, поки ті їх не принесуть.
        </p>
      </div>

      <div>
        <Eyebrow>Історія переказів</Eyebrow>
        {mine.length === 0 ? (
          <p className="mt-1.5 text-sm text-muted-foreground">
            На цю точку ще не відправляли жодного переказу.
          </p>
        ) : (
          <div className="mt-2 flex flex-col gap-1.5">
            {mine.map((t) => {
              const origin = originOf(t)
              return (
                <div
                  key={t.id}
                  className="rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-foreground/10"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-muted-foreground">
                      {shortDate(t.date)} · {t.sentTime}
                    </span>
                    <span className="font-mono font-medium">{uahAuto(t.cash)}</span>
                    <span className="font-mono text-muted-foreground">
                      {num(t.crates)} ящ.
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      перевізник: {t.carrier}
                    </span>
                    <TransferStateBadge status={t.status} className="ml-auto" />
                  </div>

                  {t.status === 'accepted' && t.acceptedBy ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      прийняв {t.acceptedBy}
                      {t.acceptedTime ? ` о ${t.acceptedTime}` : ''}
                    </div>
                  ) : null}

                  {t.status === 'disputed' ? (
                    <div className="mt-1 text-xs text-destructive">
                      точка нарахувала{' '}
                      {t.reportedCash === undefined ? '—' : uahAuto(t.reportedCash)} і{' '}
                      {t.reportedCrates === undefined ? '—' : num(t.reportedCrates)} ящ.
                      {t.disputeNote ? ` · «${t.disputeNote}»` : ''}
                    </div>
                  ) : null}

                  {t.status === 'void' ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      сторнував {t.voidedBy ?? '—'}
                      {t.voidedDate ? ` ${shortDate(t.voidedDate)}` : ''}
                      {t.voidReason ? ` · причина: ${t.voidReason}` : ''}
                    </div>
                  ) : null}

                  {origin ? (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CornerDownRight className="size-3" />
                      подано замість переказу від {shortDate(origin.date)}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
