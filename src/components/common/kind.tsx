import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { KIND_LABEL } from '@/lib/kind'
import type { SupplierKind } from '@/lib/types'

/**
 * Маркер ОПТ / Фермер. Один вигляд на весь застосунок: він стоїть у рядку списку
 * постачальників, у кнопці комбобокса на прийомці й на картці людини. Раніше той самий
 * блок був виписаний у трьох місцях трьома руками — і варіант бейджа для фермера
 * розійшовся б із першою ж правкою. «Не на сорт получається, а на фамілію» (M24).
 */
export function KindBadge({ kind, className }: { kind: SupplierKind; className?: string }) {
  if (kind === 'none') return null
  return (
    <Badge variant={kind === 'wholesale' ? 'secondary' : 'outline'} className={className}>
      {KIND_LABEL[kind]}
    </Badge>
  )
}

/**
 * Тристановий вибір маркера. Три кнопки, а не селект: на планшеті в полі це надійніше.
 * Ставить і змінює приймальник — «цей маркер можна змінювати і в процесі роботи…
 * приймальник це нічого» (В3 → варіант В, дзвінок №4, ряд. 739–741), тому черги
 * погодження немає й обмеження по ролі теж.
 */
export function KindChoice({
  value,
  onChange,
}: {
  value: SupplierKind
  onChange: (k: SupplierKind) => void
}) {
  return (
    <>
      <div className="mt-0.5 text-xs text-muted-foreground">
        Маркер стоїть на людині, не на сорті. Базову ціну не змінює — тільки дод. ціну
      </div>
      <div className="mt-2 grid max-w-md grid-cols-3 gap-1.5">
        {(['none', 'wholesale', 'farmer'] as const).map((k) => (
          <Button
            key={k}
            type="button"
            variant={value === k ? 'default' : 'outline'}
            className="h-10"
            onClick={() => onChange(k)}
          >
            {k === 'none' ? 'Без позначки' : KIND_LABEL[k]}
          </Button>
        ))}
      </div>
    </>
  )
}
