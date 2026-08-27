import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/common/bits'
import { CrateStandingBar } from '@/components/crates/CrateStandingBar'
import { addDays, uahAuto } from '@/lib/format'
import { useCashStanding, useCrateStanding, useStore } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { ISODate, PointId, Uah } from '@/lib/types'

/**
 * «Стан точки» — те, що приймальник мусить бачити, не йдучи з прийомки: скільки грошей
 * і скільки ящиків у нього просто зараз. Він працює на одному екрані весь день, і поки
 * цих чисел тут не було, дізнатися їх можна було лише пішовши на «Касу точки» й «Ящики» —
 * тобто покинувши форму з наполовину набраним візитом.
 *
 * ЖОДНОГО ПІДРАХУНКУ ТУТ НЕМАЄ, і це головна властивість файлу. Усі сім чисел приходять
 * готовими: чотири касові — з `cashStanding()` через `useCashStanding()`, три ящикові — з
 * `crateStanding()` через `useCrateStanding()`, а «видано» й «залишків створено» — з
 * `reconcileDay()`, який сторінка вже порахувала для себе і передає пропами. Другий
 * примірник арифметики розійшовся б із першим МОВЧКИ: `ratchet:money` міряє вираз у місці
 * виклику форматера, а різниця між двома згортками там не видна взагалі.
 *
 * ЧОТИРИ КАСОВІ ЧИСЛА — НЕ ЛАНЦЮЖОК, і саме тому вони стоять сіткою, а не стовпчиком з
 * підсумком. «На ранок − видано = зараз» тут не сходиться й не мусить: у шухляді ще
 * рухаються перекази від керівника і завдатки за ящики, а «залишків створено» — це взагалі
 * не гроші, а борг перед постачальником. Повний розклад, де все сходиться, живе на «Касі
 * точки» (`CashLedger`); тут — чотири показники дня.
 *
 * ДВІ РОЗБІЖНОСТІ, ЯКІ НАЗВАНІ В ПІДПИСАХ, А НЕ ЗАМОВЧАНІ:
 *
 * 1. **«У шухляді», а не «в касі».** На «Касі точки» рядок «на початок дня» — це
 *    `berryCash`, тобто ЛИШЕ ягідна книга. Тут вісь інша: уся шухляда
 *    (`expectedCash = berryCash + crateCash`), бо приймальник перераховує одну купу
 *    готівки, а не дві. Два екрани не мають права називати різні числа одними словами,
 *    тому тут стоїть «у шухляді на ранок» і «у шухляді зараз», а розклад на дві книги —
 *    рядком під ними: саме `berryCash` обмежує виплату за ягоду (`G12`, `I58`), і сховати
 *    його було б небезпечно.
 * 2. **«Видано ЗА ЯГОДУ», а не «видано з каси».** `reconcileDay().cashOut` — це виплати за
 *    ягоду й нічого більше. Повернений завдаток за ящики теж виходить із тієї самої
 *    шухляди, але в це число не входить (`21 §3.5`), тому підпис «видано з каси»
 *    стверджував би більше, ніж число знає.
 *
 * «На ранок» читається тим самим рушієм на `date − 1` — так само, як `PointCashPage`
 * бере свій `before`. Порахувати його тут як «наділ мінус щось» означало б завести другий
 * спосіб отримати касу, а два способи — це два числа.
 */
