import * as React from 'react'
import { Send, Undo2 } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { maskDecimalInput, ownerName, parseNumeric, round2 } from '@/lib/calc'
import { num, uah, uahAuto } from '@/lib/format'
import { useCashStanding, useCrateStanding, useStore } from '@/lib/store'
import type { ISODate, Transfer } from '@/lib/types'

/**
 * Форма переказу база → точка (`21 §2.6`, `Н18`; `UC-37` і крок 3 `UC-36`).
 *
 * Три речі тут не косметичні.
 *
 * 1. **Сума підставлена ПОВНІСТЮ, але її можна зменшити.** «Керівник віддає, наприклад,
 *    тільки 150. Тобто виходить, що ще мінус, типу, ще 100 лишається. Він має надати…
 *    тобто частинами» (1189–1191). Часткове гасіння — норма, а не виняток, тому поле
 *    відкрите, а не показане тільки для читання.
 * 2. **Перевізник — ТЕКСТ** (рішення `Р-2`): «підписує в зошиті перевізник» (1014). Це не
 *    обліковий запис і не третя роль — ролей у системі лишається рівно дві.
 * 3. **Стеля переказу — заборгованість**, а не будь-яке число. Наділ і є та сума, яку точка
 *    має тримати; переказ понад неї зробив би «не хватає до наділу» відʼємним, і рядок,
 *    заради якого цей екран існує, почав би показувати число, якого база нікому не винна.
 *    Тому ввід підрізається до заборгованості, а поруч стоїть кнопка «уся заборгованість».
 *
 * **ЯЩИКИ ЙДУТЬ НЕ ЗА ТИМ ЧИСЛОМ, ЩО ГРОШІ, І ЦЕ ГОЛОВНА ПРАВКА ЦЬОГО ФАЙЛА.** Гроші
 * підставляються за заборгованістю, а ящики — за `atBase`: базі належить лише те, що вона
 * ТРИМАЄ. `shortfall = inField + atBase`, і на Шипинках 04.08 це 459 проти 264 — 195
 * ящиків лежать у ЛЮДЕЙ, переказом вони не вертаються взагалі. Форма підставляла 459,
 * `checkCrateTransfer` (стор) від 04.08 таке ВІДМОВЛЯЄ — тобто кнопка «Надіслати» мовчки
 * нічого не робила б. Тепер поле підставлене і підрізане по `atBase`, а 459 лишається
 * НА ЕКРАНІ окремим рядком із поясненням, чому ці числа різні.
 *
 * Режим виправлення (`original ≠ null`) — це `UC-36` крок 3: старий документ СТОРНУЄТЬСЯ, а
 * новий народжується з `correctionOf`. Правки старого немає взагалі (`06 §3`), і причина
 * сторно обовʼязкова — стор відмовить у команді з порожньою причиною, тому форма питає її
 * тим самим правилом, а не «на всяк випадок».
 *
 * Числа підставляються ФАКТИЧНІ — ті, що нарахувала точка. `I69` каже, що цю цифру на точці
 * не правлять; тут вона стає документом, який подає керівник.
 */
