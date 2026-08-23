#!/usr/bin/env node
/**
 * Layer 2 — project-wide type-check, filtered to the files this turn modified. Advisory.
 *
 * ADAPTATION, stated rather than hidden: Claude Code has no "tool batch end" event. The
 * events are PreToolUse, PostToolUse, UserPromptSubmit, Notification, Stop, SubagentStop,
 * PreCompact, SessionStart, SessionEnd. So this runs on PostToolUse with a cooldown, which
 * approximates a batch boundary — it is not one. `tsc -b` takes ~2s here, so a per-edit
 * run would be affordable but noisy; the cooldown keeps it to roughly one run per batch.
 *
 * The modified-file list comes from NUL-delimited git output. Parsing git's default quoted
 * paths would break on any name with a space or a non-ASCII character, producing a filter
 * that matches nothing: tsc reports the error, the hook reports nothing, and the result
 * reads green.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const COOLDOWN_MS = 20_000
const STAMP = path.join(ROOT, '.verify', 'batch-typecheck.stamp')
const LOCK = path.join(ROOT, '.verify', 'batch-typecheck.lock')

let emitted = false

/** @param {Record<string, unknown>} obj @returns {void} */
function emit(obj) {
  // Exactly ONE object may reach stdout: a second would corrupt the protocol and silently
  // lose the decision (reachable when a write throws EPIPE after the first emit).
  if (emitted) return
  // node.sh cannot reach Claude with a warning of its own — stderr on a zero exit goes to
  // the debug log only — so it hands the text over in the environment and we carry it.
  const warn = process.env.VERIFY_HOOK_WARN
  const withWarn = warn
    ? { ...obj, systemMessage: `${warn}\n${obj.systemMessage ?? ''}`.trim() }
    : obj
  const text = JSON.stringify(withWarn)
  JSON.parse(text)
  emitted = true
  process.stdout.write(`${text}\n`)
}

/** @returns {Promise<Record<string, any>>} */
function readInput() {
  return new Promise((resolve) => {
    let raw = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => {
      raw += c
    })
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    setTimeout(() => resolve({}), 5000).unref()
  })
}

const input = await readInput()
const tool = input?.tool_name
if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit' && tool !== 'NotebookEdit') {
  process.exit(0)
}

// --- cooldown ---------------------------------------------------------------------
const now = Date.now()
try {
  const last = Number.parseInt(readFileSync(STAMP, 'utf8').trim(), 10)
  if (Number.isFinite(last) && now - last < COOLDOWN_MS) process.exit(0)
} catch {
  /* no stamp yet — run */
}
// Claim the slot ATOMICALLY. Read-then-write let concurrent PostToolUse hooks both pass the
// cooldown, and all three tsconfig projects share tsBuildInfoFile under node_modules/.tmp —
// two simultaneous `tsc -b` runs can leave a corrupt build-info, not just burn CPU.
try {
  mkdirSync(path.dirname(STAMP), { recursive: true })
  writeFileSync(LOCK, String(process.pid), { flag: 'wx' })
} catch {
  process.exit(0)
}
try {
  writeFileSync(STAMP, String(now))
} finally {
  try {
    rmSync(LOCK, { force: true })
  } catch {
    /* the next run's wx will fail and simply skip; a stale lock costs a skipped check */
  }
}

// --- which files did this turn touch? ---------------------------------------------
/** @returns {Set<string>} */
function modifiedFiles() {
  /** @type {Set<string>} */
  const out = new Set()
  // -z gives NUL-delimited, unquoted paths. Without it a path with a space or Cyrillic
  // characters comes back quoted and every comparison below silently misses.
  const res = spawnSync('git', ['status', '--porcelain', '-z', '--untracked-files=all'], {
    cwd: ROOT,
    encoding: 'buffer',
    timeout: 15_000,
  })
  if (res.status !== 0 || !res.stdout) return out
  const fields = res.stdout.toString('utf8').split('\u0000').filter(Boolean)
  // Porcelain v1 -z: each entry is "XY <path>"; a rename/copy adds ONE extra field holding
  // the original path with no status prefix. Slicing 3 characters off that bare field
  // mangled any path whose third character happened to be a space.
  let expectBarePath = false
  for (const field of fields) {
    if (expectBarePath) {
      expectBarePath = false
      if (/\.(ts|tsx)$/.test(field)) out.add(field)
      continue
    }
    const status = field.slice(0, 2)
    const p = field.slice(3)
    if (/[RC]/.test(status)) expectBarePath = true
    if (/\.(ts|tsx)$/.test(p)) out.add(p)
  }
  return out
}

const touched = modifiedFiles()

const res = spawnSync('npm', ['run', '--silent', 'typecheck'], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 120_000,
  env: process.env,
})

if (res.error || res.status === null) {
  emit({
    systemMessage:
      `batch-typecheck: не вдалося запустити tsc — типи цього ходу НЕ перевірено ` +
      `(${res.error ? res.error.message : 'таймаут'}).`,
  })
  process.exit(0)
}

if (res.status === 0) process.exit(0)

const all = `${res.stdout ?? ''}${res.stderr ?? ''}`
  .split('\n')
  .filter((l) => /\.tsx?\(\d+,\d+\): error TS/.test(l))

const mine = all.filter((l) => {
  const file = l.split('(')[0].trim()
  const rel = path.relative(ROOT, path.resolve(ROOT, file))
  return touched.has(rel)
})

// If the only errors are in files this turn did not touch, say that instead of blaming
// the turn for them — but never claim the tree is clean.
const shown = mine.length ? mine : all
const scopeNote = mine.length
  ? `${mine.length} з ${all.length} помилок — у файлах, змінених цього ходу.`
  : `Жодна з ${all.length} помилок не у файлах цього ходу; дерево вже було червоним.`

emit({
  // No `decision`: documented PostToolUse values are "block" or absent, and this is advisory.
  additionalContext:
    `tsc -b червоний. ${scopeNote}\n\n${shown.slice(0, 30).join('\n')}\n\n` +
    `Це попередження, не блокування — але гейт наприкінці ходу впаде на цьому.`,
})
process.exit(0)
