#!/usr/bin/env node
/**
 * Dependency advisories, as a ratchet.
 *
 * `npm audit` was previously checked by nothing at all. The point is not the advisories that
 * exist today — all remaining ones are dev-only and unreachable from the shipped bundle —
 * it is that a future CRITICAL in a runtime dependency would otherwise be invisible.
 *
 * Two tiers of strictness, deliberately different:
 *
 *   - Anything in the PRODUCTION tree, and anything CRITICAL, fails outright and CANNOT be
 *     baselined. A runtime-reachable critical is not something you get to write a reason for.
 *   - Everything else is enumerated in a dated baseline with a reason, bidirectional as
 *     usual: a new advisory fails, and one that has been fixed must be removed.
 *
 * This lives in the FULL tier, not the fast one, on purpose. Its verdict depends on GitHub's
 * advisory database, which changes without anything changing here — so it must not be able to
 * block a turn on an upstream event. CI runs the full tier on every PR, so it still gates
 * merges; it just cannot wedge someone mid-task.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'audit.json')

const PLACEHOLDER =
  /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above)\.?$/i

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('audit: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** @returns {Set<string>} package names present in the production dependency tree */
function productionTree() {
  /** @type {Set<string>} */
  const names = new Set()
  let out = ''
  try {
    out = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    const e = /** @type {{stdout?: Buffer}} */ (err)
    out = e.stdout?.toString('utf8') ?? ''
  }
  if (!out.trim()) return names
  /** @param {any} node */
  const walk = (node) => {
    for (const [name, dep] of Object.entries(node?.dependencies ?? {})) {
      names.add(name)
      walk(dep)
    }
  }
  try {
    walk(JSON.parse(out))
  } catch {
    /* an unparseable tree is handled by the caller treating the set as empty */
  }
  return names
}

/**
 * @param {Set<string>} prod  package names in the production dependency tree
 * @returns {{name: string, severity: string, prod: boolean, title: string}[]}
 */
function advisories(prod) {
  let raw = ''
  try {
    raw = execFileSync('npm', ['audit', '--json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    const e = /** @type {{stdout?: Buffer}} */ (err)
    raw = e.stdout?.toString('utf8') ?? ''
    if (!raw.trim()) fail(['npm audit не дав виводу — перевірку неможливо провести'])
  }
  /** @type {any} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(['npm audit повернув не-JSON — тлумачити це як «нічого не знайдено» не можна'])
  }
  /** @type {{name: string, severity: string, prod: boolean, title: string}[]} */
  const out = []
  for (const [name, v] of Object.entries(parsed.vulnerabilities ?? {})) {
    const vuln = /** @type {any} */ (v)
    if (vuln.severity === 'info') continue
    const title =
      (vuln.via ?? [])
        .filter((/** @type {any} */ x) => typeof x === 'object' && x.title)
        .map((/** @type {any} */ x) => x.title)[0] ?? '(без назви)'
    out.push({ name, severity: vuln.severity, prod: prod.has(name), title })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

/** @param {unknown} reason @returns {string | null} */
function reasonProblem(reason) {
  if (typeof reason !== 'string') return 'причина відсутня'
  const t = reason.trim()
  if (!t) return 'причина порожня'
  if (PLACEHOLDER.test(t)) return `причина — заглушка (${JSON.stringify(t)})`
  if (t.length < 30) return `причина занадто коротка (${t.length} символів, мінімум 30)`
  return null
}

function main() {
  const write = process.argv.includes('--write')
  const prod = productionTree()
  const found = advisories(prod)

  /** @type {{createdAt: string, note: string, entries: {name: string, severity: string, reason: string}[]}} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    baseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    if (!write) fail([`немає ${path.relative(ROOT, BASELINE)} — створіть через --write`])
  }

  if (write) {
    const existing = new Map(baseline.entries.map((e) => [e.name, e.reason]))
    const entries = found.map((a) => ({
      name: a.name,
      severity: a.severity,
      reason: existing.get(a.name) ?? '',
    }))
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, entries }, null, 2)}\n`)
    process.stdout.write(`audit: baseline перезаписано — ${entries.length} записів\n`)
    return
  }

  /** @type {string[]} */
  const problems = []

  // Hard floor: these two classes are not baselinable at all.
  for (const a of found) {
    if (a.prod) {
      problems.push(
        `У ПРОДАКШН-ДЕРЕВІ: ${a.severity} ${a.name} — «${a.title}». Це потрапляє в бандл, ` +
          `який віддається користувачам, тому виняток тут не передбачений: оновлювати.`,
      )
    }
    if (a.severity === 'critical') {
      problems.push(
        `CRITICAL: ${a.name} — «${a.title}». Critical не заноситься в baseline за жодних ` +
          `причин: або оновити, або прибрати залежність.`,
      )
    }
  }

  const baselineNames = new Set(baseline.entries.map((e) => e.name))
  for (const a of found) {
    if (a.prod || a.severity === 'critical') continue
    if (!baselineNames.has(a.name)) {
      problems.push(
        `НОВА АДВАЙЗОРІ: ${a.severity} ${a.name} — «${a.title}». Не в baseline. Або ` +
          `виправити, або записати з причиною, чому вона тут нешкідлива.`,
      )
    }
  }
  const foundNames = new Set(found.map((a) => a.name))
  for (const e of baseline.entries) {
    if (!foundNames.has(e.name)) {
      problems.push(
        `ЗАСТАРІЛИЙ ЗАПИС: ${e.name} більше не має адвайзорі — прибрати з baseline ` +
          `(храповик крутиться лише на зменшення).`,
      )
    }
    const p = reasonProblem(e.reason)
    if (p) problems.push(`БЕЗ ПРИЧИНИ: ${e.name} — ${p}.`)
  }

  if (problems.length) fail(problems)

  const bySev = found.reduce((/** @type {Record<string, number>} */ acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1
    return acc
  }, {})
  process.stdout.write(
    `audit: ${found.length} адвайзорі (${Object.entries(bySev).map(([k, v]) => `${k}: ${v}`).join(', ') || 'жодної'}), ` +
      `усі перелічені у baseline від ${baseline.createdAt}, жодної у продакшн-дереві\n`,
  )
  process.stdout.write(
    `audit: УВАГА — вердикт залежить від бази адвайзорі GitHub, яка змінюється без змін у ` +
      `цьому репозиторії. Тому це повний рівень, а не швидкий: воно не має права заблокувати ` +
      `хід через подію на боці.\n`,
  )
}

main()