export function SendTransferDialog({
  pointId,
  pointName,
  date,
  original,
  open,
  onOpenChange,
}: {
  pointId: string | null
  pointName: string
  date: ISODate
  /** Документ, який сторнуємо і подаємо заново; `null` — звичайне надсилання */
  original: Transfer | null
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  // Хук викликається безумовно і рівно один раз: точка тут ЗАВЖДИ одна. Закритий діалог
  // читає порожній id — рушій віддає на нього нулі й `null`, а не NaN.
  const cash = useCashStanding(pointId ?? '', date)
  const crates = useCrateStanding(pointId ?? '', date)
  const sendTransfer = useStore((s) => s.sendTransfer)
  const voidTransfer = useStore((s) => s.voidTransfer)
  const users = useStore((s) => s.users)

  const owed = cash.floatShortfall
  const reportedCash = original?.reportedCash ?? original?.cash ?? 0
  const reportedCrates = original?.reportedCrates ?? original?.crates ?? 0
  const suggestedCash = original ? reportedCash : Math.max(0, owed ?? 0)
  // Стеля не може виявитися нижчою за факт, який ми ж і підставили: заявлений «не
  // сходиться» переказ не рухає нічого (`I68`), тому заборгованість його вже містить —
  // але покладатися на це мовчки не можна.
  const maxCash = Math.max(0, owed ?? 0, suggestedCash)
  // Ящикова стеля — ЖОРСТКА, і на відміну від грошової вона НЕ піднімається під факт:
  // `checkCrateTransfer(units, atBase)` у сторі відмовить, а відмова без причини на екрані
  // — це та сама мовчазна кнопка, від якої рятує решта цього файла. Тому заявлене точкою
  // число теж підрізається, і рядок під полем каже, що саме підрізано.
  const maxCrates = Math.max(0, crates.atBase)
  const suggestedCrates = Math.min(maxCrates, original ? reportedCrates : maxCrates)
  // «Не хватає» і «база тримає» — два різні числа, і поки вони різні, форма це каже вголос.
  const heldBackByPeople = crates.shortfall > maxCrates

  const [cashInput, setCashInput] = React.useState('')
  const [cratesInput, setCratesInput] = React.useState('')
  const [carrier, setCarrier] = React.useState('')
  const [reason, setReason] = React.useState('')

  // Підставляємо ЛИШЕ поки форма відкрита: `if (!open) return` — не оптимізація, а те, що
  // робить підставлення подією відкриття. Залежності перелічені всі, включно з самими
  // підставленими числами (`react-hooks/exhaustive-deps` — помилка, а не порада), і це
  // безпечно рівно тому, що порівняння йде ПО ЗНАЧЕННЮ: поки керівник набирає суму, ніхто
  // з цього екрана в стор не пише, значення не змінюється, і поле під руками не переписується.
  React.useEffect(() => {
    if (!open) return
    setCashInput(String(suggestedCash))
    setCratesInput(String(suggestedCrates))
    setCarrier(original?.carrier ?? '')
    setReason('')
  }, [open, pointId, original?.id, original?.carrier, suggestedCash, suggestedCrates])

  const cashValue = Math.min(maxCash, Math.max(0, parseNumeric(cashInput)))
  const cratesValue = Math.min(maxCrates, Math.max(0, Math.round(parseNumeric(cratesInput))))
  // Рахуємо ТУТ, у змінних, а не в дужках форматера: `uah()` друкує вже готове число.
  const afterBerry = round2(cash.berryCash + cashValue)
  const afterOwed = owed === null ? null : round2(owed - cashValue)
  const afterCrates = crates.shortfall - cratesValue

  const carrierMissing = carrier.trim().length === 0
  const reasonMissing = original !== null && reason.trim().length === 0
  const nothingToSend = cashValue <= 0 && cratesValue <= 0
  const blocked = carrierMissing || reasonMissing || nothingToSend || pointId === null

  function submit() {
    if (pointId === null || blocked) return
    // Порядок має значення: спершу сторно старого, потім новий документ. Якби новий ішов
    // першим, а сторно відмовило, точка отримала б ДВА живі перекази на ту саму поїздку.
    if (original) {
      const voided = voidTransfer(original.id, reason.trim(), ownerName(users))
      if (!voided) {
        toast.error('Сторнувати не вдалося', {
          description: 'Причина сторно обовʼязкова, і сторнує лише керівник.',
        })
        return
      }
    }
    const doc = sendTransfer({
      pointId,
      crates: cratesValue,
      cash: cashValue,
      carrier: carrier.trim(),
      correctionOf: original?.id,
    })
    if (!doc) {
      toast.error('Переказ не пройшов', {
        description: `Створити переказ може лише керівник, і ящиків не більше, ніж база тримає (${num(maxCrates)}).`,
      })
      return
    }
    onOpenChange(false)
    toast.success(`Відправлено на ${pointName}`, {
      description: `${uahAuto(doc.cash)} і ${num(doc.crates)} ящ. Поки точка не натисне «Прийняв», ні гроші, ні ящики їй не зараховані.`,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {original ? 'Сторнувати і подати заново' : 'Надіслати на точку'} — {pointName}
          </DialogTitle>
          <DialogDescription>
            {original
              ? 'Старий документ лишається в історії зі станом «сторновано» і причиною, а новий подається замість нього. На точці цю цифру не правлять — виправляє керівник.'
              : 'Перевізник везе гроші й порожні ящики однією поїздкою. Гасити можна частинами: сума підставлена повністю, але її можна зменшити.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {original ? (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <div>
                Відправляли {uahAuto(original.cash)} і {num(original.crates)} ящ., точка
                нарахувала {uahAuto(reportedCash)} і {num(reportedCrates)} ящ.
              </div>
              {original.disputeNote ? (
                <div className="mt-1 text-xs opacity-90">«{original.disputeNote}»</div>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="transfer-cash">Гроші на ягоду</Label>
              <Input
                id="transfer-cash"
                value={cashInput}
                onChange={(e) => setCashInput(maskDecimalInput(e.target.value))}
                inputMode="decimal"
                className="h-11 font-mono text-lg"
              />
            </div>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setCashInput(String(maxCash))}
            >
              Уся заборгованість — {uahAuto(maxCash)}
            </Button>
          </div>

          <div className="flex items-end gap-3">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="transfer-crates">Порожніх ящиків назад</Label>
              <Input
                id="transfer-crates"
                value={cratesInput}
                onChange={(e) => setCratesInput(maskDecimalInput(e.target.value, 0))}
                inputMode="numeric"
                className="h-11 font-mono text-lg"
              />
            </div>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setCratesInput(String(maxCrates))}
            >
              Усі, що в нас — {num(maxCrates)}
            </Button>
          </div>

          {heldBackByPeople ? (
            <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">
              Не хватає до наділу {num(crates.shortfall)} ящ., а база тримає{' '}
              {num(crates.atBase)}: решта {num(crates.inField)} у людей. Ці переказом не
              вертаються — їх приносять самі здавальники, тому надіслати більше за{' '}
              {num(maxCrates)} не можна.
            </p>
          ) : null}

          <div className="grid gap-1.5">
            {/* Р-2: перевізник — ТЕКСТ, а не обліковий запис. Ролей у системі лишається дві. */}
            <Label htmlFor="transfer-carrier">Перевізник</Label>
            <Input
              id="transfer-carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="хто фізично везе"
              className="h-11"
            />
            {carrierMissing ? (
              <p className="text-xs text-muted-foreground">
                Впишіть, хто везе: у зошиті за цю поїздку розписується він.
              </p>
            ) : null}
          </div>

          {original ? (
            <div className="grid gap-1.5">
              <Label htmlFor="transfer-reason">Причина сторно</Label>
              <Textarea
                id="transfer-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="що саме не зійшлося і як розібралися"
                className="min-h-16"
              />
              {reasonMissing ? (
                <p className="text-xs text-muted-foreground">
                  Без причини сторно не проходить: документ після нього вже не повернути.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <div className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
              Після прийняття
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-sm">
              <span>
                у касі <span className="font-semibold">{uah(afterBerry, { decimals: 2 })}</span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span>
                не хватає{' '}
                <span className="font-semibold">
                  {afterOwed === null ? '—' : uah(afterOwed, { decimals: 2 })}
                </span>
              </span>
              <span className="text-muted-foreground">·</span>
              <span>
                ящиків не хватає <span className="font-semibold">{num(afterCrates)}</span>
              </span>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Це те, що буде, коли точка натисне «Прийняв». Доти переказ не рухає ні касу, ні
              наділ.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit} disabled={blocked}>
            {original ? <Undo2 className="size-4" /> : <Send className="size-4" />}
            {original ? 'Сторнувати і подати' : 'Надіслати'} {uahAuto(cashValue)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
