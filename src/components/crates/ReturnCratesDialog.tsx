import * as React from 'react'
import { PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  allocateCrateReturn,
  checkCrateRefund,
  checkCrateReturn,
  crateBalance,
  crateRefund,
  maskDecimalInput,
  parseNumeric,
  round2,
} from '@/lib/calc'
import { longDate, num, uah, uahAuto } from '@/lib/format'
import { useStore } from '@/lib/store'
import { crateWord, modeLabel } from './helpers'
import type { InFieldRow } from './helpers'

/**
 * Н15 · «Прийняти ящики» (`21 §5`, `M42`). Головне тут — чого на екрані НЕМАЄ: питання
 * «як ви брали?». «Нам важливо, щоби не запитувати кожного разу в людини, як вона брала
 * ящики» (1091) — спосіб і завдаток підтягує FIFO по її ж видачах, найстаріша перша, і
 * кожні сім ящиків рахуються за ЗНІМКОМ ціни тієї видачі, з якою вони пішли (`I65`).
 *
 * Числа 20 → 7 → 840,00 → 13 в ескізі — дослівно її приклад (1101).
 *
 * Баланс береться по ЛЮДИНІ, без фільтра по точці: рівно так його рахує команда
 * `returnCrates()`. Якби вікно рахувало свій, точковий баланс, воно показало б суму, якої
 * стор не проведе, — і приймальник побачив би відмову без жодної причини на екрані.
 */
export function ReturnCratesDialog({
  open,
  onOpenChange,
  pointId,
  rows,
  crateCash,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  rows: InFieldRow[]
  crateCash: number
}) {
  const issues = useStore((s) => s.crateIssues)
  const returns = useStore((s) => s.crateReturns)
  const returnCrates = useStore((s) => s.returnCrates)

  const [supplierId, setSupplierId] = React.useState('')
  const [qty, setQty] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setSupplierId('')
      setQty('')
    }
  }, [open])

  const balance = supplierId ? crateBalance(supplierId, issues, returns) : null
  const units = Math.trunc(parseNumeric(qty))
  const check = checkCrateReturn(units, balance ? balance.units : 0)
  // Розклад і гроші — ті самі функції, що їх покличе стор. Прев'ю не має права
  // порахувати інакше, ніж документ, який зʼявиться через секунду.
  const allocations = balance ? allocateCrateReturn(units, balance.open) : []
  const refund = crateRefund(allocations)
  const refundCheck = checkCrateRefund(refund, crateCash)
  const leftUnits = balance ? balance.units - units : 0
  const leftHeld = round2((balance ? balance.depositHeld : 0) - refund)
  const canSubmit = Boolean(supplierId) && units > 0 && check.ok && refundCheck.ok

  function submit() {
    const doc = returnCrates({ pointId, supplierId, units })
    if (!doc) {
      toast.error('Повернення не пройшло', {
        description: 'Перевірте кількість і касу за ящики.',
      })
      return
    }
    onOpenChange(false)
    toast.success(`Прийняли ${num(doc.units)} ${crateWord(doc.units)}`, {
      description:
        doc.depositRefund > 0
          ? `Віддали ${uahAuto(doc.depositRefund)} з каси за ящики.`
          : 'За розписку грошей не брали — і не віддаємо.',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Прийняти ящики</DialogTitle>
          <DialogDescription>
            Спосіб і завдаток підтягуються самі, за її ж видачами. Питати людину, як вона
            брала, не треба.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Зараз у людей ящиків немає — приймати нема чого.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="return-person">Людина</Label>
              <Select value={supplierId} onValueChange={setSupplierId}>
                <SelectTrigger id="return-person" className="h-12 w-full">
                  <SelectValue placeholder="Обрати людину" />
                </SelectTrigger>
                <SelectContent>
                  {rows.map((r) => (
                    <SelectItem key={r.supplier.id} value={r.supplier.id}>
                      {r.supplier.name}
                      <span className="ml-1.5 font-mono text-muted-foreground">
                        {num(r.balance.units)} ящ.
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {balance ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    брала {num(balance.units)} ящ. · {modeLabel(balance)} · завдаток у нас{' '}
                    {balance.depositHeld > 0 ? uahAuto(balance.depositHeld) : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ↑ підтягнуто автоматично — питати людину не треба
                  </p>
                </>
              ) : null}
            </div>

            <div className="flex items-end gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="return-qty">Повертає</Label>
                <Input
                  id="return-qty"
                  value={qty}
                  onChange={(e) => setQty(maskDecimalInput(e.target.value, 0))}
                  inputMode="numeric"
                  placeholder="0"
                  className="h-11 w-32 font-mono text-lg"
                />
              </div>
              {balance ? (
                <span className="pb-3 text-sm text-muted-foreground">
                  із {num(balance.units)}
                </span>
              ) : null}
            </div>

            {check.ok && allocations.length ? (
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <div className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
                  За якими видачами
                </div>
                <div className="flex flex-col gap-1.5">
                  {allocations.map((a) => {
                    const issue = issues.find((i) => i.id === a.issueId)
                    return (
                      <div key={a.issueId} className="flex items-center gap-2 text-sm">
                        <span className="font-mono text-xs text-muted-foreground">
                          {issue ? longDate(issue.date) : '—'}
                        </span>
                        <span className="h-px flex-1 bg-border" />
                        <span className="font-mono text-xs text-muted-foreground">
                          {a.perUnit > 0
                            ? `${num(a.units)} × ${uah(a.perUnit, { decimals: 2 })}`
                            : `${num(a.units)} ящ. за розписку`}
                        </span>
                        <span className="w-24 text-right font-mono font-medium">
                          {a.perUnit > 0 ? uahAuto(a.amount) : '—'}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                  <span className="text-sm font-medium">До видачі</span>
                  <span className="font-mono font-semibold">{uahAuto(refund)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">з каси за ящики</p>
              </div>
            ) : null}

            {balance && units > 0 && check.ok ? (
              <p className="text-sm">
                Лишиться в неї: <span className="font-mono font-medium">{num(leftUnits)}</span> ящ.
                · завдатку в нас{' '}
                <span className="font-mono font-medium">
                  {leftHeld > 0 ? uahAuto(leftHeld) : '—'}
                </span>
              </p>
            ) : null}

            {/* `I64`, дослівний текст інваріанта: «людина брала 20, повернути 25 не може».
                Ящик «нізвідки» — це помилка вводу, а не подія. */}
            {balance && units > 0 && !check.ok ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                Людина брала {num(balance.units)} — повернути {num(units)} не може.
              </p>
            ) : null}

            {/* `UC-20` A2: впирається в касу ЗА ЯЩИКИ. Це не суперечить `I59` нижче —
                там порожня ІНША книга. */}
            {units > 0 && check.ok && !refundCheck.ok ? (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                У касі за ящики {uahAuto(crateCash)}, до видачі {uahAuto(refund)}.
              </p>
            ) : null}

            {/* `I59` — окремим рядком, бо це окреме правило, а не примітка до попереднього. */}
            <p className="text-xs text-muted-foreground">
              Гроші за ящики лежать окремо: людині віддамо, навіть якщо каса за ягоду
              порожня.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <PackageCheck className="size-4" />
            Прийняти
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
