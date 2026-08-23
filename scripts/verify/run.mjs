#!/usr/bin/env node
/**
 * The runner. Thin on purpose — the registry holds the judgement, this holds the
 * mechanics: five statuses that never collapse into each other, a process-group-safe
 * timeout, a content-addressed report, and a footer that prints the blind spots whether
 * the run was green or red.
 *
 * Usage:
 *   node scripts/verify/run.mjs [--tier fast|full] [--no-skip] [--only a,b]
 *                               [--reuse-if-fresh] [--json] [--timeout-ms N]
 *
 * Exit codes: 0 = nothing blocking, 1 = something blocking (or the runner itself failed).
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { CHECKS, PRECONDITIONS, checkById, inTier, tierCovers } from './registry.mjs'
import { sourceHash, errMessage } from './hash.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const REPORT_DIR = path.join(ROOT, '.verify')
const REPORT_PATH = path.join(REPORT_DIR, 'last-run.json')
const REPORT_SCHEMA = 1

/**
 * Five statuses. Do not collapse them: reporting "lint FAILED" when the linter was
 * merely absent from PATH asserts something about the code that was never tested.
 */
const PASSED = 'PASSED'
const FAILED = 'FAILED'
const SKIPPED = 'SKIPPED'
const NOT_RUN = 'NOT_RUN'
const UNRUNNABLE = 'UNRUNNABLE'

/** @typedef {'PASSED'|'FAILED'|'SKIPPED'|'NOT_RUN'|'UNRUNNABLE'} Status */

const useColor =
  process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

/** @param {string} code @param {string} s @returns {string} */
const paint = (code, s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s)

/**
 * Glyph and word both differ per status, so the table stays unambiguous with colour
 * stripped — in a log file, a CI annotation or a hook's stderr.
 *
 * @type {Record<Status, { label: string, color: string }>}
 */
const DISPLAY = {
  PASSED: { label: '✓ PASSED    ', color: '32' },
  FAILED: { label: '✗ FAILED    ', color: '31' },
  SKIPPED: { label: '– SKIPPED   ', color: '33' },
  NOT_RUN: { label: '∅ NOT_RUN   ', color: '35' },
  UNRUNNABLE: { label: '! UNRUNNABLE', color: '91' },
}

/**
 * @param {Status} status
 * @param {boolean} noSkip
 * @returns {boolean}
 */
function isBlocking(status, noSkip) {
  if (status === PASSED) return false
  // A precondition that is genuinely absent is not evidence about the code. In the CI
  // form (--no-skip) there is no such excuse: the environment is supposed to provide it.
  if (status === SKIPPED) return noSkip
  return true
}

/** @param {string} msg @returns {never} */
function fatal(msg) {
  process.stderr.write(`verify: ${msg}\n`)
  process.exit(1)
}

/**
 * @typedef {object} Options
 * @property {'fast'|'full'} tier
 * @property {boolean} noSkip
 * @property {string[] | null} only
 * @property {boolean} reuseIfFresh
 * @property {boolean} json
 * @property {number} timeoutMs
 */

/**
 * Strict parsing: an unknown flag is an error, never a silent no-op. A typo in
 * `--no-skip` that quietly disabled it would be invisible for as long as nobody looked.
 *
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const o = {
    tier: 'fast',
    noSkip: false,
    only: null,
    reuseIfFresh: false,
    json: false,
    timeoutMs: 120_000,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    /** @returns {string} */
    const value = () => {
      const v = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1)
      if (v === undefined) fatal(`${name} needs a value`)
      return v
    }
    switch (name) {
      case '--tier': {
        const v = value()
        if (v !== 'fast' && v !== 'full') fatal(`--tier must be fast or full, got ${v}`)
        o.tier = v
        break
      }
      case '--no-skip':
        rejectValue(name, arg, eq)
        o.noSkip = true
        break
      case '--only':
        o.only = value()
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        break
      case '--reuse-if-fresh':
        rejectValue(name, arg, eq)
        o.reuseIfFresh = true
        break
      case '--json':
        rejectValue(name, arg, eq)
        o.json = true
        break
      case '--timeout-ms': {
        const n = Number(value())
        if (!Number.isFinite(n) || n <= 0) fatal(`--timeout-ms must be a positive number`)
        o.timeoutMs = n
        break
      }
      default:
        fatal(`unknown flag ${name}`)
    }
  }
  if (o.only) {
    const unknown = o.only.filter((id) => !checkById(id))
    if (unknown.length) fatal(`unknown check id(s): ${unknown.join(', ')}`)
  }
  return o
}

