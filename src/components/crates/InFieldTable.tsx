import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Eyebrow } from '@/components/common/bits'
import { sum } from '@/lib/calc'
import { num, uahAuto } from '@/lib/format'
import { crateWord, modeLabel, personWord } from './helpers'
import type { InFieldRow } from './helpers'

/**
 * «У ЛЮДЕЙ» (`21 §Н14`). Рядок РАЗОМ із розділенням «із них N за кошти» — це те, чого в
 * журналі клієнтки немає взагалі (`H2`): підсумку по людині там не існує, дві людини
 * стоять у двох рядках кожна, і ніхто цього не бачить. Її аркуш через це стверджує
 * 33 000 ₴ там, де ми справді тримаємо 13 800 ₴.
 *
 * Три різні числа з одних і тих самих 15 рядків, і саме тому вони стоять поруч:
 *   195 ящиків у людей · із них 115 за кошти · 13 800,00 ₴ завдатків у нас.
 * Решта 80 узяті за розписку — грошового покриття за ними немає взагалі (`I66`), і в
 * колонці «завдаток» там «—», а не «0,00»: нуля ми не брали, ми не брали нічого.
 */
export function InFieldTable({ rows, inField }: { rows: InFieldRow[]; inField: number }) {
  const units = rows.reduce((n, r) => n + r.balance.units, 0)
  const deposit = rows.reduce((n, r) => n + r.balance.deposit, 0)
  // Гроші складає рушій (`sum` округлює до копійки), а не reduce у компоненті.
  const held = sum(rows, (r) => r.balance.depositHeld)

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-5 py-3.5">
        <Eyebrow>У людей</Eyebrow>
        <span className="font-mono text-xs text-muted-foreground">
          {num(units)} ящ. · {num(rows.length)} {personWord(rows.length)}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Зараз у людей ящиків немає — усе, що видали, повернулося.
        </p>
      ) : (
        <div className="px-2 pb-2">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Людина</TableHead>
                <TableHead className="text-right">Ящиків</TableHead>
                <TableHead>Як брала</TableHead>
                <TableHead className="text-right">Завдаток</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.supplier.id}>
                  <TableCell>
                    <div className="font-medium">{r.supplier.name}</div>
                    <div className="text-xs text-muted-foreground">{r.supplier.village}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{num(r.balance.units)}</TableCell>
                  <TableCell className="text-muted-foreground">{modeLabel(r.balance)}</TableCell>
                  <TableCell className="text-right font-mono">
                    {r.balance.depositHeld > 0 ? uahAuto(r.balance.depositHeld) : '—'}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/15 hover:bg-transparent">
                <TableCell className="font-medium">РАЗОМ</TableCell>
                <TableCell className="text-right font-mono font-semibold">{num(units)}</TableCell>
                <TableCell className="text-muted-foreground">
                  із них {num(deposit)} за кошти
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {held > 0 ? uahAuto(held) : '—'}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {/*
        Два різні підрахунки одного й того самого: сума по ЛЮДЯХ (кожна зі своїм балансом)
        і «у людей» зі складу наділу ТОЧКИ. Вони розходяться рівно в одному випадку —
        людина повернула ящики не там, де брала. Мовчати про це не можна: тоді екран
        показував би два числа й удавав, що вони одне.
      */}
      {units !== inField ? (
        <p className="border-t border-border/70 px-5 py-3 text-sm text-destructive">
          Сума по людях — {num(units)} {crateWord(units)}, а у складі наділу цієї точки
          стоїть {num(inField)}. Різниця означає, що ящики повернули не на тій точці, де їх
          брали.
        </p>
      ) : null}
    </div>
  )
}
