import { Ban, Check, CircleHelp, TriangleAlert, Truck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import type { Transfer } from '@/lib/types'

interface StateLook {
  label: string
  icon: LucideIcon
  className: string
}

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
 *
 * ТИП КЛЮЧА — `string`, А НЕ `Transfer['status']`, І ЦЕ НАВМИСНО. Статус приїжджає з
 * `localStorage` через `persist`, а `ratchet:persist` вимагає звуження лише на верхньому
 * рівні ключів стору — про рядок усередині `Transfer` він не каже нічого. Тобто payload,
 * правлений руками (або залишений від старої версії), може принести сюди «pending», і
 * `STATES[status].icon` на ньому кидав би виняток у рендері — тобто БІЛИЙ ЕКРАН на всьому
 * розділі замість одного дивного рядка. Тому пошук дає `undefined`, а не обіцянку.
 */
const STATES: Record<string, StateLook> = {
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
}

/**
 * Невідомий стан НЕ ховається під жодним зі знайомих: він друкується як є, щоб той, хто
 * побачив цей рядок, міг сказати вголос, що саме лежить у документі.
 */
const UNKNOWN: StateLook = {
  label: 'стан невідомий',
  icon: CircleHelp,
  className: 'border-destructive/40 text-destructive',
}

export function TransferStateBadge({
  status,
  className,
}: {
  status: Transfer['status']
  className?: string
}) {
  // Анотація `| undefined` тут обовʼязкова: без неї TypeScript вважає індексацію
  // `Record<string, …>` завжди вдалою, і `??` став би мертвим кодом, який нічого не ловить.
  const known: StateLook | undefined = STATES[status]
  const state = known ?? UNKNOWN
  const Icon = state.icon
  return (
    <Badge variant="outline" className={cn(state.className, className)}>
      <Icon />
      {known ? state.label : `${state.label}: ${String(status)}`}
    </Badge>
  )
}