/**
 * A boolean flag given `=value` was accepted with the value ignored, so a templated
 * `--reuse-if-fresh=${REUSE}` with REUSE=false silently turned the gate into `exit 0`.
 *
 * @param {string} name
 * @param {string} arg
 * @param {number} eq
 * @returns {void}
 */
function rejectValue(name, arg, eq) {
  if (eq !== -1) fatal(`${name} — булевий прапорець, значення не приймає (отримано ${arg})`)
}

/** @returns {string} */
function gitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).toString().trim()
  } catch {
    return 'unknown'
  }
}

/**
 * @typedef {object} RunOutcome
 * @property {'exited'|'timeout'|'spawn-error'} outcome
 * @property {number | null} code
 * @property {string} out
 * @property {string} err
 * @property {number} ms
 */

/**
 * @param {import('node:child_process').ChildProcess} child
 * @returns {void}
 */
function killGroup(child) {
  const pid = child.pid
  if (typeof pid !== 'number') return
  // `detached: true` gave the shell its own process group, so the negative pid reaches
  // every descendant. Killing only the shell is the trap that records "timed out after
  // 120s" at 902s, with the leaf process's successful output still attached.
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    /* group already gone */
  }
  const hard = setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* already reaped */
    }
  }, 2000)
  hard.unref()
}

/**
 * @param {string} cmd
 * @param {number} timeoutMs
 * @returns {Promise<RunOutcome>}
 */
function runCommand(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now()
    /** @type {import('node:child_process').ChildProcess} */
    let child
    try {
      child = spawn(cmd, {
        cwd: ROOT,
        shell: '/bin/sh',
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: process.env,
      })
    } catch (err) {
      resolve({ outcome: 'spawn-error', code: null, out: '', err: errMessage(err), ms: 0 })
      return
    }
    // Without setEncoding, a multi-byte character split across two data events becomes
    // U+FFFD, so the text a human reads to diagnose a failure was corruptible.
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    let out = ''
    let errOut = ''
    let timedOut = false
    let settled = false
    child.stdout?.on('data', (d) => {
      out += d
    })
    child.stderr?.on('data', (d) => {
      errOut += d
    })
    const timer = setTimeout(() => {
      timedOut = true
      killGroup(child)
    }, timeoutMs)
    /** @param {RunOutcome} res */
    const finish = (res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(res)
    }
    child.on('error', (err) =>
      finish({
        outcome: 'spawn-error',
        code: null,
        out,
        err: errMessage(err),
        ms: Date.now() - started,
      }),
    )
    child.on('close', (code) =>
      finish({
        outcome: timedOut ? 'timeout' : 'exited',
        code,
        out,
        err: errOut,
        ms: Date.now() - started,
      }),
    )
  })
}

/**
 * The shell's own "I could not start this" signals, kept deliberately narrow. A loose
 * pattern here would relabel a real FAILED as UNRUNNABLE, which is the quieter and
 * therefore worse direction to be wrong in.
 */
const SHELL_CANNOT_START = /(?:^|\n)(?:\/bin\/)?sh: (?:\d+: )?[^\n]*(?:command )?not found/
const NPM_MISSING_SCRIPT = /npm (?:ERR!|error) Missing script/i
/**
 * Node's own "I could not load the entry point". Five of the eleven checks are
 * `node <file>`, and a renamed or mis-merged script made them exit 1 — which was reported
 * as FAILED, i.e. a claim about code that never ran. Exactly what UNRUNNABLE is for.
 */
