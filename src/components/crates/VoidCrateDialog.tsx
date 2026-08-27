import * as React from 'react'
import { Ban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/**
 * Сторно ящикового документа (`21 §7`: «Сторнувати будь-який документ цих фаз — керівник,
 * так, із причиною»). Одне вікно на всі три команди стора (`voidCrateIssue`,
 * `voidCrateReturn`, `voidCrateShipment`) — саме тому, що правило в них одне.
 *
 * ДВІ РЕЧІ, ЯКІ ТУТ НЕ КОСМЕТИЧНІ.
 *
 * 1. **Причина обовʼязкова, і вікно це каже.** Стор мовчки відмовляє порожній причині
 *    (`voidCrateDoc`), тому кнопка без цієї перевірки була б кнопкою, яка іноді нічого не
 *    робить. Приймальникові вікно не показують узагалі — не «показують і блокують».
 * 2. **Відмова стора видима.** `onConfirm` повертає `false`, коли команда віддала
 *    `undefined` (роль не та, документ уже сторнований), і тоді вікно лишається відкритим
 *    із написаною причиною — правило `ports.ts`: «відмова — це НЕ тихий no-op».
 *
 * Документ після сторно не зникає: він лишається зі слідом і просто не рахується (`06 §3`).
 */
export function VoidCrateDialog({
  open,
  onOpenChange,
  title,
  what,
  placeholder,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  title: string
  /** рядок документа словами — «17:40 · з ягодою 173 · бій 2» */
  what: React.ReactNode
  placeholder: string
  /** `true` — стор прийняв команду; `false` — відмовив */
  onConfirm: (reason: string) => boolean
}) {
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setReason('')
      setError('')
    }
  }, [open])

  function submit() {
    if (!reason.trim()) {
      setError('Без причини сторно не проходить: саме вона лишається в документі замість витертого числа.')
      return
    }
    if (!onConfirm(reason.trim())) {
      setError('Стор відмовив: сторнує лише керівник, і лише документ, який ще не сторнований.')
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{what}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-1.5">
          <Label htmlFor="void-reason">Причина</Label>
          <Textarea
            id="void-reason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setError('')
            }}
            placeholder={placeholder}
            className="min-h-16"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Документ не зникає: він лишається в історії зі станом «сторновано», причиною і
          підписом того, хто сторнував, — і просто перестає рахуватися.
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button variant="destructive" onClick={submit} disabled={!reason.trim()}>
            <Ban className="size-4" />
            Сторнувати
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
