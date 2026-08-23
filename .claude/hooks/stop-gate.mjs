#!/usr/bin/env node
/**
 * The gate. Runs on `Stop` — the only blocking layer of the three.
 *
 * Field names verified 2026-08-23 against code.claude.com/docs/en/hooks, reading the
 * Stop section rather than the generic table:
 *
 *  - The Stop section documents the decision at `hookSpecificOutput.decision: "block"`.
 *    No `reason` field is documented there.
 *  - The exit-code table says exit 2 "Blocks the action regardless of JSON" and "stderr
 *    becomes the blocking reason", and that universal fields like `systemMessage` are
 *    still read on exit 2.
 *
 * So exit 2 with the reason on stderr is the load-bearing mechanism, and the JSON carries
 * both the documented shape AND the older top-level `decision`/`reason` pair. Emitting one
 * shape and hoping is how a gate runs on every turn, writes its counter files, and blocks
 * nothing — invisible for hours.
 *
 * Policy:
 *  - fails CLOSED on check failures;
 *  - fails OPEN on its own errors, and loudly — never a bare `|| exit 0`;
 *  - caps consecutive blocks at 2 per `prompt_id`, then lets the turn end while telling
 *    the agent to state the red result explicitly.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.env.CLAUDE_PROJECT_DIR ?? process.cwd()
const COUNTER_DIR = path.join(ROOT, '.verify', 'gate-counter')
const MAX_BLOCKS = 2

/** @param {unknown} e @returns {string} */
const msg = (e) => (e instanceof Error ? e.message : String(e))

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

/**
 * A `prompt_id` arrives as untrusted JSON. Used unsanitised as a path component, a value
 * containing `..` would truncate an arbitrary file.
 *
 * @param {unknown} raw
 * @returns {string | null}
 */
function safeId(raw) {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/[^A-Za-z0-9_-]/g, '')
  if (!clean || clean.length > 64) return null
  return clean
}

/** @returns {Promise<Record<string, unknown>>} */
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
    // A hook with no stdin must not hang the turn until the harness timeout. But a SLOW
    // stdin must not be mistaken for an EMPTY one: that silently drops prompt_id and
    // turns a block into a non-block. The sentinel says which case happened.
    setTimeout(() => resolve({ __verifyStdinTimedOut: true }), 5000).unref()
  })
}

/**
 * @param {string} id
 * @returns {{ count: number, bump: () => boolean, reset: () => void }}
 */
function counter(id) {
  const file = path.join(COUNTER_DIR, `${id}.count`)
  let count = 0
  try {
    count = Number.parseInt(readFileSync(file, 'utf8').trim(), 10)
    if (!Number.isFinite(count) || count < 0) count = 0
  } catch {
    count = 0
  }
  return {
    count,
    // Returns false when the write failed. Silence there disables the cap entirely and
    // deadlocks the agent against the gate, so the caller says so out loud.
    bump: () => {
      try {
        mkdirSync(COUNTER_DIR, { recursive: true })
        // One file per prompt_id would otherwise accumulate forever.
        try {
          const cutoff = Date.now() - 24 * 60 * 60 * 1000
          for (const f of readdirSync(COUNTER_DIR)) {
            const p = path.join(COUNTER_DIR, f)
            if (statSync(p).mtimeMs < cutoff) rmSync(p, { force: true })
          }
        } catch {
          /* pruning is housekeeping; never let it affect the decision */
        }
        writeFileSync(file, String(count + 1))
        return true
      } catch {
        return false
      }
    },
    reset: () => {
      try {
        mkdirSync(COUNTER_DIR, { recursive: true })
        writeFileSync(file, '0')
      } catch {
        /* a failed reset only costs a stricter cap next turn */
      }
    },
  }
}

/**
 * SKIPPED rows from a green run. Reads the fresh report from disk when stdout was empty,
 * which is what `--reuse-if-fresh` does on a cache hit.
 *
 * @param {string | undefined} stdout
 * @returns {string[]}
 */
function skippedRows(stdout) {
  /** @type {any} */
  let report
  try {
    report = JSON.parse(stdout || '')
  } catch {
    try {
      report = JSON.parse(readFileSync(path.join(ROOT, '.verify', 'last-run.json'), 'utf8'))
    } catch {
      return []
    }
  }
  if (!Array.isArray(report?.checks)) return []
  return report.checks
    .filter((/** @type {any} */ r) => r.status === 'SKIPPED')
    .map((/** @type {any} */ r) => String(r.id))
}

