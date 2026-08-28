import * as React from 'react'
import { ArrowDownRight, ArrowUpRight, Clock, Lock, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Eyebrow, PageHeader } from '@/components/common/bits'
import { Sparkline } from '@/components/common/Sparkline'
import { useScope, useStore } from '@/lib/store'
import { addDays, longDate, num } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Berry } from '@/lib/types'

export function PricesPage() {
  /*
   * ЦІНА ДЛЯ ПРИЙМАЛЬНИКА — ПОКАЗАНА, А НЕ СХОВАНА, і це не те саме, що зроблено з
   * кнопками. `06 §5.4` розводить два випадки, і саме поле ціни називає поіменно:
   * read-only ЧЕРЕЗ РОЛЬ мусить лишитися на екрані «значення + іконка замка + підпис»,
   * бо «приховане поле породжує підозру й дзвінки; заблоковане з підписом вчить правилу».
   * Ціле ДІЙСТВО (кнопка «Перерахувати касу», `CashCountPanel`) навпаки прибирається
   * зовсім — «заблокована кнопка вчить шукати обхід, відсутня не вчить нічого».
   *
   * До 28.08.2026 тут не читалася роль ВЗАГАЛІ: приймальник відкривав вікно, набирав ціну,
   * тиснув «Зберегти ціну» — і щоразу отримував відмову стору. `23 §6` це навіть
   * санкціонувала («відмова видима»), і виправлено саме спеку, а не лише код
   * (`23 §6`, датована поправка).
   */
  const { role } = useScope()
  const canSetPrice = role === 'owner'
  const berries = useStore((s) => s.berries)
  const products = useStore((s) => s.products)
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const priceFor = useStore((s) => s.priceFor)
  const priceHistory = useStore((s) => s.priceHistory)
  const prices = useStore((s) => s.prices)
  const setPrice = useStore((s) => s.setPrice)
  const setPriceEverywhere = useStore((s) => s.setPriceEverywhere)
  const settings = useStore((s) => s.settings)
  // аркуш іде за обраною датою, а не за «сьогодні»: керівник рахує вчорашній день
  // зранку ✓ M38. Дату перемикають у «Касі» — `workDate` спільний на весь застосунок
  const workDate = useStore((s) => s.workDate)

  const [editing, setEditing] = React.useState<{ berry: Berry; pointId: string } | null>(null)
  const [value, setValue] = React.useState('')
  const [reason, setReason] = React.useState('')

  // `retired` — сорт виведений з обігу («Опт забрати просто вже»): з аркуша цін зникає,
  // історичні квитанції на нього лишаються валідними ✓ З2
  const activeBerries = berries.filter(
    (b) => !b.retired && workDate >= b.from && workDate <= b.to,
  )
  // колонки — тільки ті пункти, що реально приймають: решта п'ять стоять у реєстрі
  // й ціни в них немає ✓ PART A («від 5 до 10»). Склад серед активних: «склад тоже
  // считається як одна прийомка, але тут типа як оптові ціни» ✓ M37
  const tradingPoints = points.filter((p) => p.active)
  // «Загальна» — про пункти прийому. Склад має власну, оптову ціну (M37), тому в
  // спільність не входить: інакше кожен рядок читався б «різні» лише через нього
  const commonPoints = tradingPoints.filter((p) => p.kind === 'reception')
  // Товар → Сорт, 9 → 17 ✓ PART A. Ключем ціни лишається сорт; товар — тільки заголовок
  const groups = products.map((p) => ({
    product: p,
    grades: activeBerries.filter((b) => b.product === p.name),
  })).filter((g) => g.grades.length > 0)

  /**
   * Ціна дня загальна по сорту — рахована саме по тому набору пунктів, на який пише
   * `setPriceEverywhere`: активні пункти прийому, БЕЗ складу. Інакше колонка обіцяла б
   * згоду, якої екшн не робить. `null` — ціни немає ніде; `common` — стоїть однаково
   * на всіх; інакше діапазон, і той лише з визначених значень: `num(undefined)`
   * друкує рівно `NaN`.
   */
  function dayPrice(berryId: string) {
    const known: number[] = []
    let missing = 0
    for (const p of commonPoints) {
      const v = priceFor(workDate, p.id, berryId)
      if (v === undefined) missing += 1
      else known.push(v)
    }
    if (!known.length) return null
    const min = Math.min(...known)
    const max = Math.max(...known)
    return { common: !missing && min === max ? min : undefined, min, max }
  }

  function openEdit(berry: Berry, pointId: string) {
    setEditing({ berry, pointId })
    const current =
      pointId === 'all' ? dayPrice(berry.id)?.common : priceFor(workDate, pointId, berry.id)
    setValue(String(current ?? berry.basePrice))
    setReason('')
  }

  function submit() {
    if (!editing) return
    const v = Number(value.replace(',', '.'))
    if (!v || v <= 0) {
      toast.error('Введіть ціну')
      return
    }
    const everywhere = editing.pointId === 'all'
    const args = {
      date: workDate,
      berryId: editing.berry.id,
      price: v,
      reason: reason.trim() || undefined,
    }
    /*
     * Підпис під записом журналу більше не збирається ТУТ: його ставить стор із сесії
     * (`author: signOf(st)`). До фази 4 екран підписував запис рядком «Приймальник», коли
     * роль була не власницька, — тобто журнал цін показував автора, якого не існує, а
     * саму ціну міняв будь-хто.
     *
     * Обидві гілки зводяться в ОДНЕ значення, бо відмова в них одна й та сама: `undefined`
     * означає «ціну дня виставляє лише керівник», і мовчазна кнопка тут була б гіршою за
     * відмову, названу вголос.
     *
     * ⚠️ З 28.08.2026 ЦЯ ВІДМОВА НЕДОСЯЖНА З ЕКРАНА і лишається запобіжною сіткою — та
     * сама форма, що в `CashCountPanel`. Дійти сюди приймальник більше не може: комірки
     * ціни для нього нередаговані, вікна він не відкриває. Тост лишено навмисно: `06 §5.3`
     * («UI лише ПОВТОРЮЄ рішення рушія») працює в обидва боки — рушій мусить відмовляти й
     * тоді, коли екран уже не пропонує, бо екран колись перепишуть, а стор лишиться.
     */
    const doc = everywhere
      ? setPriceEverywhere(args)
      : setPrice({ ...args, pointId: editing.pointId })
    if (!doc) {
      toast.error('Ціну не змінено', { description: 'Ціну дня виставляє лише керівник.' })
      return
    }
    toast.success(`${editing.berry.name} — ${num(v)} ₴/кг`, {
      description: everywhere
        ? 'Стала на всіх пунктах прийому. Склад лишився зі своєю ціною. Попередні квитанції не змінюються.'
        : 'Нова ціна діє з цієї хвилини. Попередні квитанції не змінюються.',
    })
    setEditing(null)
  }

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        eyebrow={longDate(workDate)}
        title="Ціни дня"
        /*
          Підпис теж залежить від ролі, і це не косметика: «Виставте загальну і підправте
          окремі» — це інструкція до дії, якої в приймальника немає. Лишити її над рядком
          «ціну виставляє керівник» означало б, що екран каже дві протилежні речі одна під
          одною.
        */
        description={
          canSetPrice
            ? 'Ціна на кожну точку своя: «чим дальше воно знаходиться, тим більше розтрат», де конкуренція — дорожче. Виставте загальну і підправте окремі. Змінювати можна кілька разів на день — кожна зміна лишає слід: хто, коли і чому.'
            : 'Ціна на кожну точку своя: «чим дальше воно знаходиться, тим більше розтрат», де конкуренція — дорожче. Мінятися вона може кілька разів на день, і квитанції до зміни лишаються за старою ціною.'
        }
      />

      {/*
        ОДИН РЯДОК НА ВЕСЬ ЕКРАН, а не підпис під кожною коміркою: правило одне, і
        повторене сімнадцять разів воно перестає читатися. Замок стоїть біля кожного
        значення нижче — він показує, ЩО саме нередаговане; цей абзац каже ЧОМУ.
      */}
      {canSetPrice ? null : (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
          <Lock className="mt-0.5 size-4 shrink-0" />
          <span>
            Ціну дня виставляє керівник — тут вона лише показана. Кожна зміна лишає слід:
            хто, коли і чому, і цей журнал видно вам так само, як йому.
          </span>
        </div>
      )}

      {activePointId === 'all' ? (
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Сорт</TableHead>
                <TableHead className="w-[150px]">Ціна за 14 днів</TableHead>
                <TableHead className="w-[150px] text-right">Ціна дня загальна</TableHead>
                {tradingPoints.map((p) => (
                  <TableHead key={p.id} className="text-right">
                    {p.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <React.Fragment key={g.product.id}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={3 + tradingPoints.length}
                      className="bg-muted/40 py-1.5 text-[11px] font-medium tracking-[0.16em] uppercase"
                    >
                      {g.product.name}
                    </TableCell>
                  </TableRow>
                  {g.grades.map((b) => {
                    const day = dayPrice(b.id)
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="pl-6">
                          <span className="font-medium">{b.name}</span>
                          {b.wholesale ? (
                            <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                              ОПТ
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <PriceTrend berryId={b.id} />
                        </TableCell>
                        <TableCell className="text-right">
                          {day === null ? (
                            <PriceMissing editable={canSetPrice} onEdit={() => openEdit(b, 'all')} />
                          ) : (
                            <PriceCell editable={canSetPrice} onEdit={() => openEdit(b, 'all')}>
                              {day.common !== undefined ? (
                                <span className="font-mono font-medium">{num(day.common)} ₴</span>
                              ) : (
                                <>
                                  {/* однакова, але не на всіх пунктах — це не «різні»:
                                      ціна просто виставлена ще не всюди */}
                                  <span className="text-xs text-muted-foreground">
                                    {day.min === day.max ? 'не всюди ·' : 'різні ·'}
                                  </span>
                                  <span className="font-mono text-xs font-medium">
                                    {day.min === day.max
                                      ? num(day.min)
                                      : `${num(day.min)}–${num(day.max)}`}
                                  </span>
                                </>
                              )}
                            </PriceCell>
                          )}
                        </TableCell>
                        {tradingPoints.map((p) => {
                          const price = priceFor(workDate, p.id, b.id)
                          const hist = priceHistory(workDate, p.id, b.id)
                          const changed = hist.length > 1
                          return (
                            <TableCell key={p.id} className="text-right">
                              {price === undefined ? (
                                <PriceMissing editable={canSetPrice} onEdit={() => openEdit(b, p.id)} />
                              ) : (
                                <PriceCell editable={canSetPrice} onEdit={() => openEdit(b, p.id)}>
                                  <span className="font-mono font-medium">{num(price)} ₴</span>
                                  {changed ? (
                                    <PriceDelta from={hist[0].price} to={price} />
                                  ) : null}
                                </PriceCell>
                              )}
                            </TableCell>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <div key={g.product.id}>
              <Eyebrow className="mb-2">{g.product.name}</Eyebrow>
              <div className="grid gap-3 md:grid-cols-2">
                {g.grades.map((b) => {
                  const pointId = activePointId
                  const price = priceFor(workDate, pointId, b.id)
                  const hist = priceHistory(workDate, pointId, b.id)
                  return (
                    <div
                      key={b.id}
                      className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-medium">{b.name}</span>
                            {b.wholesale ? (
                              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                                ОПТ
                              </Badge>
                            ) : null}
                          </div>
                          <div className="mt-1 flex items-baseline gap-2">
                            <span className="font-mono text-3xl font-semibold">
                              {price !== undefined ? num(price) : '—'}
                            </span>
                            <span className="text-sm text-muted-foreground">₴/кг</span>
                            {hist.length > 1 ? (
                              <PriceDelta from={hist[0].price} to={price!} />
                            ) : null}
                          </div>
                        </div>
                        {canSetPrice ? (
                          <Button variant="outline" size="sm" onClick={() => openEdit(b, pointId)}>
                            <Pencil className="size-3.5" />
                            Змінити
                          </Button>
                        ) : (
                          /*
                            Підпис РІВНО тієї форми, яку називає `06 §5.4`: «значення +
                            іконка замка + підпис «ціна дня, встановила Таня о 07:40»».
                            Автор і час беруться з ОСТАННЬОГО запису журналу (`priceHistory`
                            віддає за зростанням часу), бо саме він і є діюча ціна.
                          */
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <Lock className="size-3.5" />
                            {hist.length
                              ? `ціна дня · ${hist[hist.length - 1].author} о ${hist[hist.length - 1].time}`
                              : 'ціна дня'}
                          </span>
                        )}
                      </div>

                      {hist.length ? (
                        <div className="mt-4 border-t border-border/70 pt-3">
                          <Eyebrow className="mb-2">Історія за цей день</Eyebrow>
                          <ul className="flex flex-col gap-1.5">
                            {hist.map((h) => (
                              <li key={h.id} className="flex items-start gap-2 text-xs">
                                <Clock className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
                                <span className="font-mono text-muted-foreground">{h.time}</span>
                                <span className="font-mono font-medium">{num(h.price)} ₴</span>
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                  {h.reason ? `— ${h.reason}` : ''}
                                </span>
                                <span className="shrink-0 text-muted-foreground">{h.author}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {activePointId === 'all' ? <IntradayChanges /> : null}

      {/* Надбавка більше не властивість постачальника: Дод. ціна — по рядку прийомки,
          як їхня колонка J ✓ M7, PART F #4. Межі задає керівник у «Тара і сорти» */}
      <div className="mt-5 rounded-xl border border-dashed border-border p-4">
        <div className="flex flex-wrap items-baseline gap-2 text-sm">
          <Badge variant="secondary">Дод. ціна</Badge>
          <span className="max-w-3xl text-muted-foreground">
            Надбавка ставиться на кожен рядок окремо, а не на постачальника: «не 100, а 105 чи
            110». Мінус так само реальний: «то ми закрили мінус 30, бо далека дорога». Межі — від{' '}
            {num(settings.surchargeMin)} до {num(settings.surchargeMax)} ₴/кг, задає керівник. Поза
            межами поле значення не приймає — запит іде на підтвердження.
          </span>
        </div>
      </div>

      <div className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Записів про ціни в базі: <span className="font-mono">{prices.length}</span>. Одна дата й
        один сорт можуть мати кілька записів — у вашому файлі так було в 64 зі 175 комбінацій, до
        трьох різних цін на один сорт за день. В Excel це дефект, тут це журнал: квитанції до
        зміни лишаються за старою ціною.
      </div>

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>
              {editing?.pointId === 'all'
                ? `Ціна дня загальна · ${editing.berry.name}`
                : editing?.berry.name}
            </DialogTitle>
            <DialogDescription>
              {editing?.pointId === 'all'
                ? 'Стане на всіх пунктах прийому. Склад лишається зі своєю оптовою ціною — його правлять окремою клітинкою.'
                : `${points.find((p) => p.id === editing?.pointId)?.name} · нова ціна діятиме для наступних квитанцій.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="price">Ціна, ₴/кг</Label>
              <Input
                id="price"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                inputMode="decimal"
                className="h-12 font-mono text-xl font-semibold"
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Причина (необовʼязково)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Підняли — конкуренти в Гончарівці"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Скасувати
            </Button>
            <Button onClick={submit}>Зберегти ціну</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * ОБОЛОНКА КОМІРКИ ЦІНИ — одна розмітка на дві ролі, і різниця рівно в оболонці.
 *
 * Керівникові — кнопка з олівцем, як було. Приймальникові — те саме значення й замок
 * поруч (`06 §5.4`). Значення НЕ ховається і не сіріє: ціна дня — це те, за чим він
 * приймає ягоду, і сховати її означало б зламати екран заради права, якого він і так не
 * має.
 *
 * Спільний компонент, а не два дерева поруч: інакше зміна формату числа мусила б
 * потрапити у два місця, і рано чи пізно потрапила б в одне.
 */
function PriceCell({
  editable,
  onEdit,
  children,
}: {
  editable: boolean
  onEdit: () => void
  children: React.ReactNode
}) {
  if (!editable) {
    return (
      <span className="inline-flex items-center gap-1.5">
        {children}
        <Lock className="size-3 text-muted-foreground/60" />
      </span>
    )
  }
  return (
    <button onClick={onEdit} className="group inline-flex items-center gap-1.5">
      {children}
      <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-50" />
    </button>
  )
}

/**
 * Ціни на цей пункт ще немає. Керівникові це запрошення («встановити»), приймальникові —
 * факт: прочерк. Кнопки «встановити» для нього тут не малюють з тієї самої причини, з якої
 * прибрано «Перерахувати касу» в `CashCountPanel`: це ціле ДІЙСТВО, а не поле.
 */
function PriceMissing({ editable, onEdit }: { editable: boolean; onEdit: () => void }) {
  if (!editable) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <button onClick={onEdit} className="text-xs text-muted-foreground underline decoration-dotted">
      встановити
    </button>
  )
}

/** Price of the main point over the last two weeks — context for the chosen day's number. */
function PriceTrend({ berryId }: { berryId: string }) {
  const prices = useStore((s) => s.prices)
  const workDate = useStore((s) => s.workDate)
  const values = React.useMemo(() => {
    const out: number[] = []
    for (let i = 13; i >= 0; i--) {
      const d = addDays(workDate, -i)
      const list = prices
        .filter((p) => p.date === d && p.pointId === 'p1' && p.berryId === berryId)
        .sort((a, b) => a.time.localeCompare(b.time))
      if (list.length) out.push(list[list.length - 1].price)
    }
    return out
  }, [prices, berryId, workDate])

  if (values.length < 2) {
    return <span className="text-xs text-muted-foreground">новий сорт</span>
  }
  const diff = values[values.length - 1] - values[0]
  return (
    <div className="flex items-center gap-2">
      <div className="w-[76px]">
        <Sparkline values={values} height={26} zeroBased={false} />
      </div>
      <span
        className={cn(
          'font-mono text-[11px]',
          diff > 0 ? 'text-[var(--leaf)]' : diff < 0 ? 'text-[var(--amber)]' : 'text-muted-foreground',
        )}
      >
        {diff > 0 ? '+' : diff < 0 ? '−' : ''}
        {num(Math.abs(diff))} ₴
      </span>
    </div>
  )
}

/** Everything that moved after the morning price was set. */
function IntradayChanges() {
  const prices = useStore((s) => s.prices)
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const workDate = useStore((s) => s.workDate)

  const changes = prices
    .filter((p) => p.date === workDate && p.time !== '07:30')
    .sort((a, b) => b.time.localeCompare(a.time))

  return (
    <div className="mt-5 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
      <Eyebrow className="mb-3">Зміни протягом дня</Eyebrow>
      {changes.length ? (
        <ul className="flex flex-col gap-1.5">
          {changes.map((c) => {
            const morning = prices.find(
              (p) => p.date === c.date && p.pointId === c.pointId && p.berryId === c.berryId,
            )
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-2.5 text-sm">
                <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs text-muted-foreground">{c.time}</span>
                <span className="font-medium">{points.find((p) => p.id === c.pointId)?.name}</span>
                <span className="text-muted-foreground">
                  {berries.find((b) => b.id === c.berryId)?.name}
                </span>
                <span className="font-mono text-xs">
                  {morning ? `${num(morning.price)} → ` : ''}
                  <b>{num(c.price)} ₴</b>
                </span>
                {c.reason ? (
                  <span className="truncate text-xs text-muted-foreground italic">
                    «{c.reason}»
                  </span>
                ) : null}
                <span className="ml-auto text-xs text-muted-foreground">{c.author}</span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Цього дня ціну ще не міняли — діють ранкові значення.
        </p>
      )}
    </div>
  )
}

function PriceDelta({ from, to }: { from: number; to: number }) {
  const diff = to - from
  if (!diff) return null
  const up = diff > 0
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded px-1 py-0.5 font-mono text-[11px] font-medium',
        up ? 'bg-[var(--leaf)]/12 text-[var(--leaf)]' : 'bg-[var(--amber)]/12 text-[var(--amber)]',
      )}
    >
      {up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {up ? '+' : '−'}
      {num(Math.abs(diff))}
    </span>
  )
}