const NODE_CANNOT_LOAD =
  /\b(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find module|Cannot find package)\b/

/**
 * @param {RunOutcome} res
 * @returns {Status}
 */
function classify(res) {
  if (res.outcome === 'spawn-error') return UNRUNNABLE
  // A timeout did start, so it is not UNRUNNABLE. It ran and did not succeed: FAILED.
  if (res.outcome === 'timeout') return FAILED
  if (res.code === 0) return PASSED
  if (res.code === 127 || res.code === 126) return UNRUNNABLE
  const text = `${res.out}\n${res.err}`
  if (SHELL_CANNOT_START.test(text) || NPM_MISSING_SCRIPT.test(text)) return UNRUNNABLE
  if (NODE_CANNOT_LOAD.test(text)) return UNRUNNABLE
  return FAILED
}

/**
 * @param {Options} opts
 * @returns {import('./registry.mjs').Check[]}
 */
function selectChecks(opts) {
  const inScope = CHECKS.filter((c) => inTier(c.tier, opts.tier))
  if (!opts.only) return inScope
  const wanted = new Set(opts.only)
  // A --only run deliberately does NOT pull in `after` dependencies. Doing so silently
  // would make `--only smoke` a full build too; instead the report records that the
  // dependencies were not evaluated, so this green cannot be read as a wider verdict.
  return CHECKS.filter((c) => wanted.has(c.id))
}

/**
 * @param {string} hash
 * @param {Options} opts
 * @returns {boolean} true when a stored green verdict genuinely covers this request
 */
function reportIsFresh(hash, opts) {
  let stored
  try {
    stored = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
  } catch {
    return false
  }
  if (stored?.schema !== REPORT_SCHEMA) return false
  if (stored.sourceHash !== hash) return false
  if (stored.ok !== true) return false
  // A green recorded at `fast` says nothing about `full`.
  if (!tierCovers(stored.tier, opts.tier)) return false
  // A green from a one-check run is not a verdict on the tree.
  if (stored.scope?.only) return false
  // A green that tolerated skips cannot satisfy a request that does not.
  if (opts.noSkip && stored.noSkip !== true) return false
  // A green measured against different coverage floors is a different verdict.
  if (stored.envKey !== envKey()) return false
  // A green whose `after` dependencies were never evaluated is not a tree verdict.
  if (stored.scope?.afterDepsFullyEvaluated !== true) return false
  return true
}

/**
 * Environment inputs that change what a check CONCLUDES. The coverage floors live only in
 * the environment by design, so two runs with the same sourceHash and different floors are
 * genuinely different verdicts — and reuse must not treat them as one.
 *
 * @returns {string}
 */
function envKey() {
  const names = Object.keys(process.env)
    .filter((k) => /^COVERAGE_/.test(k))
    .sort()
  return names.map((k) => `${k}=${process.env[k]}`).join('\u0000')
}