/**
 * I7: a byte cap, not just a line cap. One failing check can emit a single 65KB JSON line,
 * and `detail` is repeated in several fields — a 361KB payload was measured in review.
 *
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function capped(text, max = 4000) {
  return text.length <= max ? text : `…(обрізано)\n${text.slice(-max)}`
}

/** @param {Record<string, unknown>} report @returns {string} */
function failureTable(report) {
  const rows = Array.isArray(report.checks) ? report.checks : []
  const bad = rows.filter((/** @type {any} */ r) => r.status !== 'PASSED')
  const lines = bad.map(
    (/** @type {any} */ r) =>
      `  ${String(r.status).padEnd(11)} ${r.id}${r.reason ? ` — ${r.reason}` : ''}`,
  )
  const skipped = rows.filter((/** @type {any} */ r) => r.status === 'SKIPPED').length
  return [
    `Швидкий рівень перевірок ЧЕРВОНИЙ — хід не можна завершувати заявою про успіх.`,
    ``,
    ...lines,
    ``,
    `Повний вивід: npm run verify`,
    `Звіт: .verify/last-run.json (sourceHash ${String(report.sourceHash ?? '?').slice(0, 12)})`,
    skipped
      ? `\nУВАГА: ${skipped} перевірку(и) пропущено — це не «все зелено».`
      : ``,
    ``,
    `Полагодити причину, а не перевірку. Розширити baseline, послабити правило чи знизити`,
    `поріг — це не позеленіти (див. CLAUDE.md, правило 3).`,
  ]
    .filter((l) => l !== undefined)
    .join('\n')
}

