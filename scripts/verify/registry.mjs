/**
 * The check registry. This file is the point of the whole layer: it is where what a
 * check PROVES and what it stays BLIND TO live side by side, as data, so the runner's
 * output, the CI log and CLAUDE.md cannot drift apart from each other.
 *
 * Rules for editing:
 *  - `proves` must be falsifiable by this exact command failing. If no possible failure
 *    of `cmd` could make the sentence untrue, it is decoration — delete it.
 *  - `blindSpot` must not be written broader than the command establishes.
 *  - `after` only where the dependency is real, not where the order merely feels tidy.
 */

import { existsSync } from 'node:fs'

/**
 * @typedef {'fast' | 'full'} Tier
 * @typedef {'playwright-browser' | 'npm-registry'} PreconditionId
 */

/**
 * @typedef {object} Check
 * @property {string} id
 * @property {Tier} tier
 * @property {string} cmd            command, run through /bin/sh from the repo root
 * @property {string} [fullCmd]      form used when the tier is `full` (e.g. instrumented)
 * @property {PreconditionId} [needs] precondition; absent means SKIPPED, not FAILED
 * @property {string[]} [after]      ids that must have PASSED, else NOT_RUN
 * @property {string} proves         what a PASSED row establishes
 * @property {string} blindSpot      what it still says nothing about
 */

/**
 * @typedef {object} Precondition
 * @property {string} describe   what is missing, in the SKIPPED reason
 * @property {() => Promise<boolean>} probe
 */

/**
 * A precondition answers exactly one question: "are there conditions to run in at all?"
 * It must never answer "did it work". Browser absent is SKIPPED; browser present and the
 * spec red is FAILED. Collapsing those two is how a dead suite stays green for months.
 *
 * @type {Record<PreconditionId, Precondition>}
 */
export const PRECONDITIONS = {
  'playwright-browser': {
    describe:
      'Chromium для Playwright не встановлений (npx playwright install chromium). ' +
      'Перевіряється саме той бінарник, який запускає playwright.config.ts (channel: chromium).',
    probe: async () => {
      try {
        // @playwright/test, not playwright-core: the transitive package is not ours
        // to depend on, and knip is right to call that out.
        const { chromium } = await import('@playwright/test')
        return existsSync(chromium.executablePath())
      } catch {
        return false
      }
    },
  },
  'npm-registry': {
    describe:
      'Реєстр npm недосяжний, тому базу адвайзорі перевірити нічим. Це відсутня передумова, ' +
      'а не «вразливостей немає»: у формі --no-skip це падіння.',
    probe: async () => {
      try {
        const ac = new AbortController()
        const t = setTimeout(() => ac.abort(), 4000)
        // HEAD on the registry root: cheap, and it answers exactly the question asked.
        const res = await fetch('https://registry.npmjs.org/', {
          method: 'HEAD',
          signal: ac.signal,
        })
        clearTimeout(t)
        return res.ok
      } catch {
        return false
      }
    },
  },
}

