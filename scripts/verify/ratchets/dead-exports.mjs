#!/usr/bin/env node
/**
 * Dead code as a ratchet, not a cleanup.
 *
 * knip can reach green through blanket knobs — `ignore`, `ignoreDependencies`,
 * `ignoreExportsUsedInFile` — and three of those can hide dozens of findings behind one
 * line nobody reads again. So this check does two things a bare `knip` cannot:
 *
 *  1. It refuses to run if knip.json contains any suppression knob at all. Widening the
 *     tool's config to go green fails the check instead of passing it.
 *  2. It compares knip's findings against an enumerated, dated baseline in BOTH
 *     directions. A new finding fails. A baseline entry that no longer reproduces also
 *     fails, so a fix must be accompanied by removing its entry. That bidirectional rule
 *     is the whole difference between a ratchet and a suppression.
 *
 * Nothing here deletes anybody's exports. Two of the findings below are reachable code
 * with no caller, which is a report worth reading, not something to quietly erase.
 *
 * `--write` regenerates the baseline from the current findings, keeping existing reasons.
 * It is for the initial adoption and for re-keying, never for making a red run green.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'dead-exports.json')
const KNIP_CONFIG = path.join(ROOT, 'knip.json')

/**
 * ALLOW-LIST, not deny-list. The previous version listed eight "suppression knobs" and
 * review showed the approach was unsound in both directions at once:
 *
 *   - its first entry, `ignore`, DOES NOT EXIST in knip 6 (verified against
 *     node_modules/knip/schema.json) — it guarded a phantom;
 *   - `ignoreFiles`, `ignoreIssues`, `include`, `tags`, `rules` and `workspaces` were all
 *     unguarded, and four separate bypasses each printed "no suppression key in knip.json".
 *
 * So the check now asserts the config contains NOTHING but these keys. A knob nobody
 * thought of fails by default instead of passing by default.
 */
const ALLOWED_CONFIG_KEYS = new Set(['$schema', 'entry', 'project'])

/**
 * Every location knip resolves a config from. Reading only knip.json meant a suppression in
 * `package.json#knip` worked while knip.json sat innocent and the wrapper reported clean.
 */
const OTHER_CONFIG_FILES = [
  'knip.jsonc',
  'knip.ts',
  'knip.js',
  'knip.mjs',
  'knip.cjs',
  '.knip.json',
  '.knip.jsonc',
]

/**
 * JSDoc tags knip honours by default. `/** @public *\/` on an export removes it from the
 * findings with ZERO config change, so no config check could ever see it.
 */
const KNIP_TAGS = /@(public|internal|alias|beta|alpha)\b/

/** knip issue arrays we treat as findings, mapped to the `kind` recorded in the baseline. */
const KINDS = {
  files: 'file',
  exports: 'export',
  types: 'type',
  dependencies: 'dependency',
  devDependencies: 'devDependency',
  unlisted: 'unlisted',
  unresolved: 'unresolved',
  duplicates: 'duplicate',
  binaries: 'binary',
  enumMembers: 'enumMember',
  namespaceMembers: 'namespaceMember',
  optionalPeerDependencies: 'optionalPeerDependency',
}

/**
 * @typedef {object} Finding
 * @property {string} kind
 * @property {string} file
 * @property {string} name
 */

/** @param {Finding} f @returns {string} */
const keyOf = (f) => `${f.kind}|${f.file}|${f.name}`

const PLACEHOLDER =
  /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above|dead)\.?$/i

/**
 * A reason the checker itself will not accept. Without this, an unexplained entry passes
 * and the baseline degrades into the suppression list it was supposed to replace.
 *
 * @param {unknown} reason
 * @returns {string | null} the problem, or null when acceptable
 */
function reasonProblem(reason) {
  if (typeof reason !== 'string') return 'причина відсутня'
  const t = reason.trim()
  if (!t) return 'причина порожня'
  if (PLACEHOLDER.test(t)) return `причина — заглушка (${JSON.stringify(t)})`
  if (t.length < 30) return `причина занадто коротка (${t.length} символів, мінімум 30)`
  return null
}

/**
 * @returns {{ fingerprint: string }} identity of the entry/project globs
 */
