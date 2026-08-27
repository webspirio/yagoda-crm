import * as React from 'react'
import { Plus, Search, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/common/bits'
import { AddSupplierDialog } from '@/components/reception/SupplierPicker'
import { useStore } from '@/lib/store'
import { supplierBalanceAt, sum, topSuppliers } from '@/lib/calc'
import { KindBadge } from '@/components/common/kind'
import { kg, shortDate, uah, uahAuto } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { TopSupplierRow } from '@/lib/calc'
import type { SupplierKind } from '@/lib/types'

/** Період Н11: «сезон» — від `config.seasonStart` до `config.businessToday`, «день» — глобальний `workDate`. */
type Period = 'season' | 'day'
/** Порядок рядків Н11. Дефолт — вага ↓ («з більшого до меншого», `UC-33`). */
type SortBy = 'kg' | 'amount'

export function SuppliersPage() {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const points = useStore((s) => s.points)
  const berries = useStore((s) => s.berries)
  const activePointId = useStore((s) => s.activePointId)
  const workDate = useStore((s) => s.workDate)
  const role = useStore((s) => s.role)
  const go = useStore((s) => s.go)
  const config = useStore((s) => s.config)
  const [q, setQ] = React.useState('')
  const [addOpen, setAddOpen] = React.useState(false)
  const [onlyDebt, setOnlyDebt] = React.useState(false)
  const [period, setPeriod] = React.useState<Period>('season')
  const [sortBy, setSortBy] = React.useState<SortBy>('kg')
  const isOwner = role === 'owner'

  // на точці видно і своїх за довідником, і всіх, хто сюди реально возив — інакше людина
  // з'являлася б у «Залишках» пункту, але не в його ж списку постачальників
  const deliveredHere = React.useMemo(
    () => new Set(receptions.filter((r) => r.pointId === activePointId).map((r) => r.supplierId)),
    [receptions, activePointId],
  )

  // Е2: борг попунктний — «він цей борг з іншої точки забрати не може» (дзвінок №4, ряд. 902).
  const rows = React.useMemo(() => {
    return suppliers
      .filter(
        (s) =>
          activePointId === 'all' || s.homePointId === activePointId || deliveredHere.has(s.id),
      )
      .map((s) => {
        // Усі колонки рядка — по ОДНІЙ книзі. Раніше «Залишок» був попунктний, а «Здач»,
        // «Ягоди здано» і «Нараховано» — мережеві, і на точці рядок читався як помилка:
        // нараховано більше, ніж людина тут здавала. У режимі «Усі точки» звуження немає
        const items = receptions.filter(
          (r) => r.supplierId === s.id && (activePointId === 'all' || r.pointId === activePointId),
        )
        const last = items.length ? items[items.length - 1] : undefined
        return {
          supplier: s,
          count: items.length,
          net: sum(items, (r) => r.net),
          amount: sum(items, (r) => r.amount),
          // книга пункту — по прив'язках виплат, не по їхньому штампу: див. calc.ts
          balance: supplierBalanceAt(s.id, receptions, payouts, activePointId),
          last: last?.date,
        }
      })
      .filter((r) => {
        if (onlyDebt && r.balance <= 0.009) return false
        if (!q.trim()) return true
        const needle = q.toLowerCase()
        // телефон шукається, лише якщо він узагалі є: у їхньому Довіднику він порожній
        // у 209 з 209 рядків ✓ PART C 7, тому в жодного сіданого постачальника його немає
        return (
          r.supplier.name.toLowerCase().includes(needle) ||
          r.supplier.village.toLowerCase().includes(needle) ||
          (r.supplier.phone?.includes(needle) ?? false)
        )
      })
      .sort((a, b) => b.amount - a.amount)
  }, [suppliers, receptions, payouts, q, onlyDebt, activePointId, deliveredHere])

  const totalBalance = sum(rows, (r) => r.balance)

  // Н11 «Здавальники за вагою» (`M26`, `UC-33`) — питання керівниці «хто нам взагалі везе».
  // Межі періоду включні з обох боків; «сезон» — уся наявна історія квитанцій.
  const from = period === 'season' ? config.seasonStart : workDate
  const to = period === 'season' ? config.businessToday : workDate

  // Маркер ОПТ/Фермер стоїть на людині, а `TopSupplierRow` його не несе — беремо з довідника.
  const kindOf = React.useMemo(
    () => new Map<string, SupplierKind>(suppliers.map((s) => [s.id, s.kind])),
    [suppliers],
  )

  const ownerRows = React.useMemo(() => {
    // Вагу складає рушій: округлення й тай-брейк — його робота, не цієї сторінки.
    const all = topSuppliers(receptions, suppliers, berries, from, to)
    const needle = q.trim().toLowerCase()
    const found = needle
      ? all.filter(
          (r) =>
            r.name.toLowerCase().includes(needle) || r.village.toLowerCase().includes(needle),
        )
      : all
    // `topSuppliers()` уже віддає вагу ↓ з детермінованим тай-брейком — пересортовуємо лише
    // під «за сумою», і тим самим тай-брейком, щоб рядки не мінялися між перемальовуваннями.
    if (sortBy === 'kg') return found
    return [...found].sort(
      (a, b) =>
        b.amountTotal - a.amountTotal ||
        a.village.localeCompare(b.village, 'uk') ||
        a.name.localeCompare(b.name, 'uk'),
    )
  }, [receptions, suppliers, berries, from, to, q, sortBy])

  const listCount = isOwner ? ownerRows.length : rows.length

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        eyebrow={`${listCount} у списку`}
        title="Постачальники"
        description="Одна картка на людину. Квитанція посилається на цей запис, а не на набраний текст, тому описка не роздвоює людину на два залишки — але схожі записи все одно треба звіряти й зливати вручну."
        actions={
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Новий постачальник
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Прізвище або село"
            className="h-9 pl-9"
          />
        </div>
        {isOwner ? (
          <>
            {/* Період — межі фільтра наявних квитанцій, а не нова арифметика: аналітика за
                тиждень/місяць (`M28`) сюди не входить. */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
              <Button
                size="sm"
                variant={period === 'season' ? 'secondary' : 'ghost'}
                onClick={() => setPeriod('season')}
              >
                Сезон
              </Button>
              <Button
                size="sm"
                variant={period === 'day' ? 'secondary' : 'ghost'}
                onClick={() => setPeriod('day')}
              >
                День
              </Button>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-0.5">
              <span className="pl-1.5 text-xs text-muted-foreground">сорт.:</span>
              <Button
                size="sm"
                variant={sortBy === 'kg' ? 'secondary' : 'ghost'}
                onClick={() => setSortBy('kg')}
              >
                за вагою ↓
              </Button>
              <Button
                size="sm"
                variant={sortBy === 'amount' ? 'secondary' : 'ghost'}
                onClick={() => setSortBy('amount')}
              >
                за сумою ↓
              </Button>
            </div>
            {/* «по всіх пунктах», а НЕ «по всій мережі»: мережевий довідник (`M27`) клієнт
                скасувала — мережевим став цей ЗВІТ, а залишок лишається попунктним. */}
            <div className="ml-auto text-sm text-muted-foreground">
              {period === 'season'
                ? `сезон ${shortDate(config.seasonStart)} — ${shortDate(config.businessToday)}`
                : `день ${shortDate(workDate)}`}{' '}
              · вага складена по всіх пунктах
            </div>
          </>
        ) : (
          <>
            <Button
              variant={onlyDebt ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOnlyDebt((v) => !v)}
            >
              Тільки з залишком
            </Button>
            <div className="ml-auto text-sm text-muted-foreground">
              {activePointId === 'all'
                ? 'Залишок за нами по всіх точках'
                : 'Залишок за нами на цій точці'}{' '}
              <span className="font-mono font-semibold text-[var(--amber)]">
                {uah(totalBalance)}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        {isOwner ? (
          /* Н11: вигляд керівника. Приймальникові нижче лишається ТОЧНО та сама
             таблиця, що була до Н11 — на неї стоїть smoke, який відкриває цей
             розділ під роллю приймальника (`docs/10` З15 крок 4, `DoD 19`). */
          <OwnerTable
            rows={ownerRows}
            kindOf={kindOf}
            onOpen={(id) => go({ name: 'supplier', id })}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Постачальник</TableHead>
                <TableHead>Точка</TableHead>
                <TableHead className="text-right">Здач</TableHead>
                <TableHead className="text-right">Ягоди</TableHead>
                <TableHead className="text-right">Нараховано</TableHead>
                <TableHead className="text-right">Залишок</TableHead>
                <TableHead className="text-right">Остання здача</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.supplier.id}
                  className="cursor-pointer"
                  onClick={() => go({ name: 'supplier', id: r.supplier.id })}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                        <UserRound className="size-3.5 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{r.supplier.name}</span>
                          {/* Дод. ціна тепер по рядку прийомки, як їхня колонка J ✓ M7 — на
                              постачальнику надбавки немає, лишається сам маркер: ОПТ / Фермер */}
                          <KindBadge
                            kind={r.supplier.kind}
                            className="h-4 px-1.5 text-[10px]"
                          />
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.supplier.village} ·{' '}
                          {r.supplier.phone ? (
                            <span className="font-mono">{r.supplier.phone}</span>
                          ) : (
                            <span className="text-muted-foreground/70">телефон не вказано</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {points.find((p) => p.id === r.supplier.homePointId)?.name}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.count}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{kg(r.net, 1)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{uah(r.amount)}</TableCell>
                  <TableCell
                    className={cn(
                      'text-right font-mono text-sm',
                      r.balance > 0.009 ? 'font-semibold text-[var(--amber)]' : 'text-muted-foreground',
                    )}
                  >
                    {r.balance > 0.009 ? uahAuto(r.balance) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {r.last ? shortDate(r.last) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {listCount === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {isOwner && !q.trim()
              ? 'За цей період ніхто не здавав.'
              : 'Нікого не знайшли за цим запитом.'}
          </div>
        ) : null}
      </div>

      <AddSupplierDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pointId={activePointId === 'all' ? 'p1' : activePointId}
      />
    </div>
  )
}

/**
 * Н11 «Здавальники за вагою» (`09 §5`, `UC-33`, реалізує `M26`) — таблиця ЛИШЕ для
 * керівника. Порядок колонок дослівно за клієнтом: «спочатку населений пункт я би хотіла
 * бачити, потом фамілію… і загальну вагу… і сорт який-то».
 *
 * Підпис «Основний товар», а не «Основний сорт»: `topSuppliers().topProduct` агрегує
 * `Berry.product` — товар. `UC-33 А4` вимагає, щоб підпис не розходився з агрегацією.
 *
 * «Нараховано» — шоста колонка, якої в ескізі не було: без неї перемикач «за сумою ↓»
 * сортував би за числом, якого на екрані немає. Стоїть ПІСЛЯ маркера, тому п'ять
 * клієнтських колонок лишаються у своєму порядку.
 *
 * Фільтра по маркеру немає — клієнт від нього відмовилася. Залишку тут теж немає: він
 * попунктний (`Е2`), а ця таблиця складає вагу по всіх пунктах.
 */
function OwnerTable({
  rows,
  kindOf,
  onOpen,
}: {
  rows: TopSupplierRow[]
  kindOf: Map<string, SupplierKind>
  onOpen: (id: string) => void
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Населений пункт</TableHead>
          <TableHead>Прізвище</TableHead>
          <TableHead className="text-right">Загальна вага</TableHead>
          <TableHead>Основний товар</TableHead>
          <TableHead>Маркер</TableHead>
          <TableHead className="text-right">Нараховано</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          // Постачальника, якого немає в довіднику, рушій усе одно віддає (вага не зникає) —
          // тоді маркера немає й друкується «—», а не порожня клітинка.
          const kind = kindOf.get(r.supplierId) ?? 'none'
          return (
            <TableRow
              key={r.supplierId}
              className="cursor-pointer"
              onClick={() => onOpen(r.supplierId)}
            >
              <TableCell className="text-sm">{r.village || '—'}</TableCell>
              <TableCell className="font-medium">{r.name || '—'}</TableCell>
              <TableCell className="text-right font-mono text-sm">{kg(r.kgTotal)}</TableCell>
              <TableCell className="text-sm">{r.topProduct || '—'}</TableCell>
              <TableCell>
                {kind === 'none' ? (
                  <span className="text-sm text-muted-foreground">—</span>
                ) : (
                  <KindBadge kind={kind} />
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{uah(r.amountTotal)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
