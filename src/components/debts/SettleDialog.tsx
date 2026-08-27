import * as React from 'react'
import { ArrowRight, HandCoins } from 'lucide-react'
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
import { useStore } from '@/lib/store'
import {
  allocatePayout,
  openDebts,
  originDates,
  parseNumeric,
  round2,
  signerFor,
} from '@/lib/calc'
import { longDate, shortDate, uah, uahAuto } from '@/lib/format'
import { toast } from 'sonner'

export function SettleDialog({
  supplierId,
  open,
  onOpenChange,
}: {
  supplierId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const addPayout = useStore((s) => s.addPayout)
  const activePointId = useStore((s) => s.activePointId)
  const users = useStore((s) => s.users)
  const config = useStore((s) => s.config)

  const supplier = suppliers.find((s) => s.id === supplierId)
  // книга кожного пункту своя: видача тут закриває ягоду, прийняту САМЕ тут, і рівно ту
  // суму, яку показав рядок у «Залишках». Керівник в режимі «Усі точки» бачить мережу.
  const scopePointId = activePointId === 'all' ? undefined : activePointId
  const scoped = React.useMemo(
    () => (scopePointId ? receptions.filter((r) => r.pointId === scopePointId) : receptions),
    [receptions, scopePointId],
  )
  const open_ = React.useMemo(
    () => (supplierId ? openDebts(supplierId, scoped, payouts) : []),
    [supplierId, scoped, payouts],
  )
  // openDebts() уже зводить переплати, тому Σ решток дорівнює боргу цього пункту
  const total = round2(open_.reduce((s, o) => s + o.open, 0))
  const [amount, setAmount] = React.useState('')

  React.useEffect(() => {
    if (open) setAmount(String(total))
  }, [open, total])

  const value = Math.max(0, Math.min(total, parseNumeric(amount)))
  const preview = allocatePayout(value, open_)

  function submit() {
    if (!supplierId || value <= 0) {
      toast.error('Вкажіть суму видачі')
      return
    }
    // у режимі «Усі точки» гроші не можуть виходити з каси, яка людини не бачила:
    // беремо пункт найстарішого відкритого залишку
    const pointId = scopePointId ?? open_[0]?.reception.pointId ?? 'p1'
    const operator = signerFor(users, pointId) ?? 'Каса'
    const payout = addPayout({
      date: config.businessToday,
      pointId,
      supplierId,
      amount: value,
      operator,
      scopePointId,
    })
    onOpenChange(false)
    if (payout) {
      toast.success(`Видано ${uah(payout.amount)}`, {
        description: `Закрито залишки за ${originDates(payout.allocations)
          .map(shortDate)
          .join(', ')} — саме тими датами вони й спишуться.`,
      })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Видати залишок — {supplier?.name}</DialogTitle>
          <DialogDescription>
            Гроші виходять з каси сьогодні, а ягода списується датою, коли її прийняли. Обидві дати
            лишаються в базі, тому денна звірка сходиться.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="settle-amount">Сума видачі</Label>
              <Input
                id="settle-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="h-11 font-mono text-lg"
              />
            </div>
            <Button variant="outline" className="h-11" onClick={() => setAmount(String(total))}>
              Усе — {uahAuto(total)}
            </Button>
          </div>

          <div className="rounded-lg border border-border bg-muted/40 p-3">
            <div className="mb-2 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Що саме закриється
            </div>
            {preview.length ? (
              <div className="flex flex-col gap-1.5">
                {preview.map((a) => (
                  <div key={a.receptionId} className="flex items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {longDate(a.originDate)}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                    <ArrowRight className="size-3 text-muted-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">
                      {longDate(config.businessToday)}
                    </span>
                    <span className="w-24 text-right font-mono font-medium">{uahAuto(a.amount)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Немає відкритих залишків.</div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={value <= 0}>
            <HandCoins className="size-4" />
            Видати {uahAuto(value)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
