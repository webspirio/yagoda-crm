import * as React from 'react'
import { Check, Truck, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { maskDecimalInput, parseNumeric } from '@/lib/calc'
import { num, shortDate, uah } from '@/lib/format'
import { useStore } from '@/lib/store'
import type { Transfer } from '@/lib/types'

/**
 * Перекази, які ще їдуть або вже заявлені як «не сходиться» (`21 §Н17`, `UC-22`).
 *
 * ГОЛОВНЕ ТУТ — ЩО ЦЕЙ БЛОК НЕ РУХАЄ КАСИ. Поки переказ у стані `sent`, він не входить
 * ні в `berryCash`, ні в склад наділу (`I68`): «поки точка не натиснула "Прийняв", ці
 * гроші й ящики ще не її» (1172). Тому число з цього блоку НІКОЛИ не збігається з
 * розкладом каси поруч — і це не розбіжність, а стан «в дорозі», який видно окремо.
 *
 * «Не сходиться» — ЗАЯВКА (`I69`): вона записує, що точка нарахувала, і не міняє суму
 * переказу ані на копійку. Виправляє керівник новим документом — «щоб керівник просто
 * змінював, щоб не вони, бо то ужас буде» (1185).
 *
 * ОБИДВІ КОМАНДИ ВІДМОВЛЯЮТЬ, І ОБИДВІ ВІДМОВИ ТУТ ВИДНО. `acceptTransfer` вимагає ролі
 * приймальника і стану 'sent'; `disputeTransfer` — ще й непорожнього коментаря і чисел, які
 * не NaN. `ports.ts` каже про них однаково: «відмова — це НЕ тихий no-op». Кнопка, яка
 * іноді нічого не робить, гірша за відмову, названу вголос: людина натискає її вдруге й
 * втретє і врешті вирішує, що зламалася програма, а не що їй бракує права.
 */
export function IncomingTransfers({ pointId, canAct }: { pointId: string; canAct: boolean }) {
  const transfers = useStore((s) => s.transfers)
  const acceptTransfer = useStore((s) => s.acceptTransfer)
  const disputeTransfer = useStore((s) => s.disputeTransfer)

  const [claim, setClaim] = React.useState<Transfer | null>(null)
  const [cash, setCash] = React.useState('')
  const [crates, setCrates] = React.useState('')
  const [note, setNote] = React.useState('')
  const [claimError, setClaimError] = React.useState('')

  const pending = transfers
    .filter((t) => t.pointId === pointId && (t.status === 'sent' || t.status === 'disputed'))
    .sort((a, b) => a.date.localeCompare(b.date) || a.sentTime.localeCompare(b.sentTime))

  if (!pending.length) return null

  // Заявка відкривається з ФАКТИЧНИМИ числами переказу — людина правит те, що не зійшлося,
  // а не набирає обидва числа з нуля. Саме так виглядає її випадок: гроші зійшлися,
  // ящиків приїхало на два менше.
  const openClaim = (t: Transfer) => {
    setClaim(t)
    setCash(t.cash.toFixed(2))
    setCrates(String(t.crates))
    setNote('')
    setClaimError('')
  }

  const accept = (t: Transfer) => {
    const doc = acceptTransfer(t.id)
    if (!doc) {
      toast.error('Переказ не прийнято', {
        description:
          '«Прийняв» тисне приймальник точки, і лише по переказу, який ще в дорозі. Каса не змінилася.',
      })
      return
    }
    toast.success('Переказ прийнято', {
      description: `${uah(doc.cash, { decimals: 2 })} і ${num(doc.crates)} ящ. зайшли в касу й у наділ.`,
    })
  }

  const submitClaim = () => {
    if (!claim) return
    // Порожній коментар — відмова САМОГО СТОРА, тому й тут це не мовчазний `return`:
    // «Заявити» без причини не відрізнити від випадкового кліку по кнопці.
    if (!note.trim()) {
      setClaimError('Напишіть, що саме не так: без цього заявку не приймають.')
      return
    }
    const doc = disputeTransfer(claim.id, {
      reportedCrates: Math.trunc(parseNumeric(crates)),
      reportedCash: parseNumeric(cash),
      note: note.trim(),
    })
    if (!doc) {
      setClaimError(
        'Заявку не прийнято: заявляє приймальник точки, числа мають бути невідʼємними, а переказ — ще в дорозі.',
      )
      return
    }
    setClaim(null)
  }

  return (
    /* Відступ живе тут, а не на сторінці: коли переказів у дорозі немає, компонент не
       рендерить нічого — порожня рамка з відступом лишила б дірку в макеті. */
    <div className="mb-5 flex flex-col gap-2">
      {pending.map((t) =>
        t.status === 'sent' ? (
          <div
            key={t.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-[var(--amber)]/10 px-4 py-3 ring-1 ring-[var(--amber)]/30"
          >
            <Truck className="size-5 shrink-0 text-[var(--amber)]" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                У дорозі:{' '}
                <span className="font-mono">{uah(t.cash, { decimals: 2 })}</span> і{' '}
                <span className="font-mono">{num(t.crates)}</span> ящ.
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {t.carrier} · відправлено {shortDate(t.date)} о {t.sentTime} · поки не
                натиснете «Прийняв», каса й наділ не рухаються
              </div>
            </div>
            {canAct ? (
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" onClick={() => accept(t)}>
                  <Check className="size-3.5" />
                  Прийняв
                </Button>
                <Button size="sm" variant="outline" onClick={() => openClaim(t)}>
                  Не сходиться
                </Button>
              </div>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">приймає точка</span>
            )}
          </div>
        ) : (
          <div
            key={t.id}
            className="rounded-xl bg-destructive/10 px-4 py-3 ring-1 ring-destructive/25"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-destructive">
              <TriangleAlert className="size-4 shrink-0" />
              Заявлено «не сходиться» — переказ від {shortDate(t.date)}
            </div>
            <div className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Відправлено <span className="font-mono">{uah(t.cash, { decimals: 2 })}</span> і{' '}
              <span className="font-mono">{num(t.crates)}</span> ящ. · ви нарахували{' '}
              <span className="font-mono">
                {uah(t.reportedCash ?? 0, { decimals: 2 })}
              </span>{' '}
              і <span className="font-mono">{num(t.reportedCrates ?? 0)}</span> ящ.
            </div>
            {t.disputeNote ? (
              <div className="mt-1 text-xs italic text-muted-foreground">«{t.disputeNote}»</div>
            ) : null}
            <div className="mt-2 text-xs text-muted-foreground">
              Каса не змінилася ні на копійку. Керівник розбереться і подасть переказ
              заново — на точці цю цифру не правлять.
            </div>
          </div>
        ),
      )}

      <Dialog
        open={claim !== null}
        onOpenChange={(v) => {
          if (!v) setClaim(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Не сходиться</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">
              Напишіть, скільки приїхало насправді. Суму переказу це не змінить — заявку
              закриває керівник новим документом.
            </p>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Грошей привезли, ₴</span>
                <Input
                  value={cash}
                  onChange={(e) => setCash(maskDecimalInput(e.target.value, 2))}
                  inputMode="decimal"
                  className="font-mono"
                />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-muted-foreground">Ящиків, шт</span>
                <Input
                  value={crates}
                  onChange={(e) => setCrates(maskDecimalInput(e.target.value, 0))}
                  inputMode="numeric"
                  className="font-mono"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Що саме не так</span>
              <Textarea
                value={note}
                onChange={(e) => {
                  setNote(e.target.value)
                  setClaimError('')
                }}
                rows={2}
                placeholder="Порахували при перевізнику: двох ящиків не було"
              />
            </label>
            {claimError ? <p className="text-xs text-destructive">{claimError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClaim(null)}>
              Скасувати
            </Button>
            <Button onClick={submitClaim} disabled={!note.trim()}>
              Заявити
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
