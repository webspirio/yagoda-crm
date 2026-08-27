#!/usr/bin/env node
/**
 * МЕЖА КОНТРАКТУ: екрани не читають фікстуру демо-даних.
 *
 * `src/lib/ports.ts` починається обіцянкою, що сторінки викликають лише `Commands` і
 * читають лише `DomainSnapshot`/`Queries`, «і жодна з них не знає, чи дані приїхали з
 * localStorage чи по HTTP». Ту саму обіцянку ми дали клієнту письмово — `docs/22-tz.md
 * §17.1`: «екрани не доведеться переписувати — міняється те, що під ними».
 *
 * Зміряно 27.08.2026: обіцянка була НЕПРАВДОЮ у 24 з 33 файлів UI. Вони імпортували з
 * `src/lib/seed.ts` те, що постачає сервер — бізнес-дату (`TODAY`, 88 згадувань), реєстр
 * підписів (`OPERATORS`, `OWNER`), довідник товарів (`PRODUCTS`), день відкриття касової
 * книги (`CASH_BOOK_FROM`), id ящика (`DEFAULT_TARE_ID`). Ті факти переїхали у знімок
 * (`config`, `products`, `users`), і 24 файли виправлені.
 *
 * ЧОМУ ЦЕЙ ФАЙЛ ІСНУЄ. Після виправлення межу не тримало НІЩО. Наступний екран, який
 * напише `import { TODAY } from '@/lib/seed'`, повертає дефект назад, і дерево лишається
 * зеленим: звичайний імпорт сусіднього модуля не порушує жодного правила, а `knip` бачить
 * лише невикористані експорти, не заборонені. Це рівно той клас поломки, проти якого
 * будували цей шар — `CLAUDE.md`, правило 1: «це зобовʼязання, а не механізм».
 *
 * ЧОМУ НЕ ЧЕРЕЗ OXLINT. Першою спробою було правило `no-restricted-imports` у
 * `.oxlintrc.json`. Воно приймається схемою, `oxlint --print-config` показує його як
 * `deny` — і НЕ ВИКОНУЄТЬСЯ: у oxlint 1.75.0 цього правила немає в реєстрі. Перевірено
 * емпірично: з дописаним `import { TODAY } from '@/lib/seed'` у `DebtsPage.tsx`
 * `npm run lint` виходив із нулем, і з увімкненим плагіном `import` теж. Тобто конфіг
 * виглядав би як механізм і не доводив нічого — гірше за відсутність правила, бо
 * наступний читач йому повірить. Тому механізм тут, де його видно й де він падає.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

/**
 * Кому МОЖНА. Перелічено поштучно, а не глобом по `src/lib/**` — саме тому, що глоб
 * дозволив би наступному модулю в `src/lib` тихо стати другим портом.
 *
 * `store.ts` — це in-memory адаптер контракту: він і є те місце, яке знає, звідки беруться
 * дані, і саме він міняється, коли з'явиться сервер. Тести — бо вони й звіряють переїзд
 * (`seed.test.ts` пінує, що `signerFor()` відтворює старий мапінг ключ у ключ).
 */
const ALLOWED = new Set(['src/lib/store.ts', 'src/lib/seed.ts', 'src/lib/seed-suppliers.ts'])

const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/
const IS_CODE = /\.[cm]?[jt]sx?$/

/** Будь-яка форма посилання на модуль сіду: аліас, відносний шлях, `import type`, `import()`. */
const SEED_IMPORT = /(?:from|import)\s*\(?\s*['"]([^'"]*\/)?seed(?:\.[jt]sx?)?['"]/

/** @param {string[]} args @returns {string} */
const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8')

/**
 * Відслідковувані І щойно написані файли: перевірка, яка бачить лише закомічене, пропустила
 * б саме той імпорт, який дописують просто зараз.
 * @returns {string[]}
 */
function sources() {
  const raw = git(['ls-files', '-c', '-o', '--exclude-standard', '-z'])
  return raw
    .split('\u0000')
    .filter((f) => f && f.startsWith('src/') && IS_CODE.test(f) && !IS_TEST.test(f))
    .sort()
}

/*
 * Читаємо З ДИСКА, а не з індексу (`git show :file`). Перша версія читала індекс — і на
 * робочому дереві, де 24 файли вже виправлені, але ще не додані в індекс, вона показала
 * усі 24 як порушників. Тобто перевірка судила б про код, якого вже немає, і навпаки:
 * виправлення, ще не додане в індекс, лишалося б «червоним», а порушення, ще не додане в
 * індекс, — невидимим. Збирається й запускається саме те, що лежить на диску.
 */
const offenders = []
for (const file of sources()) {
  if (ALLOWED.has(file)) continue
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (SEED_IMPORT.test(lines[i])) offenders.push({ file, line: i + 1, text: lines[i].trim() })
  }
}

const listed = [...ALLOWED].sort()

if (offenders.length) {
  console.error('seed-port: ЧЕРВОНО')
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line} імпортує фікстуру демо-даних`)
    console.error(`    ${o.text}`)
  }
  console.error('')
  console.error('  `seed.ts` — демо-фікстура, а не джерело даних застосунку. Те, що там')
  console.error('  лежить, постачає сервер, і читати це треба зі знімка:')
  console.error('    TODAY            → config.businessToday')
  console.error('    SEASON_START     → config.seasonStart')
  console.error('    CASH_BOOK_FROM   → config.cashBookFrom')
  console.error('    DEFAULT_TARE_ID  → config.crateTareId')
  console.error('    PRODUCTS         → products')
  console.error('    OPERATORS[x]     → signerFor(users, x)   (запасний підпис лишається за місцем виклику)')
  console.error('    OWNER            → ownerName(users)')
  console.error(`  Дозволені імпортери (поштучно): ${listed.join(', ')}`)
  process.exit(1)
}

console.log(
  `seed-port: межа тримається — ${sources().length} файлів src/ перевірено, ` +
    `жоден не імпортує фікстуру; дозволені поштучно: ${listed.join(', ')}`,
)