function assertConfigIsClean() {
  /** @type {Record<string, unknown>} */
  let cfg
  try {
    cfg = JSON.parse(readFileSync(KNIP_CONFIG, 'utf8'))
  } catch (err) {
    fail([`не вдалося прочитати knip.json: ${err instanceof Error ? err.message : String(err)}`])
  }

  const extra = Object.keys(cfg).filter((k) => !ALLOWED_CONFIG_KEYS.has(k))
  if (extra.length) {
    fail([
      `knip.json містить ключі поза дозволеним списком: ${extra.join(', ')}.`,
      `Дозволені лише ${[...ALLOWED_CONFIG_KEYS].join(', ')}. Будь-що інше або приглушує`,
      `знахідки, або звужує область — знахідку записують у baseline з причиною, а не`,
      `ховають ключем, який більше ніхто не прочитає.`,
    ])
  }

  // A second config file is a second place to hide things.
  const others = OTHER_CONFIG_FILES.filter((f) => existsSync(path.join(ROOT, f)))
  if (others.length) {
    fail([
      `знайдено додаткові конфіги knip: ${others.join(', ')}.`,
      `Перевірка читає лише knip.json, тому будь-який інший конфіг — це невидима область.`,
    ])
  }
  try {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
    if (pkg && typeof pkg === 'object' && 'knip' in pkg) {
      fail([
        `package.json містить секцію "knip" — knip читає її, а ця перевірка ні.`,
        `Перенести налаштування у knip.json або прибрати.`,
      ])
    }
  } catch {
    /* package.json unreadable is the manifest owner's problem, not this check's */
  }

  // The globs themselves decide what knip can see, so they are part of the baseline: a
  // negation like "!src/zzdir/**" in `project` hid an entire orphan file with no knob key.
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({ entry: cfg.entry ?? null, project: cfg.project ?? null }))
    .digest('hex')
    .slice(0, 16)
  return { fingerprint }
}

/**
 * knip honours `@public` / `@internal` / `@alias` JSDoc tags by default, which removes an
 * export from the findings with no config change at all. Vendored shadcn files are exempt:
 * they are upstream text we do not edit.
 *
 * @returns {string[]}
 */
function taggedExports() {
  /** @type {string[]} */
  const hits = []
  const raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8')
  for (const rel of raw.split('\u0000').filter(Boolean)) {
    if (!/^(src|scripts|e2e)\/.*\.(ts|tsx|mjs)$/.test(rel)) continue
    if (rel.startsWith('src/components/ui/')) continue
    // This file documents the tag list, so it necessarily contains the tag names.
    if (rel === 'scripts/verify/ratchets/dead-exports.mjs') continue
    const text = readFileSync(path.join(ROOT, rel), 'utf8')
    text.split('\n').forEach((line, i) => {
      // Only a JSDoc line counts: prose in a `//` comment or a string is not a directive.
      if (/^\s*(?:\/\*\*|\*)/.test(line) && KNIP_TAGS.test(line)) {
        hits.push(`${rel}:${i + 1} ${line.trim().slice(0, 70)}`)
      }
    })
  }
  return hits
}

/** @returns {Finding[]} */
function knipFindings() {
  let raw
  try {
    raw = execFileSync('./node_modules/.bin/knip', ['--reporter', 'json'], {
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).toString('utf8')
  } catch (err) {
    // knip exits non-zero when it has findings; the JSON is still on stdout. Only a
    // genuinely empty stdout means it could not run.
    const e = /** @type {{stdout?: Buffer}} */ (err)
    raw = e.stdout?.toString('utf8') ?? ''
    if (!raw.trim()) {
      fail([`knip не запустився: ${err instanceof Error ? err.message : String(err)}`])
    }
  }
  /** @type {{issues: Record<string, any>[]}} */
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    fail(['knip повернув не-JSON — вивід зіпсований, тлумачити його як «нічого не знайдено» не можна'])
  }
  /** @type {Finding[]} */
  const out = []
  for (const issue of parsed.issues ?? []) {
    const file = issue.file
    for (const [arrayName, kind] of Object.entries(KINDS)) {
      const arr = issue[arrayName]
      if (!Array.isArray(arr)) continue
      for (const item of arr) {
        const name = typeof item === 'string' ? item : item?.name
        if (!name) continue
        out.push({ kind, file, name })
      }
    }
  }
  return out
}

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write(`deadcode: ЧЕРВОНО\n`)
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

