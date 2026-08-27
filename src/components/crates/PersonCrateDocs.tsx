import * as React from 'react'
import { Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/common/bits'
import { num, shortDate, uahAuto } from '@/lib/format'
import { useStore } from '@/lib/store'
import { VoidCrateDialog } from './VoidCrateDialog'
import { crateWord } from './helpers'
import type { InFieldRow } from './helpers'
import type { CrateIssue, CrateReturn } from '@/lib/types'

/** Один рядок журналу людини: видача або повернення, з одним і тим самим ключем сортування. */
type Doc =
  | { kind: 'issue'; id: string; date: string; time: string; doc: CrateIssue }
  | { kind: 'return'; id: string; date: string; time: string; doc: CrateReturn }

const byNewest = (a: Doc, b: Doc) =>
  b.date === a.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)

/**
 * Ящикові документи ОДНІЄЇ людини на цій точці — і сторно кожного (`21 §7`).
 *
 * ЧОМУ СТОРНО ВИДАЧІ ГАТИТЬСЯ, А СТОРНО ПОВЕРНЕННЯ — НІ. Повернення розкладається по
 * відкритих видачах FIFO (`allocateCrateReturn`), і `openCrateIssues()` рахує погашене
 * САМЕ з `allocations` неcторнованих повернень. Тому:
 *
 * - сторно ПОВЕРНЕННЯ безпечне завжди: його `allocations` просто перестають рахуватися, і
 *   ящики повертаються в баланс людини рівно туди, звідки прийшли;
 * - сторно ВИДАЧІ безпечне лише поки на неї нічого не розклали. Якщо на неї вже лягло
 *   повернення, то після сторно `units = taken − returned` упаде на всю видачу, а сума
 *   відкритих — лише на її НЕПОГАШЕНИЙ залишок, і `CrateBalance.drift` стане ненульовим.
 *   Це рівно той клас тихої розбіжності, який `reconcileDay().drift` ловить у грошах, і
 *   екран не має права його створювати. Тому кнопки там немає, а замість неї стоїть
 *   порядок дій: спершу сторнувати повернення.
 *
 * Кнопок тут не бачить приймальник: `§7` — «Сторнувати будь-який документ цих фаз:
 * приймальник — ні». Розгортання рядка вмикає сама таблиця, і теж лише керівникові.
 */
export function PersonCrateDocs({ pointId, row }: { pointId: string; row: InFieldRow }) {
  const issues = useStore((s) => s.crateIssues)
  const returns = useStore((s) => s.crateReturns)
  const voidCrateIssue = useStore((s) => s.voidCrateIssue)
  const voidCrateReturn = useStore((s) => s.voidCrateReturn)

  const [voiding, setVoiding] = React.useState<Doc | null>(null)

  const supplierId = row.supplier.id
  const docs: Doc[] = [
    ...issues
      .filter((i) => i.pointId === pointId && i.supplierId === supplierId)
      .map((doc): Doc => ({ kind: 'issue', id: doc.id, date: doc.date, time: doc.time, doc })),
    ...returns
      .filter((r) => r.pointId === pointId && r.supplierId === supplierId)
      .map((doc): Doc => ({ kind: 'return', id: doc.id, date: doc.date, time: doc.time, doc })),
  ].sort(byNewest)

  // Скільки ящиків цієї видачі ще НЕ погашено. Мапа збирається з того самого
  // `balance.open`, яким живе вся таблиця, — другого підрахунку тут немає.
  const stillOpen = new Map(row.balance.open.map((x) => [x.issue.id, x.open]))
  const untouched = (i: CrateIssue) => stillOpen.get(i.id) === i.units

  function confirmVoid(reason: string) {
    if (!voiding) return false
    const doc =
      voiding.kind === 'issue'
        ? voidCrateIssue(voiding.id, reason)
        : voidCrateReturn(voiding.id, reason)
    if (!doc) return false
    setVoiding(null)
    toast.success(voiding.kind === 'issue' ? 'Видачу сторновано' : 'Повернення сторновано', {
      description: 'Документ лишився в історії з причиною і перестав рахуватися в балансі.',
    })
    return true
  }

  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <Eyebrow>Документи цієї людини на точці</Eyebrow>

      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          На цій точці за цією людиною документів немає — ящики вона брала деінде.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {docs.map((d) => {
            const voided = Boolean(d.doc.voidedDate)
            const blockedByReturn = d.kind === 'issue' && !voided && !untouched(d.doc)
            return (
              <div
                key={d.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-background px-3 py-2 text-sm ring-1 ring-foreground/10"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {shortDate(d.date)} · {d.time}
                </span>
                <span className={voided ? 'text-muted-foreground line-through' : undefined}>
                  {d.kind === 'issue' ? 'видали' : 'прийняли'} {num(d.doc.units)}{' '}
                  {crateWord(d.doc.units)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {d.kind === 'issue'
                    ? d.doc.mode === 'deposit'
                      ? `за кошти · завдаток ${uahAuto(d.doc.depositTaken)}`
                      : `за розписку${d.doc.receiptNo ? ` № ${d.doc.receiptNo}` : ''} · завдатку не брали`
                    : d.doc.depositRefund > 0
                      ? `віддали завдаток ${uahAuto(d.doc.depositRefund)}`
                      : 'завдатку не було — брала за розписку'}
                </span>

                {voided ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    сторнував {d.doc.voidedBy ?? '—'}
                    {d.doc.voidedDate ? ` ${shortDate(d.doc.voidedDate)}` : ''}
                    {d.doc.voidReason ? ` · ${d.doc.voidReason}` : ''}
                  </span>
                ) : blockedByReturn ? (
                  <span className="ml-auto text-xs text-muted-foreground">
                    на цю видачу вже лягло повернення — спершу сторнуйте його
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-7 px-2 text-destructive"
                    onClick={() => setVoiding(d)}
                  >
                    <Ban className="size-3.5" />
                    Сторнувати
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <VoidCrateDialog
        open={voiding !== null}
        onOpenChange={(v) => {
          if (!v) setVoiding(null)
        }}
        title={voiding?.kind === 'return' ? 'Сторнувати повернення' : 'Сторнувати видачу'}
        what={
          voiding
            ? `${row.supplier.name} · ${shortDate(voiding.date)} о ${voiding.time} · ${num(voiding.doc.units)} ${crateWord(voiding.doc.units)}`
            : ''
        }
        placeholder={
          voiding?.kind === 'return' ? 'прийняли не ті ящики' : 'вписали 30 замість 3'
        }
        onConfirm={confirmVoid}
      />
    </div>
  )
}
