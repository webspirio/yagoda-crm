import { Ban, Check, TriangleAlert, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Transfer } from '@/lib/types'

/**
 * Стан переказу — словами КЛІЄНТА, дослівно з ескіза `21 §5` (Н18): «у дорозі»,
 * «прийняв», «не сходиться». Не «pending», не «в обробці», не «розбіжність»: у словнику
 * `21 §1` ліва колонка — це те, що людина каже вголос, і саме вона друкується.
 *
 * Чому «у дорозі» бурштинове, а не червоне: затримка — ВЛАСТИВІСТЬ процесу, а не аварія.
 * «Наший перевізник ввечері сідає і їде на точку… це не півтори години, десь так» (1014).
 * Переказ у цьому стані живе годинами, і червоний колір навчив би керівника дивитися на
 * нормальний хід речей як на поломку.
 *
 * «Сторновано» лишається окремим станом, а не зникненням рядка: документ не витирається
 * (`06 §3`), і в історії точки він мусить бути видний разом із причиною.
 */
const STATES = {
  sent: {
    label: 'у дорозі',
    icon: Truck,
    className: 'border-[var(--amber)]/40 text-[var(--amber)]',
  },
  accepted: {
    label: 'прийняв',
    icon: Check,
    className: 'border-[var(--leaf)]/40 text-[var(--leaf)]',
  },
  disputed: {
    label: 'не сходиться',
    icon: TriangleAlert,
    className: 'border-destructive/40 text-destructive',
  },
  void: {
    label: 'сторновано',
    icon: Ban,
    className: 'border-border text-muted-foreground',
  },
} as const

export function TransferStateBadge({
  status,
  className,
}: {
  status: Transfer['status']
  className?: string
}) {
  const state = STATES[status]
  const Icon = state.icon
  return (
    <Badge variant="outline" className={cn(state.className, className)}>
      <Icon />
      {state.label}
    </Badge>
  )
}
