#!/usr/bin/env node
/**
 * Layer 1 — after each file edit, lint that one file. Advisory: it never blocks.
 *
 * Purpose is speed of feedback, not enforcement. The gate at `Stop` is the only thing
 * that decides whether a turn may end, so a finding here is information delivered early,
 * not a verdict.
 */
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()

/** oxlint only understands these. Editing a JSON or MD file is not a lint event. */
const LINTABLE = /\.(ts|tsx|js|jsx|mjs|cjs)$/

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
// NotebookEdit passes notebook_path rather than file_path, so keying only on the latter
// meant that matcher entry was dead configuration.
const filePath = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path

if (typeof filePath !== 'string' || !LINTABLE.test(filePath)) process.exit(0)

// A NUL byte makes spawnSync throw ERR_INVALID_ARG_VALUE; path.relative passes it through.
if (filePath.includes('\u0000')) process.exit(0)

// Keep the path inside the repo: a hook must not be steerable into linting /etc by a
// crafted tool_input. realpath FIRST — `path.relative` alone accepted a symlink inside the
// repo that pointed outside it, and oxlint happily followed the link and reported on the
// target's contents.
let rel
try {
  const real = realpathSync(path.resolve(ROOT, filePath))
  rel = path.relative(realpathSync(ROOT), real)
} catch {
  process.exit(0)
}
if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) process.exit(0)

const res = spawnSync('oxlint', ['--max-warnings=0', rel], {
  cwd: ROOT,
  encoding: 'utf8',
  timeout: 30_000,
  env: process.env,
})

if (res.error || res.status === null) {
  // Cannot lint is not the same as clean. Say so rather than staying silent.
  emit({
    systemMessage:
      `edit-lint: не вдалося запустити oxlint для ${rel} — цей файл не перевірено ` +
      `(${res.error ? res.error.message : 'таймаут'}).`,
  })
  process.exit(0)
}

if (res.status === 0) process.exit(0)

const detail = `${res.stdout ?? ''}${res.stderr ?? ''}`.trim()
emit({
  // No `decision` field: the documented PostToolUse values are "block" or absent, and
  // advisory output is carried entirely by additionalContext.
  additionalContext:
    `oxlint має зауваження до ${rel} (--max-warnings=0, тобто warn тут = error):\n\n${detail}\n\n` +
    `Це попередження, не блокування. Гейт наприкінці ходу все одно впаде на цьому, ` +
    `тому дешевше полагодити зараз.`,
})
process.exit(0)