/** @param {number} ms @returns {string} */
const dur = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  let hash
  let hashedFileCount
  try {
    const h = sourceHash(ROOT)
    hash = h.hash
    hashedFileCount = h.fileCount
  } catch (err) {
    fatal(`could not compute sourceHash: ${errMessage(err)}`)
  }

  if (opts.reuseIfFresh && reportIsFresh(hash, opts)) {
    // Reuse is quiet, but not silent about what the reused verdict does NOT cover: the
    // blind-spot footer is the whole point, and skipping it on the hot path (the gate uses
    // --reuse-if-fresh --json) meant it printed on neither path production takes.
    if (!opts.json) {
      try {
        const stored = JSON.parse(readFileSync(REPORT_PATH, 'utf8'))
        printBlindSpots(stored, `перевикористано зелений звіт для ${hash.slice(0, 12)}`)
      } catch {
        /* the report was readable a moment ago in reportIsFresh; nothing to add */
      }
    }
    process.exit(0)
  }

  const selected = selectChecks(opts)
  if (selected.length === 0) fatal('no checks selected — refusing to report a green')

  const started = new Date()
  /** @type {Map<string, Status>} */
  const statusById = new Map()
  /** @type {{id:string,status:Status,blocking:boolean,ms:number,exitCode:number|null,reason:string|null,proves:string,blindSpot:string}[]} */
  const rows = []
  const selectedIds = new Set(selected.map((c) => c.id))
  let afterDepsFullyEvaluated = true
  /** @type {{id:string,text:string}[]} */
  const failureDetail = []
  /** @type {{id:string,text:string}[]} */
  const warnings = []

  for (const check of selected) {
    /** @type {Status} */
    let status
    /** @type {string | null} */
    let reason = null
    let ms = 0
    /** @type {number | null} */
    let exitCode = null

    const unmetDeps = (check.after ?? []).filter((dep) => {
      if (!selectedIds.has(dep)) {
        afterDepsFullyEvaluated = false
        return false
      }
      return statusById.get(dep) !== PASSED
    })

    if (unmetDeps.length) {
      status = NOT_RUN
      reason = `залежність не пройшла: ${unmetDeps.join(', ')} — перевірку не запускали`
    } else if (check.needs) {
      const pre = PRECONDITIONS[check.needs]
      const present = pre ? await pre.probe() : false
      if (!present) {
        status = SKIPPED
        reason = pre ? pre.describe : `невідома передумова ${check.needs}`
      } else {
        const res = await runCommand(check.cmd, opts.timeoutMs)
        status = classify(res)
        ms = res.ms
        exitCode = res.code
        if (res.outcome === 'timeout') reason = `таймаут ${dur(opts.timeoutMs)}`
        if (status !== PASSED) failureDetail.push({ id: check.id, text: tailOf(res) })
        warnings.push(...warningLines(check.id, res))
      }
    } else {
      const res = await runCommand(check.cmd, opts.timeoutMs)
      status = classify(res)
      ms = res.ms
      exitCode = res.code
      if (res.outcome === 'timeout') reason = `таймаут ${dur(opts.timeoutMs)}`
      if (status === UNRUNNABLE) {
        reason = 'команду не вдалося запустити (не знайдено у PATH / немає скрипта)'
      }
      if (status !== PASSED) failureDetail.push({ id: check.id, text: tailOf(res) })
      warnings.push(...warningLines(check.id, res))
    }

    statusById.set(check.id, status)
    rows.push({
      id: check.id,
      status,
      // The cause stays in `status`; the consequence lives in `blocking`. Keeping both
      // means the CI table can be unambiguous without collapsing five states into two.
      blocking: isBlocking(status, opts.noSkip),
      ms,
      exitCode,
      reason,
      proves: check.proves,
      blindSpot: check.blindSpot,
    })
  }

  const blocking = rows.filter((r) => isBlocking(/** @type {Status} */ (r.status), opts.noSkip))
  const ok = blocking.length === 0

  const report = {
    schema: REPORT_SCHEMA,
    timestamp: started.toISOString(),
    head: gitHead(),
    tier: opts.tier,
    noSkip: opts.noSkip,
    timeoutMs: opts.timeoutMs,
    // Scope travels with the verdict so a narrow green cannot be quoted as a wide one.
    scope: {
      only: opts.only,
      checkIds: selected.map((c) => c.id),
      afterDepsFullyEvaluated,
      argv: process.argv.slice(2),
    },
    sourceHash: hash,
    hashedFileCount,
    envKey: envKey(),
    ok,
    warnings,
    checks: rows,
  }

  try {
    mkdirSync(REPORT_DIR, { recursive: true })
    // Write-then-rename: two concurrent runners would otherwise interleave, and a reader
    // catching a partial write gets truncated JSON.
    const tmp = `${REPORT_PATH}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`)
    renameSync(tmp, REPORT_PATH)
  } catch (err) {
    process.stderr.write(`verify: could not write ${REPORT_PATH}: ${errMessage(err)}\n`)
  }

  if (opts.json) {
    // The report itself carries proves/blindSpot per row, so a JSON consumer has the
    // footer's content; it is emitted as data rather than prose.
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    process.exitCode = ok ? 0 : 1
    return
  }

  printTable(report, failureDetail)
  // exitCode rather than exit(): process.exit can truncate a large asynchronous pipe write.
  process.exitCode = ok ? 0 : 1
}