async function main() {
  const input = await readInput()

  // I5: could not read the harness's input at all → could not evaluate. Taking the
  // no-id branch here would report "no prompt_id" and quietly let a red turn end.
  if (input.__verifyStdinTimedOut) {
    process.stderr.write('verify-gate: не дочитав stdin за 5с — хід НЕ оцінено\n')
    emit({
      systemMessage:
        'verify-gate: НЕ ЗМІГ ОЦІНИТИ цей хід — вхідний JSON від harness не дочитано за 5с. ' +
        'Це не зелений результат: вважати хід НЕПЕРЕВІРЕНИМ і сказати про це прямо.',
    })
    process.exit(0)
  }
  // C3: NEVER fall back to session_id. It is stable across turns while reset() only runs
  // on a green, so on a persistently red tree the count saturates in turn 1 and every
  // later turn sails through — the gate runs, writes its counter, and blocks nothing.
  // No prompt_id means no cap is possible, which the no-id branch below handles honestly.
  const id = safeId(input.prompt_id)

  const run = spawnSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'verify', 'run.mjs'), '--tier', 'fast', '--reuse-if-fresh', '--json'],
    { cwd: ROOT, encoding: 'utf8', timeout: 240_000, env: process.env },
  )

  // --- the gate's own failure: open, and loud -------------------------------------
  if (run.error || run.status === null) {
    const why = run.error ? msg(run.error) : 'процес перевірок не завершився (можливо таймаут)'
    process.stderr.write(`verify-gate: не вдалося оцінити хід: ${why}\n`)
    emit({
      systemMessage:
        `verify-gate: НЕ ЗМІГ ОЦІНИТИ цей хід (${why}). ` +
        `Вважати хід НЕПЕРЕВІРЕНИМ і сказати про це прямо — це не зелений результат.`,
      additionalContext:
        `Гейт перевірок не спрацював: ${why}. Не заявляй успіх. Запусти "npm run verify" ` +
        `вручну і повідом справжній результат.`,
    })
    process.exit(0)
  }

  // --reuse-if-fresh exits 0 with no output when a green verdict already covers this
  // exact sourceHash.
  //
  // But exit 0 is NOT the same as "everything was verified": SKIPPED does not block
  // without --no-skip, so a green can legitimately contain rows that checked nothing. The
  // runner says so in its own footer; the gate must not swallow that. Today no fast-tier
  // check declares a precondition, so this cannot fire — it is here so that adding one
  // later cannot turn a skip into a silent pass.
  if (run.status === 0) {
    if (id) counter(id).reset()
    const skipped = skippedRows(run.stdout)
    if (skipped.length) {
      emit({
        systemMessage:
          `verify-gate: швидкий рівень зелений, АЛЕ ${skipped.length} перевірку(и) ` +
          `пропущено — ${skipped.join(', ')}. Це не «все зелено»: про ці рядки не ` +
          `перевірено нічого, і це треба сказати вголос у відповіді.`,
      })
    }
    process.exit(0)
  }

  /** @type {Record<string, unknown>} */
  let report = {}
  try {
    report = JSON.parse(run.stdout || '{}')
  } catch {
    report = {}
  }

  // No parseable verdict means the runner never reached the end — a MODULE_NOT_FOUND, a
  // bad flag, a hashing failure. That is the GATE's problem, not the code's, and blocking
  // on it would assert something about the tree that was never tested. It is the same sin
  // as reporting "lint FAILED" for a missing linter, one level up. Fail open, loudly.
  if (!Array.isArray(report.checks)) {
    const tail = capped((run.stderr || run.stdout || '').trim().split('\n').slice(-12).join('\n'))
    process.stderr.write(`verify-gate: перевірки не дали читабельного звіту (код ${run.status})\n${tail}\n`)
    emit({
      systemMessage:
        `verify-gate: НЕ ЗМІГ ОЦІНИТИ цей хід — раннер вийшов з кодом ${run.status} без ` +
        `звіту. Це не червоне дерево і не зелене: хід НЕПЕРЕВІРЕНИЙ.`,
      additionalContext:
        `Гейт не отримав звіту від scripts/verify/run.mjs (код ${run.status}). Не заявляй ` +
        `успіх і не роби висновку, що перевірки червоні — вони не запускалися до кінця. ` +
        `Запусти "npm run verify" вручну.\n\n${tail}`,
    })
    process.exit(0)
  }

  const detail = failureTable(report)

  // --- loop guard -----------------------------------------------------------------
  if (!id) {
    // No usable id means no cap is possible. Blocking without a cap can deadlock the
    // agent against the gate, so this reports and lets the turn end.
    process.stderr.write('verify-gate: у вході немає prompt_id/session_id — лічильник неможливий\n')
    emit({
      systemMessage:
        'verify-gate: перевірки ЧЕРВОНІ, але без prompt_id лічильник блокувань неможливий, ' +
        'тому хід не блокується. Червоний результат треба озвучити явно:\n\n' + capped(detail),
      additionalContext: capped(detail),
    })
    process.exit(0)
  }

  const c = counter(id)
  if (c.count >= MAX_BLOCKS) {
    // The instruction goes in systemMessage, which the docs describe as "shown to Claude,
    // not the user". additionalContext is documented only for PostToolUse /
    // UserPromptSubmit / UserPromptExpansion — NOT for Stop — so the whole payoff of the
    // cap-release path would have had no documented delivery channel. It is kept as a
    // harmless second copy for versions that do read it.
    const instruction =
      `verify-gate: вже ${c.count} блокування на цьому ході — ліміт ${MAX_BLOCKS} ` +
      `досягнуто, гейт більше не блокує, і хід завершується НЕПЕРЕВІРЕНИМ.\n\n` +
      `${capped(detail)}\n\n` +
      `ОБОВʼЯЗКОВО почни відповідь із прямої констатації: перевірки червоні, ось які саме, ` +
      `і що залишилося зробити. Не описуй роботу як завершену.`
    emit({ systemMessage: instruction, additionalContext: instruction })
    process.exit(0)
  }

  // C2: if the counter cannot be written, the cap can never be reached — blocking anyway
  // is an unbounded block, i.e. a deadlock between the gate and the agent. Being loud
  // about it does not stop the deadlock, so this reports instead of blocking.
  if (!c.bump()) {
    process.stderr.write('verify-gate: не вдалося записати лічильник блокувань — не блокую\n')
    emit({
      systemMessage:
        'verify-gate: перевірки ЧЕРВОНІ, але лічильник блокувань не записується (' +
        'права на .verify/ ?), тому обмеження на 2 спроби не діяло б і хід можна було б ' +
        'заблокувати назавжди. Тому НЕ блокую. Червоний результат треба озвучити явно:\n\n' +
        detail,
    })
    process.exit(0)
  }

  // --- block: every documented shape, plus exit 2 ----------------------------------
  // NO `continue: false` here, and no `stopReason`. The docs are explicit that
  // `continue: false` means "Claude stops processing entirely after the hook runs" and
  // that it "takes precedence over any event-specific decision fields" — which is the
  // exact OPPOSITE of a Stop block (block = do not stop, keep going and fix it). Emitting
  // both would have inverted the gate's primary path from "send the agent back" into
  // "halt the session", and the failure table would never have been acted on.
  emit({
    // documented in the Stop section
    hookSpecificOutput: { hookEventName: 'Stop', decision: 'block', reason: detail },
    // older top-level pair, still honoured by some versions
    decision: 'block',
    reason: detail,
    // systemMessage is documented as "shown to Claude, not the user" — the right channel.
    systemMessage: 'verify-gate: швидкий рівень червоний — хід заблоковано.',
  })
  // Authoritative per the exit-code table: blocks regardless of JSON, stderr is the reason.
  process.stderr.write(`${detail}\n`)
  process.exit(2)
}

main().catch((err) => {
  process.stderr.write(`verify-gate: внутрішня помилка: ${msg(err)}\n`)
  emit({
    systemMessage:
      `verify-gate: внутрішня помилка (${msg(err)}) — хід НЕ перевірено. Не заявляй успіх.`,
  })
  process.exit(0)
})
