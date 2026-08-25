import * as React from 'react'
import { PackagePlus } from 'lucide-react'
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
import { SupplierPicker } from '@/components/reception/SupplierPicker'
import {
  checkCrateIssue,
  crateBalance,
  crateIssueMode,
  CRATE_RECEIPT_THRESHOLD,
  maskDecimalInput,
  parseNumeric,
  round2,
} from '@/lib/calc'
import { num, uah, uahAuto } from '@/lib/format'
import { DEFAULT_TARE_ID } from '@/lib/seed'
import { useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import { crateWord, emptyCrateWord, modeLabel } from './helpers'
import type { CrateIssueMode } from '@/lib/types'

/**
 * Н15 · «Видати ящики» (`21 §5`, `M41`). «В них є, наприклад, там що бере ящики і
 * повертає ящики» (1077) — два віконця, як вона й описує.
 *
 * ПОРІГ 50 — ПІДСТАВЛЕННЯ, А НЕ ЗАБОРОНА. Спосіб іде за кількістю, поки приймальник не
 * торкнувся перемикача: «ми обираємо, якщо за кошти, ми натискаємо в себе за кошти»
 * (1083). Перемкнув руками — так і буде, і тоді нижче зʼявляється попередження (`UC-18`
 * A2), а не відмова. Саме число 50 клієнтка не підтверджувала (`Q-19`), тому воно живе
 * однією константою в рушії, а не двома копіями тут і там.
 */
export function IssueCratesDialog({
  open,
  onOpenChange,
  pointId,
  onHand,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  onHand: number | null
}) {
  const tareTypes = useStore((s) => s.tareTypes)
  const issues = useStore((s) => s.crateIssues)
  const returns = useStore((s) => s.crateReturns)
  const issueCrates = useStore((s) => s.issueCrates)

  const [supplierId, setSupplierId] = React.useState('')
  const [qty, setQty] = React.useState('')
  // `null` — перемикача не торкалися, діє підстановка за порогом. Це і є вся різниця між
  // «підставили» і «вирішили»: без цього прапорця перше ж підставлення ставало б вибором.
  const [picked, setPicked] = React.useState<CrateIssueMode | null>(null)
  const [receiptNo, setReceiptNo] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setSupplierId('')
      setQty('')
      setPicked(null)
      setReceiptNo('')
    }
  }, [open])

  const units = Math.trunc(parseNumeric(qty))
  const mode = picked ?? crateIssueMode(units)
  // ТА САМА перевірка, що і в команді стора (`I62`): форма показує текст, стор відмовляє
  // в дії, але правило одне — воно лежить у рушії.
  const check = checkCrateIssue(units, onHand)

  // Ящик — це Чешка (рішення `Р-1`). Її ціна і є завдаток; знімок цієї ціни поїде в
  // документ, тому пізніша зміна ціни не перепише того, що ми вже взяли (`I65`).
  const cheshka = tareTypes.find((t) => t.id === DEFAULT_TARE_ID)
  const perUnit = mode === 'deposit' && cheshka ? cheshka.price : 0
  const depositTotal = round2(units * perUnit)

  const balance = supplierId ? crateBalance(supplierId, issues, returns) : null
  const noCheshka = mode === 'deposit' && !cheshka
  const overThreshold = units > CRATE_RECEIPT_THRESHOLD
  const unusualReceipt = units > 0 && !overThreshold && mode === 'receipt'
  const canSubmit = Boolean(supplierId) && units > 0 && check.ok && !noCheshka

  function submit() {
    const doc = issueCrates({
      pointId,
      supplierId,
      units,
      mode,
      receiptNo: receiptNo.trim() || undefined,
    })
    if (!doc) {
      toast.error('Видача не пройшла', {
        description: 'Перевірте кількість порожніх на точці й спосіб видачі.',
      })
      return
    }
    onOpenChange(false)
    toast.success(`Видали ${num(doc.units)} ${crateWord(doc.units)}`, {
      description:
        doc.mode === 'deposit'
          ? `Завдаток ${uahAuto(doc.depositTaken)} зайшов у касу за ящики.`
          : 'За розписку — грошей у цій операції немає.',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Видати ящики</DialogTitle>
          <DialogDescription>
            До 50 ящиків — за кошти, понад 50 — за розписку. Спосіб підставляється сам, але
            перемкнути його можна.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label>Людина</Label>
            <SupplierPicker value={supplierId} onChange={setSupplierId} pointId={pointId} />
            {balance ? (
              <p className="text-sm text-muted-foreground">
                {balance.units > 0 ? (
                  <>
                    на балансі: {num(balance.units)} ящ. · {modeLabel(balance)} · завдаток у нас{' '}
                    {balance.depositHeld > 0 ? uahAuto(balance.depositHeld) : '—'}
                  </>
                ) : (
                  'ящиків за нею зараз немає'
                )}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="issue-qty">Кількість</Label>
            <Input
              id="issue-qty"
              value={qty}
              onChange={(e) => setQty(maskDecimalInput(e.target.value, 0))}
              inputMode="numeric"
              placeholder="0"
              className="h-11 w-36 font-mono text-lg"
            />
          </div>

          <div className="grid gap-2">
            <ModeChoice
              active={mode === 'deposit'}
              onClick={() => setPicked('deposit')}
              title="За кошти"
              hint={
                units > 0 && cheshka ? (
                  <>
                    завдаток {uah(perUnit, { decimals: 2 })} × {num(units)} ={' '}
                    <span className="font-medium text-foreground">{uahAuto(depositTotal)}</span> у
                    касу
                  </>
                ) : (
                  'гроші заходять у касу за ящики'
                )
              }
            />
            <ModeChoice
              active={mode === 'receipt'}
              onClick={() => setPicked('receipt')}
              title="За розписку"
              hint="завдаток — · грошей у цій операції немає взагалі"
            />
            <p className="text-xs text-muted-foreground">
              до {num(CRATE_RECEIPT_THRESHOLD)} — за кошти, понад {num(CRATE_RECEIPT_THRESHOLD)} —
              за розписку
            </p>
          </div>

          {mode === 'receipt' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="issue-receipt">№ розписки</Label>
              <Input
                id="issue-receipt"
                value={receiptNo}
                onChange={(e) => setReceiptNo(e.target.value)}
                placeholder="номер паперу"
                className="h-11 w-48 font-mono"
              />
            </div>
          ) : null}

          {unusualReceipt ? (
            <p className="rounded-lg bg-[var(--amber)]/12 px-3 py-2 text-sm text-[var(--amber)]">
              До {num(CRATE_RECEIPT_THRESHOLD)} ящиків зазвичай за кошти. Ви обрали розписку —
              підтвердіть.
            </p>
          ) : null}

          {noCheshka ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              У довіднику тари немає Чешки, а ящик — це саме вона. За кошти видати нема під
              що: завдаток довелося б узяти нізвідки.
            </p>
          ) : null}

          {/* `I62`, дослівний текст інваріанта. Показуємо ЛИШЕ коли є що показати: до
              введення кількості це була б відмова на порожньому місці. */}
          {units > 0 && !check.ok ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {check.max === null
                ? 'Цій точці ще не призначали наділу ящиків — видавати нема з чого.'
                : `На точці зараз ${num(check.max)} ${emptyCrateWord(check.max)} — ${num(units)} видати нема з чого.`}
            </p>
          ) : null}

          <p className="text-sm text-muted-foreground">
            {onHand === null
              ? 'Наділу цій точці ще не призначали.'
              : `На точці зараз ${num(onHand)} ${emptyCrateWord(onHand)}.`}
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            <PackagePlus className="size-4" />
            Видати
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeChoice({
  active,
  onClick,
  title,
  hint,
}: {
  active: boolean
  onClick: () => void
  title: string
  hint: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60',
      )}
    >
      <span
        className={cn(
          'grid size-4 shrink-0 place-items-center rounded-full border',
          active ? 'border-primary' : 'border-muted-foreground/50',
        )}
      >
        {active ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}
