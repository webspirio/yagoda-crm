import { Delete } from 'lucide-react'
import { cn } from '@/lib/utils'

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'del'] as const

export function NumPad({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
}) {
  function press(k: string) {
    if (k === 'del') return onChange(value.slice(0, -1))
    if (k === '.' && (value.includes('.') || value === '')) return
    if (value === '0' && k !== '.') return onChange(k)
    if (value.includes('.') && value.split('.')[1].length >= 2) return
    onChange(value + k)
  }

  return (
    <div className={cn('grid grid-cols-3 gap-1.5', className)}>
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className={cn(
            'flex h-11 items-center justify-center rounded-lg bg-secondary font-mono text-lg font-medium text-secondary-foreground transition-colors',
            'hover:bg-accent active:translate-y-px',
            k === 'del' && 'text-muted-foreground',
          )}
        >
          {k === 'del' ? <Delete className="size-4" /> : k}
        </button>
      ))}
    </div>
  )
}