/**
 * A check that PASSES can still have found something worth saying — `ratchet:persist`
 * announcing that no runtime narrowing exists at all, `test:files` announcing that
 * playwright collects nothing so the `smoke` row verifies nothing, vite's 500 kB warning.
 * Discarding a passing check's stdout threw all of that away: the same failure as a skip
 * reading like a pass, one level down.
 *
 * @param {string} id
 * @param {RunOutcome} res
 * @returns {{id: string, text: string}[]}
 */
function warningLines(id, res) {
  return `${res.out}\n${res.err}`
    .split('\n')
    .filter((l) => /УВАГА|WARNING|\(!\)/.test(l))
    // The checks prefix their own id, so strip it rather than printing it twice.
    .map((l) => ({ id, text: l.trim().replace(new RegExp(`^${id}:\\s*`), '') }))
    .slice(0, 20)
}

/** @param {RunOutcome} res @returns {string} */
function tailOf(res) {
  const text = `${res.out}${res.err}`.trimEnd()
  const lines = text.split('\n')
  return lines.slice(-25).join('\n')
}

/**
 * @param {ReturnType<typeof JSON.parse>} report
 * @param {{id:string,text:string}[]} failureDetail
 * @returns {void}
 */
function printTable(report, failureDetail) {
  const w = Math.max(...report.checks.map((/** @type {{id:string}} */ c) => c.id.length))
  const scopeNote = report.scope.only
    ? `--only ${report.scope.only.join(',')}`
    : `tier ${report.tier}`
  process.stdout.write(
    `\nverify · ${scopeNote}${report.noSkip ? ' · --no-skip' : ''} · ` +
      `HEAD ${report.head.slice(0, 8)} · sourceHash ${report.sourceHash.slice(0, 12)} ` +
      `(${report.hashedFileCount} файлів)\n\n`,
  )

  for (const c of report.checks) {
    // The glyph keeps the STATUS; a separate marker carries the CONSEQUENCE. Painting a
    // blocking row as FAILED made DISPLAY.NOT_RUN and DISPLAY.UNRUNNABLE unreachable, so
    // the column collapsed five states into two — precisely what must never happen here.
    const d = DISPLAY[/** @type {Status} */ (c.status)]
    // ⛔ marks "this blocks the run"; SKIPPED only earns it under --no-skip.
    const mark = c.blocking ? paint('31', '⛔') : '  '
    const time = c.ms ? `  ${dur(c.ms)}` : ''
    process.stdout.write(`  ${mark} ${paint(d.color, d.label)}  ${c.id.padEnd(w)}${time}\n`)
    // Only SKIPPED's blocking-ness depends on the flag. NOT_RUN and UNRUNNABLE block
    // always, so blaming --no-skip for them would misattribute the cause.
    const note =
      c.blocking && c.status === SKIPPED
        ? `падіння у формі --no-skip${c.reason ? `: ${c.reason}` : ''}`
        : c.reason
    if (note) process.stdout.write(`  ${' '.repeat(17)}  ${paint('90', note)}\n`)
  }

  const counts = /** @type {Record<string, number>} */ ({})
  for (const c of report.checks) counts[c.status] = (counts[c.status] ?? 0) + 1
  const blockingCount = report.checks.filter((/** @type {{blocking:boolean}} */ c) => c.blocking).length
  const summary = Object.entries(counts)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ')
  process.stdout.write(
    `\n  ${summary}${blockingCount ? paint('31', ` · ⛔ ${blockingCount} блокує`) : ''}\n`,
  )

  if (Array.isArray(report.warnings) && report.warnings.length) {
    process.stdout.write(
      paint('33', `\n  Попередження від перевірок (у т.ч. тих, що ПРОЙШЛИ)\n`),
    )
    for (const wn of report.warnings) {
      process.stdout.write(`    ${paint('33', wn.id)}: ${wn.text}\n`)
    }
  }

  const skipped = report.checks.filter((/** @type {{status:string}} */ c) => c.status === SKIPPED)
  if (skipped.length) {
    // Said out loud, never folded into "all green".
    process.stdout.write(
      paint(
        '33',
        `\n  УВАГА: ${skipped.length} перевірку(и) пропущено — ` +
          `${skipped.map((/** @type {{id:string}} */ c) => c.id).join(', ')}. ` +
          `Це НЕ «все зелено»: про це нічого не перевірено.\n`,
      ),
    )
  }
  if (report.scope.only) {
    process.stdout.write(
      paint(
        '33',
        `\n  ОБЛАСТЬ: запуск обмежений (${report.scope.only.join(', ')}). ` +
          `Зелений тут — вердикт лише про ці перевірки, не про дерево.\n`,
      ),
    )
  }
  // Hoisted out of the --only branch: an `after` target in a higher tier would produce
  // afterDepsFullyEvaluated=false on a plain `npm run verify`, printed nowhere.
  if (report.scope.afterDepsFullyEvaluated !== true) {
    process.stdout.write(
      paint(
        '33',
        `\n  УВАГА: залежності after не оцінювалися в цьому запуску — рядки, що від них ` +
          `залежать, зелені без підтвердження своєї передумови.\n`,
      ),
    )
  }

  for (const f of failureDetail) {
    process.stdout.write(paint('31', `\n  ── ${f.id} ─────────────────────────────\n`))
    process.stdout.write(
      f.text
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n') + '\n',
    )
  }

  printBlindSpots(report, null)
}

