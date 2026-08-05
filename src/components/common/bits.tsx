import * as React from 'react'
import { cn } from '@/lib/utils'

export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
      <div className="min-w-0">
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h1 className="font-display text-2xl leading-tight font-medium">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = 'default',
  icon,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'berry' | 'amber' | 'leaf'
  icon?: React.ReactNode
  className?: string
}) {
  const toneClass = {
    default: 'text-foreground',
    berry: 'text-primary',
    amber: 'text-[var(--amber)]',
    leaf: 'text-[var(--leaf)]',
  }[tone]

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-between rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Eyebrow className="truncate">{label}</Eyebrow>
        {icon ? <span className="shrink-0 text-muted-foreground">{icon}</span> : null}
      </div>
      <div className={cn('mt-2 font-mono text-[26px] leading-none font-semibold tracking-tight', toneClass)}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

/** Small horizontal proportion bar with a 2px gap between fills. */
export function ShareBar({
  parts,
  className,
}: {
  parts: { value: number; color: string; label: string }[]
  className?: string
}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1
  return (
    <div className={cn('flex h-2 w-full gap-[2px] overflow-hidden', className)}>
      {parts.map((p, i) => (
        <div
          key={i}
          title={p.label}
          className="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: React.ReactNode
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <div className="font-medium">{title}</div>
      {hint ? <div className="max-w-sm text-sm text-muted-foreground">{hint}</div> : null}
      {action}
    </div>
  )
}

export function Dot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
      style={{ background: color }}
    />
  )
}

export const CHART_COLORS = ['#c81e4e', '#2e7bc4', '#c57a00', '#2e8b3e', '#7c4dc0'] as const