/** @type {Check[]} */
export const CHECKS = [
  {
    id: 'lint',
    tier: 'fast',
    cmd: 'npm run lint',
    proves:
      'oxlint розібрав кожен файл, що потрапляє під його конфіг, і не залишив ані помилки, ' +
      'ані попередження за ввімкненими правилами — бо --max-warnings=0 робить warn і error одним.',
    blindSpot:
      'Нічого про поведінку: чи арифметика правильна, чи компонент рендериться. Правило, ' +
      'яке не ввімкнене, для нього не існує — а ввімкнений набір це, по суті, типова ' +
      'категорія correctness плюс два явні правила, тож про залежності хуків він каже ' +
      'мало. Виняток у .oxlintrc.json перелічує РІВНО ТРИ файли поштучно (button.tsx, ' +
      'badge.tsx, tabs.tsx), не глоб ui/**, і саме там ховаються три знахідки.',
  },
  {
    id: 'typecheck',
    tier: 'fast',
    cmd: 'npm run typecheck',
    proves:
      'tsc -b звів усі три проєкти (app, node, scripts) без помилок: типові контракти між ' +
      'модулями узгоджені, немає невикористаних локальних змінних і параметрів, немає ' +
      'провалу через case. Разом зі scripts/ це покриває і код самого шару перевірок.',
    blindSpot:
      'Нічого про рантайм-дані. ISODate = string приймає "hello"; кожен ! (напр. App.tsx:25) ' +
      'і кожен as — дірка. Про JSON, що приходить з localStorage, tsc не знає нічого.',
  },
  {
    id: 'test',
    tier: 'fast',
    cmd: 'npm test',
    proves:
      'Обрані сценарії над src/lib (calc, seed, visit) пройшли свої assertions: округлення ' +
      'до копійки, FIFO-розподіл виплат, «Разом» візиту, зведення дня.',
    blindSpot:
      'Жоден .tsx не виконується цим рядком: у репозиторії їх 45 (20 поза ' +
      'src/components/ui/, і 19 потрапляють у звіт покриття). Усі сторінки й компоненти ' +
      'поза ним. ' +
      'Нічого про сценарії, яких ніхто не написав, і нічого про силу assertions: тест, ' +
      'що викликає функцію і не перевіряє результат, зелений так само.',
  },
  {
    id: 'testfiles',
    tier: 'fast',
    cmd: 'npm run test:files',
    proves:
      'Кожен файл *.{test,spec}.* у репозиторії підбирається рівно одним runner-ом — ' +
      'vitest або playwright, не нулем і не двома.',
    blindSpot:
      'Нічого про самі тести. Лише про те, що жоден файл не втрачено між двома glob-ами — ' +
      'саме та перевірка, якої не було, коли .tsx-тести могли б лежати непідібраними.',
  },
  {
    id: 'ratchet:money',
    tier: 'fast',
    after: ['typecheck'],
    cmd: 'npm run ratchet:money',
    proves:
      'Кожен арифметичний вираз, що потрапляє у uah або uahAuto, обгорнутий round2()/sum(), ' +
      'окрім перелічених у baselines/money-rounding.json — з точною кількістю входжень, ' +
      'тому часткове виправлення не зараховується. Прив’язки форматерів і round2/sum ' +
      'розібрані по імпортах, тому ні псевдонім, ні namespace-імпорт, ні локальний ' +
      'самозваний round2 не проходять.',
    blindSpot:
      'Нічого про правильність самої арифметики: round2(a*b) перевірено на округлення, не ' +
      'на сенс. Під храповиком лише uah/uahAuto — num/kg/tonnage навмисно виведені (на них ' +
      'правило давало переважно шум) і тільки друкуються у звіті, тому ₴-величина, показана ' +
      'через num(), НЕ гарантована. І перевіряється арифметика САМЕ в місці виклику ' +
      'форматера: значення, пораховане у змінну, невидиме — і row.net += r.net ' +
      '(DashboardPage.tsx:66-68), і avgPrice = totals.amount / totals.net (:86), який ' +
      'друкується як ₴/кг на :201.',
  },
  {
    id: 'ratchet:persist',
    tier: 'fast',
    after: ['typecheck'],
    cmd: 'npm run ratchet:persist',
    proves:
      'Кожен ключ, який store.ts віддає у partialize, має рантайм-звуження на шляху ' +
      'rehydrate, окрім перелічених у baselines/persist-boundary.json — і кожен запис ' +
      'того baseline досі відтворюється.',
    blindSpot:
      'Не перевіряє глибину: Array.isArray(receptions) зараховується, хоча про поля ' +
      'всередині не каже нічого. Зараховуються лише звуження, семантику яких видно з AST ' +
      '(Array.isArray, typeof, instanceof, in, схема .parse, локальний type predicate) — ' +
      'предикат, імпортований з іншого файлу, підтвердити неможливо і він НЕ зараховується. ' +
      'Деструктурований параметр rehydrate-колбека теж не відслідковується: справжня ' +
      'перевірка через ({ receptions }) буде показана як відсутня. Лише цей один store.',
  },
  {
    id: 'deadcode',
    tier: 'fast',
    after: ['typecheck'],
    cmd: 'npm run deadcode',
    proves:
      'Набір невикористаних файлів, експортів і залежностей дорівнює ' +
      'baselines/dead-exports.json, у обидва боки: нова знахідка падає, зникла падає теж. ' +
      'Плюс конфіг knip містить ЛИШЕ entry/project (усе інше — поза дозволеним списком), ' +
      'іншого конфігу knip немає, глоби зафіксовані відпечатком у baseline, і в коді немає ' +
      'тегів @public/@internal, якими можна прибрати знахідку без зміни конфігу.',
    blindSpot:
      'Роздільна здатність самого knip: динамічний доступ obj[name], рядкові ключі, усе, ' +
      'до чого дістаються лише з HTML. Глоби project покривають тільки .ts/.tsx/.mjs, тому ' +
      'мертві не-кодові файли (напр. src/assets/*.png, public/icons.svg) невидимі для нього ' +
      'у принципі. І запис baseline з неправильною причиною проходить так само, як з ' +
      'правильною — причини перевіряє людина, не чекер.',
  },
  {
    id: 'memo',
    tier: 'fast',
    cmd: 'node scripts/verify/checks/memo-drift.mjs',
    proves:
      'Таблиця «доводить / не доводить» у CLAUDE.md збігається символ у символ з тим, що ' +
      'рендерить цей registry, плюс контрольна сума над СИРИМИ рядками registry — тобто ' +
      'ані пам’ятка не могла відстати від коду, ані правка registry не могла сховатися у ' +
      'згорнутих пробілах.',
    blindSpot:
      'Порівнює лише цю таблицю. Про решту CLAUDE.md і про те, чи самі формулювання ' +
      'правдиві, не каже нічого: збіг двох артефактів — не доказ, що обидва праві.',
  },
  {
    id: 'lint:exempt',
    tier: 'fast',
    cmd: 'npm run lint:exempt',
    proves:
      'Список винятків react/only-export-components у .oxlintrc.json дорівнює ' +
      'baselines/lint-exempt.json — і зі знятим винятком кожен із тих файлів дає РІВНО ту ' +
      'кількість знахідок, що записана. Тобто виняток може лише зменшуватися, і виняток на ' +
      'весь файл більше не ховає нових знахідок у ньому.',
    blindSpot:
      'Лише це одне правило і лише механізм overrides. Про рядкові директиви ' +
      'oxlint-disable-next-line не каже нічого — їх ніщо не храповить, вони тримаються ' +
      'тільки на вимозі писати причину в тому ж рядку.',
  },
  {
    id: 'pii',
    tier: 'fast',
    cmd: 'npm run pii',
    proves:
      'docs/ і input/ досі ігноруються git, жоден відслідковуваний файл не лежить під ними, ' +
      'і жодної таблиці (.xlsx/.xls/.numbers) не відслідковується. Це межа, за якою 208 ' +
      'справжніх прізвищ клієнта не потрапляють у публічний репозиторій.',
    blindSpot:
      'Перевіряє МЕЖУ, не ВМІСТ: жодного сканування відслідковуваних файлів на прізвища ' +
      'немає, тому прізвище, вписане прямо в src/, ця перевірка не побачить. Історію git ' +
      'вона теж не читає — якщо щось уже було закомічено раніше, тут буде зелено.',
  },
  {
    id: 'audit',
    tier: 'full',
    needs: 'npm-registry',
    cmd: 'npm run audit:check',
    proves:
      'Набір адвайзорі npm audit дорівнює baselines/audit.json, у обидва боки. І понад те: ' +
      'жодної адвайзорі немає у ПРОДАКШН-дереві залежностей і жодної немає з рівнем ' +
      'critical — ці два класи не заносяться у baseline за жодною причиною.',
    blindSpot:
      'Вердикт залежить від бази GitHub, яка змінюється без змін тут — тому це повний ' +
      'рівень, а не швидкий: подія на боці не має права заблокувати хід. Нічого не каже ' +
      'про вразливості, яких у базі ще немає, і нічого про власний код: це аудит ' +
      'залежностей, не застосунку.',
  },
  {
    id: 'build',
    tier: 'full',
    cmd: 'npm run build',
    proves:
      'tsc -b пройшов і vite зібрав dist/ з index.html та assets.',
    blindSpot:
      'Нічого про те, чи артефакт працює, і нічого про базовий шлях: змініть base на ' +
      '/wrong/ — ця команда все одно вийде з нулем. Базовий шлях доводить лише smoke, ' +
      'бо він відкриває артефакт саме під /yagoda-crm/. Збірка може пройти, а застосунок ' +
      '— упасти на першому рендері.',
  },
  {
    id: 'bundle',
    tier: 'full',
    after: ['build'],
    cmd: 'npm run bundle',
    proves:
      'Розмір зібраного dist/assets не перевищує стелю з baselines/bundle-budget.json — і в ' +
      'gzip (те, що переїжджає мережу), і в сирому вигляді (те, що телефон розбирає). Стеля ' +
      'зміряна й округлена вгору з явним запасом 5 KiB gzip, який записаний у тому ж файлі.',
    blindSpot:
      'Каже лише про байти, і лише про dist/assets. Нічого про час до першого рендеру, про ' +
      'шрифти з Google Fonts, які тягне index.html, і нічого про те, чи цей розмір узагалі ' +
      'виправданий — 260 KiB gzip одним чанком він пропускає, бо саме стільки зміряно ' +
      'сьогодні. І через запас 5 KiB зростання дрібнішими кроками пройде: воно видне лише ' +
      'як спадання запасу у виводі, а не як падіння.',
  },
  {
    id: 'smoke',
    tier: 'full',
    needs: 'playwright-browser',
    after: ['build'],
    cmd: 'npm run test:e2e',
    proves:
      'Зібраний артефакт, поданий під своїм продакшн-базовим шляхом, піднявся у Chromium ' +
      'без page error і без console error; один візит пройшов від ваги до «Разом» із ' +
      'перевіркою самої суми (не лише підпису) і без «NaN» у тексті сторінки; усі розділи ' +
      'навігації та роль власника відкрилися так само чисто.',
    blindSpot:
      'Один браузер, один розмір вікна, тільки демо-дані з seed — і, головне, шлях ' +
      'rehydrate НЕ виконується жодного разу: браузер починає з порожнім localStorage, ' +
      'тому саме та межа, яку описує ratchet:persist, тут не торкається. Перевіряється ' +
      'рендер, відсутність помилок і відсутність NaN, а не правильність жодної суми. ' +
      'Retries = 0, тому нестабільність видно як червоне, а не як «пройшло з другої спроби».',
  },
  {
    id: 'coverage',
    tier: 'full',
    cmd: 'npm run coverage',
    proves:
      'Покриття рядків і гілок для src/** (крім src/components/ui/**, src/main.tsx і самих ' +
      'тестів) зміряно і записано у coverage/. Локально це і все, що воно доводить. У CI ' +
      'пороги беруться з env у .github/workflows/verify.yml, і відсутнє або нечислове ' +
      'значення тепер валить перевірку, а не тихо стає нулем.',
    blindSpot:
      'Виконання — не перевірка. Тест, який викликає функцію і нічого не стверджує, ' +
      'підіймає покриття так само, як справжній. Поріг для .tsx — 0: число показане, ' +
      'але нічого не вимагає, бо компонентних тестів немає жодного.',
  },
]

/** @type {Record<Tier, number>} */
const TIER_RANK = { fast: 0, full: 1 }

/**
 * `fast` is a subset of `full`, so a full run includes every fast check.
 *
 * @param {Tier} checkTier
 * @param {Tier} requested
 * @returns {boolean}
 */
export function inTier(checkTier, requested) {
  return TIER_RANK[checkTier] <= TIER_RANK[requested]
}

/**
 * @param {Tier} a
 * @param {Tier} b
 * @returns {boolean} true when `a` covers at least as much as `b`
 */
export function tierCovers(a, b) {
  return TIER_RANK[a] >= TIER_RANK[b]
}

/** @param {string} id @returns {Check | undefined} */
export function checkById(id) {
  return CHECKS.find((c) => c.id === id)
}
