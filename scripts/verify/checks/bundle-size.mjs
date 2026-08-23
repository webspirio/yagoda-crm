#!/usr/bin/env node
/**
 * The bundle budget.
 *
 * `build` proved only that vite exited zero. It printed `(!) Some chunks are larger than
 * 500 kB` and nothing recorded or gated that number, so the shipped payload could double
 * without any row changing colour. For a tool used by operators at rural collection points
 * over mobile data, the transfer size IS the user-visible product quality.
 *
 * Gzip is the number that matters — that is what crosses the wire — so it is the one with a
 * budget. Raw is recorded too, because it is what the browser must parse and compile, which
 * is the cost on a cheap phone.
 *
 * The budget ratchets ONE WAY. Lowering it is an ordinary edit. Raising it must be a visible
 * diff in the budget file, with the reason recorded there, exactly like every other exemption
 * in this layer. The values are MEASURED, then rounded up to a stated headroom.
 *
 * The headroom is deliberate, and it is a correction. The first version pinned the budget to
 * the measured byte exactly, with zero slack. It then failed on the very next commit over an
 * **18-byte** gzip increase from adding one small helper — which is not a regression, it is
 * ordinary work. A check that demands a budget edit for 18 bytes is precisely the noise that
 * teaches people to bump budgets without reading them, the same failure the money ratchet's
 * scope was narrowed to avoid. What this must catch is a REGRESSION — a new charting library,
 * an accidental whole-package import — and those are tens or hundreds of KiB, not bytes.
 *
 * Creep is still visible: the slack is printed on every passing run, and the check warns
 * before it fails once most of the headroom is gone.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const ASSETS = path.join(ROOT, 'dist', 'assets')
const BUDGET = path.join(ROOT, 'scripts', 'verify', 'baselines', 'bundle-budget.json')

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('bundle: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** @param {number} n @returns {string} */
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`

function measure() {
  /** @type {{file: string, raw: number, gzip: number}[]} */
  const files = []
  let names
  try {
    names = readdirSync(ASSETS)
  } catch {
    fail([
      `немає ${path.relative(ROOT, ASSETS)} — спочатку треба зібрати (npm run build).`,
      `Це не «нуль байтів»: відсутність артефакту не є проходженням перевірки.`,
    ])
  }
  for (const f of names) {
    if (!/\.(js|css)$/.test(f)) continue
    const b = readFileSync(path.join(ASSETS, f))
    files.push({ file: f, raw: b.length, gzip: gzipSync(b, { level: 9 }).length })
  }
  if (files.length === 0) fail([`у dist/assets немає жодного .js або .css — збірка порожня?`])
  return files
}

function main() {
  const write = process.argv.includes('--write')
  const files = measure()
  const raw = files.reduce((a, f) => a + f.raw, 0)
  const gzip = files.reduce((a, f) => a + f.gzip, 0)

  if (write) {
    /** @type {any} */
    let prev = {}
    try {
      prev = JSON.parse(readFileSync(BUDGET, 'utf8'))
    } catch {
      /* first write */
    }
    // Round the measured value up to the next headroom step, and record both the measurement
    // and the headroom so a reader can see which is which.
    const STEP_G = 5 * 1024
    const STEP_R = 20 * 1024
    const maxG = Math.ceil(gzip / STEP_G) * STEP_G
    const maxR = Math.ceil(raw / STEP_R) * STEP_R
    writeFileSync(
      BUDGET,
      `${JSON.stringify(
        {
          ...prev,
          measuredAt: new Date().toISOString().slice(0, 10),
          measuredGzipBytes: gzip,
          measuredRawBytes: raw,
          maxGzipBytes: maxG,
          maxRawBytes: maxR,
          headroomGzipBytes: maxG - gzip,
          headroomRawBytes: maxR - raw,
        },
        null,
        2,
      )}\n`,
    )
    process.stdout.write(
      `bundle: бюджет записано — зміряно ${kib(gzip)} gzip, стеля ${kib(maxG)} ` +
        `(запас ${kib(maxG - gzip)})\n`,
    )
    return
  }

  /** @type {{measuredAt: string, note: string, maxGzipBytes: number, maxRawBytes: number,
   *          measuredGzipBytes?: number, measuredRawBytes?: number,
   *          headroomGzipBytes?: number, headroomRawBytes?: number}} */
  let budget
  try {
    budget = JSON.parse(readFileSync(BUDGET, 'utf8'))
  } catch {
    fail([`немає ${path.relative(ROOT, BUDGET)} — створіть через --write`])
  }

  /** @type {string[]} */
  const problems = []
  if (gzip > budget.maxGzipBytes) {
    problems.push(
      `GZIP ПЕРЕВИЩЕНО: ${kib(gzip)} проти бюджету ${kib(budget.maxGzipBytes)} ` +
        `(+${kib(gzip - budget.maxGzipBytes)}). Це те, що реально переїжджає мережу.`,
    )
  }
  if (raw > budget.maxRawBytes) {
    problems.push(
      `RAW ПЕРЕВИЩЕНО: ${kib(raw)} проти бюджету ${kib(budget.maxRawBytes)} ` +
        `(+${kib(raw - budget.maxRawBytes)}). Це те, що телефон мусить розібрати.`,
    )
  }
  if (problems.length) {
    problems.push(
      `Підняти бюджет — це видима правка у ${path.relative(ROOT, BUDGET)} з причиною. ` +
        `Храповик крутиться лише на зменшення.`,
    )
    fail(problems)
  }

  for (const f of files.sort((a, b) => b.gzip - a.gzip)) {
    process.stdout.write(`bundle:   ${f.file}  ${kib(f.raw)} raw / ${kib(f.gzip)} gzip\n`)
  }
  const slackG = budget.maxGzipBytes - gzip
  process.stdout.write(
    `bundle: усього ${kib(gzip)} gzip / ${kib(raw)} raw — у межах бюджету від ` +
      `${budget.measuredAt} (запас ${kib(slackG)} gzip з ${kib(budget.headroomGzipBytes ?? 0)})\n`,
  )
  // Warn while there is still room to act, rather than only at the moment it goes red.
  const head = budget.headroomGzipBytes ?? 0
  if (head > 0 && slackG < head * 0.25) {
    process.stdout.write(
      `bundle: УВАГА — запасу лишилося ${kib(slackG)} з ${kib(head)}. Наступне помітне ` +
        `доповнення впаде. Це момент подумати про code splitting, а не про підняття бюджету.\n`,
    )
  }
  // A single chunk this size is worth saying out loud even when it passes.
  const biggest = files[0]
  if (biggest && biggest.gzip > 200 * 1024) {
    process.stdout.write(
      `bundle: УВАГА — ${biggest.file} сам по собі ${kib(biggest.gzip)} gzip, одним чанком без ` +
        `code splitting. Бюджет це дозволяє, але для мобільного інтернету на точці це багато.\n`,
    )
  }
}

main()
