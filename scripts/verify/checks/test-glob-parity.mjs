#!/usr/bin/env node
/**
 * Every `*.{test,spec}.*` file in the repository must be collected by exactly one
 * runner — vitest or playwright, not zero and not both.
 *
 * This exists because the cheapest way to have a dead test suite is a glob that quietly
 * excludes a whole file extension: the runner reports "3 files, 174 tests passed" and
 * nobody notices the other forty. The check does NOT re-derive the globs from the config
 * files — that would just move the drift. It asks each runner what it actually collects.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

// [cm]? covers .mts/.cts. Review planted a FAILING src/zz.test.mts: no runner collected it
// and this check reported green — the exact "a glob quietly excludes a whole extension"
// failure named in the header comment above.
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/

/** @param {unknown} err @returns {string} */
const msg = (err) => (err instanceof Error ? err.message : String(err))

/**
 * @param {string} file
 * @param {string[]} args
 * @returns {string}
 */
function run(file, args) {
  return execFileSync(file, args, {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString('utf8')
}

/** @returns {string[]} every candidate test file, tracked or newly written */
function candidates() {
  const raw = run('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'])
  return [...new Set(raw.split('\u0000').filter((f) => f && TEST_FILE.test(f)))].sort()
}

/** @returns {string[]} */
function vitestFiles() {
  // `--json` MUST stay the last argument: vitest treats a following positional as the
  // output path, which would send this to a file and leave stdout empty — and an empty
  // stdout parsed as "zero test files" reads GREEN.
  const out = run('./node_modules/.bin/vitest', ['list', '--filesOnly', '--json'])
  if (!out.trim()) {
    throw new Error('vitest list повернув порожній stdout — це не «нуль тестів», це збій')
  }
  /** @type {{file: string}[]} */
  const parsed = JSON.parse(out)
  return parsed.map((e) => path.relative(ROOT, e.file))
}

/** @returns {string[]} */
function playwrightFiles() {
  let out
  try {
    out = run('./node_modules/.bin/playwright', ['test', '--list', '--reporter=json'])
  } catch (err) {
    // Playwright exits non-zero when zero tests match. That is "no specs", not "cannot
    // enumerate" — and conflating them turned the honest warning below into an opaque red.
    const e = /** @type {{stdout?: Buffer}} */ (err)
    const text = e.stdout?.toString('utf8') ?? ''
    if (/no tests found/i.test(text) || !text.trim()) return []
    out = text
  }
  const parsed = JSON.parse(out)
  const rootDir = parsed?.config?.rootDir ?? path.join(ROOT, 'e2e')
  /** @type {Set<string>} */
  const files = new Set()
  /** @param {any} node */
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.file === 'string') files.add(path.relative(ROOT, path.resolve(rootDir, node.file)))
    for (const key of ['suites', 'specs']) {
      if (Array.isArray(node[key])) node[key].forEach(walk)
    }
  }
  if (Array.isArray(parsed?.suites)) parsed.suites.forEach(walk)
  return [...files]
}

function main() {
  /** @type {string[]} */
  const problems = []

  let found
  /** @type {string[]} */
  let vitest = []
  /** @type {string[]} */
  let playwright = []
  try {
    found = candidates()
    vitest = vitestFiles()
    playwright = playwrightFiles()
  } catch (err) {
    // Cannot enumerate is not the same as "everything is fine".
    process.stderr.write(`test:files: не вдалося перелічити тести: ${msg(err)}\n`)
    process.exit(1)
  }

  const vset = new Set(vitest)
  const pset = new Set(playwright)

  for (const file of found) {
    const claims = [vset.has(file) && 'vitest', pset.has(file) && 'playwright'].filter(Boolean)
    if (claims.length === 0) {
      problems.push(
        `ОСИРОТІЛИЙ: ${file} — не підбирається ні vitest, ні playwright. ` +
          `Файл виглядає як тест і не запускається жодним runner-ом.`,
      )
    } else if (claims.length > 1) {
      problems.push(`ПОДВІЙНИЙ: ${file} — підбирається обома (${claims.join(' + ')}).`)
    }
  }

  for (const file of [...vset, ...pset]) {
    if (!found.includes(file)) {
      problems.push(
        `НЕОЧІКУВАНИЙ: ${file} збирається runner-ом, але не потрапляє під шаблон ` +
          `*.{test,spec}.* — або шаблон цієї перевірки застарів, або файл названо дивно.`,
      )
    }
  }

  const summary =
    `${found.length} файл(ів) тестів · vitest: ${vset.size} · playwright: ${pset.size}`

  if (problems.length) {
    process.stderr.write(`test:files: ${summary}\n`)
    for (const p of problems) process.stderr.write(`  ${p}\n`)
    process.exit(1)
  }

  process.stdout.write(`test:files: ${summary} — кожен рівно в одному runner-і\n`)
  // Said out loud even on success: parity is not coverage.
  if (!playwright.some((f) => f.startsWith('e2e/'))) {
    process.stdout.write(
      `test:files: УВАГА — playwright не збирає жодного файлу, отже рядок smoke нічого не перевіряє.\n`,
    )
  }
}

main()
