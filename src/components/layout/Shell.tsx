import * as React from 'react'
import {
  BarChart3,
  CalendarCheck2,
  CircleDollarSign,
  CloudOff,
  Cloud,
  History,
  MapPin,
  Menu,
  Package,
  RefreshCw,
  RotateCcw,
  Scale,
  Users,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { longDate, weekday } from '@/lib/format'
import { pendingCount, useStore, type Route, type RouteName } from '@/lib/store'
import { OPERATORS, TODAY } from '@/lib/seed'
import { toast } from 'sonner'

interface NavItem {
  name: RouteName
  label: string
  icon: React.ComponentType<{ className?: string }>
  roles: ('operator' | 'owner')[]
}

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Робота на точці',
    items: [
      { name: 'reception', label: 'Прийомка', icon: Scale, roles: ['operator', 'owner'] },
      { name: 'day', label: 'Каса за день', icon: CalendarCheck2, roles: ['operator', 'owner'] },
      { name: 'prices', label: 'Ціни дня', icon: CircleDollarSign, roles: ['operator', 'owner'] },
    ],
  },
  {
    group: 'Люди та гроші',
    items: [
      { name: 'suppliers', label: 'Постачальники', icon: Users, roles: ['operator', 'owner'] },
      { name: 'debts', label: 'Залишки', icon: Wallet, roles: ['operator', 'owner'] },
      { name: 'journal', label: 'Журнал', icon: History, roles: ['owner'] },
    ],
  },
  {
    group: 'Керівництву',
    items: [
      { name: 'dashboard', label: 'Зведення', icon: BarChart3, roles: ['owner'] },
      { name: 'points', label: 'Точки', icon: MapPin, roles: ['owner'] },
      { name: 'refs', label: 'Тара і сорти', icon: Package, roles: ['owner'] },
    ],
  },
]

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const role = useStore((s) => s.role)
  const route = useStore((s) => s.route)
  const go = useStore((s) => s.go)

  return (
    <nav className="flex flex-col gap-5">
      {NAV.map((group) => {
        const items = group.items.filter((i) => i.roles.includes(role))
        if (!items.length) return null
        return (
          <div key={group.group}>
            <div className="px-3 pb-1.5 text-[10px] font-medium tracking-[0.18em] text-sidebar-foreground/40 uppercase">
              {group.group}
            </div>
            <div className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = item.icon
                const active =
                  route.name === item.name ||
                  (item.name === 'suppliers' && route.name === 'supplier')
                return (
                  <button
                    key={item.name}
                    onClick={() => {
                      go({ name: item.name } as Route)
                      onNavigate?.()
                    }}
                    className={cn(
                      'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'h-4 w-[2px] rounded-full transition-colors',
                        active ? 'bg-primary' : 'bg-transparent',
                      )}
                    />
                    <Icon className="size-4 opacity-80" />
                    <span className="truncate">{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </nav>
  )
}

function DemoPanel() {
  const role = useStore((s) => s.role)
  const setRole = useStore((s) => s.setRole)
  const resetDemo = useStore((s) => s.resetDemo)

  return (
    <div className="rounded-xl bg-sidebar-accent/70 p-3">
      <div className="mb-2 text-[10px] font-medium tracking-[0.18em] text-sidebar-foreground/45 uppercase">
        Демо-режим
      </div>
      <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-black/30 p-1">
        {(
          [
            ['operator', 'Приймальник'],
            ['owner', 'Власник'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setRole(value)}
            className={cn(
              'rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              role === value
                ? 'bg-primary text-primary-foreground'
                : 'text-sidebar-foreground/70 hover:text-sidebar-accent-foreground',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-sidebar-foreground/50">
        {role === 'operator'
          ? 'Приймальник бачить лише свою точку і не має доступу до зведення.'
          : 'Власник бачить усі точки, ціни, залишки та аналітику.'}
      </p>
      {/* Збережений стан у браузері перебиває свіжий сід — це найкоротший шлях зіпсувати показ,
          тому кнопка стоїть на видноті й підписана, що саме вона робить */}
      <Button
        size="sm"
        className="w-full justify-start border border-sidebar-foreground/20 bg-black/25 text-sidebar-accent-foreground hover:bg-black/40"
        onClick={() => {
          resetDemo()
          toast.success('Демо-дані відновлено', {
            description: 'Сезон повернувся до початкового стану — пробні квитанції прибрано.',
          })
        }}
      >
        <RotateCcw className="size-3.5" />
        Скинути демо-дані
      </Button>
      <p className="mt-2 text-[11px] leading-snug text-sidebar-foreground/50">
        Демо живе у вашому браузері. Натисніть перед показом — і сезон буде такий, як задумано.
      </p>
    </div>
  )
}

function SidebarInner({ onNavigate }: { onNavigate?: () => void }) {
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const role = useStore((s) => s.role)
  const point = points.find((p) => p.id === activePointId)

  return (
    <div className="flex h-full flex-col gap-6 bg-sidebar p-4 text-sidebar-foreground">
      <div className="px-2 pt-1">
        <div className="flex items-center gap-2">
          <BerryMark />
          <div className="font-display text-[17px] leading-none font-semibold text-sidebar-accent-foreground">
            Ягода
          </div>
        </div>
        <div className="mt-1.5 pl-8 text-[11px] tracking-wide text-sidebar-foreground/45">
          {role === 'owner' && activePointId === 'all'
            ? 'усі точки · сезон 2026'
            : `${point?.name ?? ''} · ${point?.village ?? ''}`}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <NavList onNavigate={onNavigate} />
      </div>

      {role === 'operator' ? (
        <div className="px-3">
          <div className="text-[10px] font-medium tracking-[0.18em] text-sidebar-foreground/40 uppercase">
            Зміна
          </div>
          <div className="mt-1 text-sm text-sidebar-accent-foreground">
            {OPERATORS[activePointId] ?? '—'}
          </div>
          <div className="text-[11px] text-sidebar-foreground/45">на точці з 07:00</div>
        </div>
      ) : null}

      <DemoPanel />
    </div>
  )
}

function BerryMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="14.5" r="4.2" fill="var(--primary)" />
      <circle cx="15.4" cy="14.5" r="4.2" fill="var(--primary)" opacity="0.72" />
      <circle cx="12.2" cy="9.4" r="4.2" fill="var(--primary)" opacity="0.86" />
      <path
        d="M12.2 5.6c0-1.7 1.4-3.1 3.1-3.1"
        stroke="var(--readout)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

function SyncPill() {
  const online = useStore((s) => s.online)
  const setOnline = useStore((s) => s.setOnline)
  const syncAll = useStore((s) => s.syncAll)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const pending = pendingCount(receptions, payouts)
  const [syncing, setSyncing] = React.useState(false)

  function toggle() {
    if (online) {
      setOnline(false)
      toast('Звʼязок вимкнено', {
        description: 'Прийомка працює далі — записи стануть у чергу на відправку.',
      })
      return
    }
    setOnline(true)
    if (pending > 0) {
      setSyncing(true)
      window.setTimeout(() => {
        syncAll()
        setSyncing(false)
        toast.success(`Синхронізовано ${pending} ${pending === 1 ? 'запис' : 'записи'}`)
      }, 1400)
    } else {
      toast.success('Звʼязок відновлено')
    }
  }

  const state = syncing ? 'syncing' : online ? 'online' : 'offline'

  return (
    <button
      onClick={toggle}
      title="Демо: увімкнути / вимкнути звʼязок"
      className={cn(
        'relative flex h-8 items-center gap-2 overflow-hidden rounded-lg border px-2.5 text-xs font-medium transition-colors',
        state === 'online' && 'border-transparent bg-[var(--leaf)]/10 text-[var(--leaf)]',
        state === 'offline' && 'border-transparent bg-[var(--amber)]/12 text-[var(--amber)]',
        state === 'syncing' && 'border-transparent bg-[var(--sky)]/12 text-[var(--sky)]',
      )}
    >
      {state === 'syncing' ? (
        <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 animate-sweep bg-[var(--sky)]/15" />
      ) : null}
      {state === 'offline' ? <CloudOff className="size-3.5" /> : null}
      {state === 'online' ? <Cloud className="size-3.5" /> : null}
      {state === 'syncing' ? <RefreshCw className="size-3.5 animate-spin" /> : null}
      <span className="relative">
        {state === 'offline'
          ? pending > 0
            ? `Офлайн · ${pending} у черзі`
            : 'Офлайн'
          : state === 'syncing'
            ? 'Синхронізація…'
            : 'Дані збережено'}
      </span>
    </button>
  )
}

function PointSelect() {
  const points = useStore((s) => s.points)
  const activePointId = useStore((s) => s.activePointId)
  const setActivePoint = useStore((s) => s.setActivePoint)
  const role = useStore((s) => s.role)

  // a point operator has exactly one point — nothing to choose between
  if (role === 'operator') {
    const point = points.find((p) => p.id === activePointId)
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-lg bg-card px-2.5 text-xs ring-1 ring-foreground/10">
        <MapPin className="size-3.5 text-muted-foreground" />
        <span className="font-medium">{point?.name}</span>
        <span className="hidden text-muted-foreground sm:inline">{point?.village}</span>
      </div>
    )
  }

  // Вибрати можна лише точку, яка приймає. Решта п'ять стоять у довіднику готові до
  // відкриття ✓ PART A («від 5 до 10») — але в них немає ні прийомок, ні каси, і
  // пропонувати їх як робочі означало б показати порожній екран замість точки
  const registry = points.filter((p) => !p.active)

  return (
    <Select value={activePointId} onValueChange={setActivePoint}>
      <SelectTrigger className="h-8 w-[186px] bg-card text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">Усі точки</SelectItem>
        {points
          .filter((p) => p.active)
          .map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
              <span className="ml-1.5 text-muted-foreground">{p.village}</span>
            </SelectItem>
          ))}
        {registry.length ? (
          <div className="border-t border-border/70 px-2 pt-1.5 pb-1 text-[11px] leading-snug text-muted-foreground">
            У реєстрі, ще не відкриті: {registry.map((p) => p.name).join(', ')}
          </div>
        ) : null}
      </SelectContent>
    </Select>
  )
}

export function Shell({ children }: { children: React.ReactNode }) {
  const role = useStore((s) => s.role)
  const activePointId = useStore((s) => s.activePointId)
  const points = useStore((s) => s.points)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const point = points.find((p) => p.id === activePointId)

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="sticky top-0 hidden h-svh w-[248px] shrink-0 lg:block">
        <SidebarInner />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-md lg:px-7">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[268px] border-0 bg-sidebar p-0">
              <SheetTitle className="sr-only">Навігація</SheetTitle>
              <SidebarInner onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <PointSelect />

          <div className="hidden items-baseline gap-2 md:flex">
            <span className="text-sm font-medium">{longDate(TODAY)}</span>
            <span className="text-xs text-muted-foreground">{weekday(TODAY)}</span>
          </div>

          <div className="ml-auto flex items-center gap-2.5">
            <SyncPill />
            <div className="hidden items-center gap-2 border-l border-border/70 pl-2.5 sm:flex">
              <div className="text-right leading-tight">
                <div className="text-xs font-medium">
                  {role === 'owner' ? 'Власник' : 'Приймальник'}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {role === 'owner' ? 'повний доступ' : (point?.name ?? '')}
                </div>
              </div>
              <Badge
                variant="secondary"
                className="size-7 rounded-full p-0 font-mono text-[11px] font-semibold"
              >
                {role === 'owner' ? 'ВЛ' : 'ПР'}
              </Badge>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 lg:px-7 lg:py-7">{children}</main>
      </div>
    </div>
  )
}
