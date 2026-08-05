import * as React from 'react'
import { Check, ChevronsUpDown, Plus, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/lib/store'
import { openDebts, sum } from '@/lib/calc'
import { uah } from '@/lib/format'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { Supplier } from '@/lib/types'

export function SupplierPicker({
  value,
  onChange,
  pointId,
}: {
  value?: string
  onChange: (id: string) => void
  pointId: string
}) {
  const suppliers = useStore((s) => s.suppliers)
  const receptions = useStore((s) => s.receptions)
  const payouts = useStore((s) => s.payouts)
  const [open, setOpen] = React.useState(false)
  const [addOpen, setAddOpen] = React.useState(false)

  // та сама книга, що й у «Попередній залишок» нижче: борг цього пункту, зі зведеними
  // переплатами. Інакше в списку світилося б 164 088 ₴, а смужка під ним — 0 ₴
  const balances = React.useMemo(() => {
    const own = receptions.filter((r) => r.pointId === pointId)
    const map = new Map<string, number>()
    for (const s of suppliers) {
      map.set(s.id, sum(openDebts(s.id, own, payouts), (o) => o.open))
    }
    return map
  }, [suppliers, receptions, payouts, pointId])

  const selected = suppliers.find((s) => s.id === value)
  const home = suppliers.filter((s) => s.homePointId === pointId)
  const others = suppliers.filter((s) => s.homePointId !== pointId)

  function renderItem(s: Supplier) {
    const balance = balances.get(s.id) ?? 0
    return (
      <CommandItem
        key={s.id}
        value={`${s.name} ${s.village} ${s.phone ?? ''}`}
        onSelect={() => {
          onChange(s.id)
          setOpen(false)
        }}
        className="gap-2"
      >
        <Check className={cn('size-4', value === s.id ? 'opacity-100' : 'opacity-0')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate">{s.name}</span>
            {s.wholesale ? (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                ОПТ
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{s.village}</div>
        </div>
        {balance > 0.009 ? (
          <span className="shrink-0 font-mono text-xs text-[var(--amber)]">{uah(balance)}</span>
        ) : null}
      </CommandItem>
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-12 w-full justify-between px-3 text-base font-normal"
          >
            {selected ? (
              <span className="flex min-w-0 items-center gap-2">
                <UserRound className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{selected.name}</span>
                <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                  {selected.village}
                </span>
                {selected.wholesale ? (
                  <Badge variant="secondary" className="shrink-0 text-[10px]">
                    ОПТ
                  </Badge>
                ) : null}
              </span>
            ) : (
              <span className="flex items-center gap-2 text-muted-foreground">
                <UserRound className="size-4" />
                Обрати постачальника
              </span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command
            filter={(v, search) => (v.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}
          >
            {/* телефон у пошуку не згадуємо: у Довіднику він порожній у 209 з 209 записів */}
            <CommandInput placeholder="Прізвище або село…" />
            <CommandList className="max-h-[320px]">
              <CommandEmpty>
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  Нікого не знайшли.
                </div>
              </CommandEmpty>
              <CommandGroup heading="Наша точка">{home.map(renderItem)}</CommandGroup>
              {others.length ? (
                <CommandGroup heading="Інші точки">{others.map(renderItem)}</CommandGroup>
              ) : null}
            </CommandList>
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                className="h-9 w-full justify-start"
                onClick={() => {
                  setOpen(false)
                  setAddOpen(true)
                }}
              >
                <Plus className="size-4" />
                Додати нового постачальника
              </Button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <AddSupplierDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        pointId={pointId}
        onCreated={(s) => onChange(s.id)}
      />
    </>
  )
}

export function AddSupplierDialog({
  open,
  onOpenChange,
  pointId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  pointId: string
  onCreated?: (s: Supplier) => void
}) {
  const addSupplier = useStore((s) => s.addSupplier)
  const [name, setName] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [village, setVillage] = React.useState('')
  const [wholesale, setWholesale] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setVillage('')
      setWholesale(false)
    }
  }, [open])

  function submit() {
    if (name.trim().length < 3) {
      toast.error('Впишіть прізвище та імʼя')
      return
    }
    const created = addSupplier({
      name: name.trim(),
      // порожній телефон лишається порожнім, а не перетворюється на ''
      phone: phone.trim() || undefined,
      village: village.trim() || '—',
      homePointId: pointId,
      wholesale,
    })
    onCreated?.(created)
    onOpenChange(false)
    toast.success(`${created.name} у списку постачальників`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Новий постачальник</DialogTitle>
          <DialogDescription>
            Картка заводиться один раз — далі людина шукається за прізвищем.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-name">Прізвище та імʼя</Label>
            <Input
              id="sp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ковальчук Марія"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="sp-phone">Телефон</Label>
              <Input
                id="sp-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+380…"
                inputMode="tel"
              />
              <span className="text-xs text-muted-foreground">
                У вашій таблиці телефон порожній у 209 з 209 записів
              </span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sp-village">Село</Label>
              <Input
                id="sp-village"
                value={village}
                onChange={(e) => setVillage(e.target.value)}
                placeholder="с. Заріччя"
              />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/60 px-3 py-2.5">
            <div>
              <div className="text-sm font-medium">Оптовик</div>
              {/* Дод. ціна тепер на рядку прийомки, а не на картці людини (M7) */}
              <div className="text-xs text-muted-foreground">Позначка для звірки з ОПТ-сортами</div>
            </div>
            <Switch checked={wholesale} onCheckedChange={setWholesale} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Скасувати
          </Button>
          <Button onClick={submit}>Зберегти</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