export function PointStatePanel({
  pointId,
  date,
  cashOut,
  newDebt,
}: {
  pointId: PointId
  /** робочий день прийомки — `config.businessToday`, той самий, яким живе вся сторінка */
  date: ISODate
  /** `reconcileDay().cashOut` — виплачено за ягоду сьогодні */
  cashOut: Uah
  /** `reconcileDay().newDebt` — скільки залишків створено сьогодні */
  newDebt: Uah
}) {
  const go = useStore((s) => s.go)
  const cash = useCashStanding(pointId, date)
  const before = useCashStanding(pointId, addDays(date, -1))
  const crates = useCrateStanding(pointId, date)

  // Наділу каси на цю дату немає — отже книги немає, і сума шухляди тут не «нуль», а
  // НЕВІДОМА. Без цієї гілки згортка почала б від нуля й намалювала мінус на сто тисяч —
  // рівно те, від чого закривається «Каса точки». Показуємо «—», як `CrateStandingBar`
  // показує невідомий наділ ящиків.
  const hasBook = cash.float !== null

  return (
    <div className="rounded-xl bg-card ring-1 ring-foreground/10">
      <section className="border-b border-border/70 p-4">
        <SectionHead title="Каса точки" onOpen={() => go({ name: 'pointcash' })} />

        {/*
          ПОРЯДОК КАХЛІВ — ПО СТОВПЧИКАХ, А НЕ ПО РЯДКАХ, і це не косметика. Ліворуч одна
          величина у два моменти часу: скільки було в шухляді на ранок і скільки в ній
          зараз. Їх порівнюють, і порівнюються вони вертикально, одне під одним. Праворуч —
          дві різні величини самого дня: скільки грошей пішло і скільки боргу з'явилося.
          Поки «зараз» стояло по діагоналі від «на ранок», головне порівняння екрана
          доводилося робити навскіс.
        */}
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Money label="У шухляді на ранок" value={hasBook ? uahAuto(before.expectedCash) : '—'} />
          <Money label="Видано за ягоду" value={uahAuto(cashOut)} />
          <Money
            label="У шухляді зараз"
            value={hasBook ? uahAuto(cash.expectedCash) : '—'}
            tone={hasBook && cash.expectedCash < 0 ? 'bad' : undefined}
          />
          <Money
            label="Залишків створено"
            value={uahAuto(newDebt)}
            tone={newDebt > 0.009 ? 'amber' : undefined}
          />
        </div>

        <p className="mt-3 border-t border-border/60 pt-2.5 text-xs leading-relaxed text-muted-foreground">
          {hasBook ? (
            <>
              за ягоду{' '}
              <b
                className={cn(
                  'font-mono font-semibold',
                  cash.berryCash < 0 ? 'text-destructive' : 'text-foreground',
                )}
              >
                {uahAuto(cash.berryCash)}
              </b>{' '}
              · завдатків за ящики{' '}
              <b className="font-mono font-semibold text-foreground">{uahAuto(cash.crateCash)}</b>
            </>
          ) : (
            'Наділу каси цій точці не призначали — рахувати шухляду тут нема від чого.'
          )}
        </p>
      </section>

      <section className="p-4">
        <SectionHead title="Ящики" onOpen={() => go({ name: 'crates' })} />
        <div className="mt-3">
          <CrateStandingBar standing={crates} compact />
        </div>
      </section>
    </div>
  )
}

/**
 * Підпис розділу зі стрілкою туди, де цим станом КЕРУЮТЬ. Приймальник дивиться в одному
 * місці, а діє там, де діють: видати ящики можна лише на «Ящиках», перерахувати касу —
 * лише на «Касі точки». Обидва розділи відкриті приймальникові, тож перевірки ролі тут
 * немає — вона живе в `Shell`, який і вирішує, що показувати в навігації.
 */
function SectionHead({ title, onOpen }: { title: string; onOpen: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Eyebrow>{title}</Eyebrow>
      <Button variant="ghost" size="sm" className="-mr-2 h-7 px-2 text-xs" onClick={onOpen}>
        Відкрити
        <ChevronRight className="size-3.5" />
      </Button>
    </div>
  )
}

/** Одна клітинка сітки. Форматер друкує вже готове число — рахувати тут нічого. */
function Money({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'amber' | 'bad'
}) {
  return (
    <div className="min-w-0">
      <Eyebrow className="truncate">{label}</Eyebrow>
      <div
        className={cn(
          'mt-1 font-mono text-xl leading-none font-semibold tracking-tight',
          tone === 'amber' && 'text-[var(--amber)]',
          tone === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </div>
    </div>
  )
}
