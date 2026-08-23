#!/usr/bin/env node
/**
 * The oxlint exemption, ratcheted.
 *
 * `.oxlintrc.json` carries an `overrides` block that switches
 * `react/only-export-components` off for three named vendored shadcn files. Its own comment
 * claims the exemption "may only shrink" — and review showed nothing enforced that. Removing
 * the offending export from one of the three left the entry useless and everything green,
 * while `deadcode` fired its stale direction on the very same change. A one-directional
 * suppression wearing ratchet language is the exact distinction this layer is built on.
 *
 * So: lift the overrides, ask oxlint what it finds, and require the answer to equal the
 * override list EXACTLY.
 *   - a fourth offending file → new finding → red
 *   - an override entry that no longer produces a finding → stale → red
 *
 * A whole-file `"off"` also hides any FURTHER offending export inside those three files, so
 * the per-file finding count is pinned too.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const CONFIG = path.join(ROOT, '.oxlintrc.json')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'lint-exempt.json')
const TMP_DIR = path.join(ROOT, '.verify')
const TMP_CONFIG = path.join(TMP_DIR, `oxlint-no-overrides.${process.pid}.json`)

const RULE = 'react(only-export-components)'

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('lint-exempt: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** `.oxlintrc.json` is JSONC — oxlint accepts comments, JSON.parse does not.
 * @param {string} text @returns {string} */
const stripComments = (text) =>
  text
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n')

function main() {
  const write = process.argv.includes('--write')

  /** @type {{rules?: Record<string, unknown>, overrides?: {files: string[], rules: Record<string, unknown>}[]}} */
  let cfg
  try {
    cfg = JSON.parse(stripComments(readFileSync(CONFIG, 'utf8')))
  } catch (err) {
    fail([`не вдалося прочитати .oxlintrc.json: ${err instanceof Error ? err.message : String(err)}`])
  }

  const exempted = (cfg.overrides ?? [])
    .filter((o) => o?.rules && 'react/only-export-components' in o.rules)
    .flatMap((o) => o.files ?? [])
    .sort()

  // Ask oxlint what it finds with the exemption lifted.
  const lifted = { ...cfg }
  delete lifted.overrides
  delete /** @type {Record<string, unknown>} */ (lifted).$schema
  /** @type {Record<string, number>} */
  const counts = {}
  try {
    mkdirSync(TMP_DIR, { recursive: true })
    writeFileSync(TMP_CONFIG, JSON.stringify(lifted))
    let out = ''
    try {
      out = execFileSync('./node_modules/.bin/oxlint', ['-c', TMP_CONFIG, '--format', 'json'], {
        cwd: ROOT,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }).toString('utf8')
    } catch (err) {
      // oxlint exits non-zero when it has findings; the JSON is still on stdout.
      const e = /** @type {{stdout?: Buffer}} */ (err)
      out = e.stdout?.toString('utf8') ?? ''
      if (!out.trim()) fail(['oxlint не дав виводу — перевірку неможливо провести'])
    }
    /** @type {{diagnostics?: {code?: string, filename?: string}[]}} */
    const parsed = JSON.parse(out)
    for (const d of parsed.diagnostics ?? []) {
      if (d.code !== RULE || !d.filename) continue
      counts[d.filename] = (counts[d.filename] ?? 0) + 1
    }
  } finally {
    rmSync(TMP_CONFIG, { force: true })
  }

  /** @type {{createdAt: string, note: string, entries: {file: string, findings: number, reason: string}[]}} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    baseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    if (!write) fail([`немає ${path.relative(ROOT, BASELINE)} — створіть через --write`])
  }

  if (write) {
    const existing = new Map(baseline.entries.map((e) => [e.file, e.reason]))
    const entries = Object.keys(counts)
      .sort()
      .map((f) => ({ file: f, findings: counts[f], reason: existing.get(f) ?? '' }))
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, entries }, null, 2)}\n`)
    process.stdout.write(`lint-exempt: baseline перезаписано — ${entries.length} файлів\n`)
    return
  }

  /** @type {string[]} */
  const problems = []
  const baselineFiles = new Set(baseline.entries.map((e) => e.file))

  for (const [file, n] of Object.entries(counts)) {
    const e = baseline.entries.find((x) => x.file === file)
    if (!e) {
      problems.push(
        `НОВИЙ ФАЙЛ ІЗ ЗНАХІДКОЮ: ${file} (${n}) — не в baseline винятків. Виняток може лише зменшуватися.`,
      )
    } else if (e.findings !== n) {
      problems.push(
        `ЗМІНИЛАСЯ КІЛЬКІСТЬ: ${file} — у baseline ${e.findings}, зі знятим винятком ${n}. ` +
          `Виняток на весь файл ховає і нові знахідки в ньому, тому кількість зафіксована.`,
      )
    }
  }
  for (const e of baseline.entries) {
    if (!(e.file in counts)) {
      problems.push(
        `ЗАСТАРІЛИЙ ВИНЯТОК: ${e.file} більше не дає знахідки — прибрати і з baseline, і з ` +
          `overrides у .oxlintrc.json.`,
      )
    }
    const r = (e.reason ?? '').trim()
    if (!r || r.length < 30) problems.push(`БЕЗ ПРИЧИНИ: ${e.file} — причина відсутня або занадто коротка.`)
  }
  // The two lists must describe the same set, or one of them is decoration.
  for (const f of exempted) {
    if (!baselineFiles.has(f)) {
      problems.push(`У .oxlintrc.json є виняток на ${f}, якого немає в baseline — списки розійшлися.`)
    }
  }
  for (const e of baseline.entries) {
    if (!exempted.includes(e.file)) {
      problems.push(`У baseline є ${e.file}, а в overrides .oxlintrc.json його немає — списки розійшлися.`)
    }
  }

  if (problems.length) fail(problems)

  process.stdout.write(
    `lint-exempt: ${baseline.entries.length} файлів під винятком, зі знятим винятком дають ` +
      `рівно ${Object.values(counts).reduce((a, b) => a + b, 0)} знахідок — збігається з baseline ` +
      `від ${baseline.createdAt}\n`,
  )
}

main()
