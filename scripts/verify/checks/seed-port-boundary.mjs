#!/usr/bin/env node
/**
 * МЕЖА КОНТРАКТУ: екрани не читають ані фікстуру демо-даних, ані мок-«сервер».
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
 * ЧОМУ ПОРТІВ СТАЛО ДВА (фаза 4, 28.08.2026). `src/lib/auth-mock.ts` стоїть НА МІСЦІ
 * СЕРВЕРА: він тримає власний реєстр пар «логін → секрет» і зникає в той день, коли
 * зʼявиться справжня перевірка на спільному сервері (`22-tz §17.2`, `23 §Р4-1`). Різниця
 * з портом сіду не в жанрі, а в ціні помилки: секрет, витягнутий у `.tsx`, приїжджає в
 * бандл ПОРУЧ із кодом, який його звіряє, і будь-який `import { … } from '@/lib/auth-mock'`
 * зі сторінки — це вже не «екран знає зайве», а секрет на екрані. Той самий клас поломки
 * лишався б зеленим із тієї самої причини: імпорт сусіднього модуля не порушує жодного
 * правила. Тому механізм один на два модулі, а не обіцянка в коментарі: `store.ts`
 * лишається ЄДИНИМ, кому можна, і саме він міняється, коли сервер зʼявиться.
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
 * Будь-яка форма посилання на модуль: аліас, відносний шлях, `import type`, `import()`.
 *
 * @param {string} name базове імʼя модуля без розширення
 * @returns {RegExp}
 */
const importOf = (name) =>
  new RegExp(`(?:from|import)\\s*\\(?\\s*['"]([^'"]*\\/)?${name}(?:\\.[jt]sx?)?['"]`)

/**
 * ОХОРОНЮВАНІ ПОРТИ. Кому можна — перелічено ПОШТУЧНО, а не глобом по `src/lib/**`: глоб
 * дозволив би наступному модулю в `src/lib` тихо стати третім портом без жодного рядка тут.
 *
 * `store.ts` — це in-memory адаптер контракту: він і є те місце, яке знає, звідки беруться
 * дані, і саме він міняється, коли з'явиться сервер. Тому він єдиний, хто стоїть в обох
 * дозвільних списках.
 *
 * Тестові файли не перевіряються взагалі (`IS_TEST` нижче): `seed.test.ts` пінує, що
 * `signerFor()` відтворює старий мапінг ключ у ключ, а `auth-mock.test.ts` — що мок-сервер
 * розрізняє три причини відмови. Заборонити їм імпорт означало б заборонити ту єдину
 * перевірку, яка ці модулі й тримає.
 *
 * @type {{ name: string, what: string, re: RegExp, allowed: Set<string>, hint: string[] }[]}
 */
const PORTS = [
  {
    name: 'seed',
    what: 'фікстуру демо-даних',
    re: importOf('seed'),
    allowed: new Set(['src/lib/store.ts', 'src/lib/seed.ts', 'src/lib/seed-suppliers.ts']),
    hint: [
      '  `seed.ts` — демо-фікстура, а не джерело даних застосунку. Те, що там',
      '  лежить, постачає сервер, і читати це треба зі знімка:',
      '    TODAY            → config.businessToday',
      '    SEASON_START     → config.seasonStart',
      '    CASH_BOOK_FROM   → config.cashBookFrom',
      '    DEFAULT_TARE_ID  → config.crateTareId',
      '    PRODUCTS         → products',
      '    OPERATORS[x]     → signerFor(users, x)   (запасний підпис лишається за місцем виклику)',
      '    OWNER            → ownerName(users)',
    ],
  },
  {
    name: 'auth-mock',
    what: 'мок-«сервер» перевірки логіна й пароля',
    re: importOf('auth-mock'),
    allowed: new Set(['src/lib/store.ts']),
    hint: [
      '  `auth-mock.ts` стоїть НА МІСЦІ СЕРВЕРА і тримає секрети. Екранові він не',
      '  потрібен ні для чого — усе, що йому треба, уже є в контракті:',
      '    перевірити пару логін/пароль → signIn({ login, secret })   (команда стору)',
      '    хто за компʼютером           → useActor()                  (імʼя, роль, сесія)',
      '    список демо-акаунтів         → users зі знімка             (імʼя, роль, точка, логін)',
      '  Пароль демо — літерал у розмітці екрана входу, який людина набирає сама;',
      '  привозити його з цього модуля означало б покласти секрет у бандл поруч із кодом,',
      '  що його звіряє.',
    ],
  },
]

const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/
const IS_CODE = /\.[cm]?[jt]sx?$/

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
const files = sources()
/** @type {{ port: (typeof PORTS)[number], file: string, line: number, text: string }[]} */
const offenders = []
for (const file of files) {
  const lines = readFileSync(path.join(ROOT, file), 'utf8').split('\n')
  for (const port of PORTS) {
    if (port.allowed.has(file)) continue
    for (let i = 0; i < lines.length; i += 1) {
      if (port.re.test(lines[i])) offenders.push({ port, file, line: i + 1, text: lines[i].trim() })
    }
  }
}

if (offenders.length) {
  console.error('seed-port: ЧЕРВОНО')
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line} імпортує ${o.port.what} (порт «${o.port.name}»)`)
    console.error(`    ${o.text}`)
  }
  /*
   * Підказка друкується ОДИН раз на порт, а не на кожне порушення: коли межу пробили в
   * двадцяти файлах, двадцять однакових абзаців сховали б сам список файлів — тобто те
   * єдине, що читач мусить побачити.
   */
  for (const port of PORTS) {
    if (!offenders.some((o) => o.port === port)) continue
    console.error('')
    for (const line of port.hint) console.error(line)
    console.error(
      `  Дозволені імпортери порту «${port.name}» (поштучно): ${[...port.allowed].sort().join(', ')}`,
    )
  }
  process.exit(1)
}

console.log(
  `seed-port: обидві межі тримаються — ${files.length} файлів src/ перевірено; ` +
    PORTS.map((p) => `${p.name} ← ${[...p.allowed].sort().join(', ')}`).join(' | '),
)