function main() {
  const write = process.argv.includes('--write')
  const { fingerprint } = assertConfigIsClean()
  const tagged = taggedExports()

  const found = knipFindings()
  const foundByKey = new Map(found.map((f) => [keyOf(f), f]))

  /** @type {{createdAt: string, note: string, configFingerprint?: string, entries: (Finding & {reason: string})[]}} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    baseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    if (!write) {
      fail([`немає ${path.relative(ROOT, BASELINE)} — створіть його через --write і впишіть причини`])
    }
  }

  if (write) {
    const existing = new Map(baseline.entries.map((e) => [keyOf(e), e.reason]))
    const entries = found
      .map((f) => ({ ...f, reason: existing.get(keyOf(f)) ?? '' }))
      .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    writeFileSync(
      BASELINE,
      `${JSON.stringify({ ...baseline, configFingerprint: fingerprint, entries }, null, 2)}\n`,
    )
    const missing = entries.filter((e) => reasonProblem(e.reason)).length
    process.stdout.write(
      `deadcode: baseline перезаписано — ${entries.length} записів, ` +
        `${missing} без придатної причини\n`,
    )
    return
  }

  /** @type {string[]} */
  const problems = []

  // The globs are part of the exemption surface: narrowing `project` or adding a `!`
  // negation removes findings without touching any knob key.
  if (baseline.configFingerprint !== fingerprint) {
    problems.push(
      `ЗМІНИЛИСЯ ГЛОБИ: entry/project у knip.json відрізняються від зафіксованих у baseline ` +
        `(${baseline.configFingerprint ?? 'немає'} → ${fingerprint}). Звуження області — теж ` +
        `приглушення. Якщо зміна свідома, перезаписати baseline через --write і переглянути ` +
        `знахідки.`,
    )
  }

  // A `@public` tag removes an export from the findings with no config change at all.
  for (const t of tagged) {
    problems.push(
      `ТЕГ ПРИГЛУШЕННЯ: ${t} — knip шанує @public/@internal/@alias за замовчуванням, тобто ` +
        `цей експорт зникає зі знахідок без жодної зміни конфігу.`,
    )
  }

  // Direction 1: a new finding fails.
  const baselineKeys = new Set(baseline.entries.map(keyOf))
  for (const f of found) {
    if (!baselineKeys.has(keyOf(f))) {
      problems.push(`НОВА ЗНАХІДКА: ${f.kind} ${f.name} у ${f.file} — не в baseline.`)
    }
  }

  // Direction 2: a baseline entry that no longer reproduces also fails. Without this the
  // baseline only ever grows, and a fixed finding leaves a permanent licence behind.
  for (const e of baseline.entries) {
    if (!foundByKey.has(keyOf(e))) {
      problems.push(
        `ЗАСТАРІЛИЙ ЗАПИС: ${e.kind} ${e.name} у ${e.file} — knip його більше не бачить. ` +
          `Прибрати з baseline (храповик крутиться лише в один бік — тільки на зменшення).`,
      )
    }
  }

  // Direction 3: an entry nobody explained cannot pass.
  for (const e of baseline.entries) {
    const problem = reasonProblem(e.reason)
    if (problem) problems.push(`БЕЗ ПРИЧИНИ: ${e.kind} ${e.name} у ${e.file} — ${problem}.`)
  }

  if (problems.length) fail(problems)

  const byKind = /** @type {Record<string, number>} */ ({})
  for (const e of baseline.entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1
  const breakdown = Object.entries(byKind)
    .sort()
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ')
  process.stdout.write(
    `deadcode: ${found.length} знахідок, усі перелічені у baseline від ${baseline.createdAt} ` +
      `(${breakdown})\n`,
  )
  process.stdout.write(
    `deadcode: конфіг лише entry/project (fp ${fingerprint}), інших конфігів knip немає, ` +
      `тегів приглушення немає — знахідки видно, вони просто пояснені\n`,
  )
}

main()