/**
 * The footer prints on green as well as red — a table of passes without its blind spots is
 * precisely the false-confidence artifact this layer exists to remove. It is a separate
 * function because the two paths production actually uses (`--reuse-if-fresh` and `--json`)
 * both returned before reaching it, so the property held of this code and not of the layer.
 *
 * @param {ReturnType<typeof JSON.parse>} report
 * @param {string | null} note  set when the verdict was reused rather than recomputed
 * @returns {void}
 */
function printBlindSpots(report, note) {
  if (note) process.stdout.write(paint('90', `\n  ${note}\n`))
  process.stdout.write(paint('1', '\n  Чого це НЕ доводить\n'))
  for (const c of report.checks) {
    process.stdout.write(`\n  ${c.id}\n`)
    process.stdout.write(`${wrap(c.blindSpot, 4, 92)}\n`)
  }
  if (Array.isArray(report.warnings) && report.warnings.length && note) {
    process.stdout.write(paint('33', `\n  Попередження з того запуску\n`))
    for (const wn of report.warnings) process.stdout.write(`    ${wn.id}: ${wn.text}\n`)
  }
  process.stdout.write(paint('90', `\n  Звіт: .verify/last-run.json · ok=${report.ok}\n\n`))
}

/**
 * @param {string} text
 * @param {number} indent
 * @param {number} width
 * @returns {string}
 */
function wrap(text, indent, width) {
  const pad = ' '.repeat(indent)
  /** @type {string[]} */
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length + indent > width) {
      lines.push(pad + line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(pad + line)
  return lines.join('\n')
}

main().catch((err) => {
  // The runner failing is not the same as the tree being red, and must never be
  // presentable as green.
  process.stderr.write(`verify: runner error: ${errMessage(err)}\n`)
  process.exit(1)
})
