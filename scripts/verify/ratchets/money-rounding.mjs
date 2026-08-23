#!/usr/bin/env node
/**
 * Money must not leave the engine unrounded.
 *
 * `src/lib/calc.ts` is disciplined: every figure it returns has been through `round2()`.
 * Components are not, in places — `uah(totals.paid + totals.settled)` adds two floats and
 * prints the result as ₴.
 *
 * SCOPE, narrowed after review. The rounding rule is ENFORCED only for the two formatters
 * that render money as money: `uah` and `uahAuto`. `num`/`kg`/`tonnage` are REPORTED, never
 * gated. The earlier version enforced all five and the result was noise: six of ten baseline
 * entries opened with "not money" (a kg→t conversion, a chart axis label, a row counter, a
 * percentage), and `num(i + 1)` demanded either `round2(i + 1)` — nonsense — or a new
 * exemption. Noise is not harmless here: it is what teaches people to widen baselines, which
 * is the exact failure this file exists to prevent.
 *
 * Detection is AST-based, never grep — `x.net / maxNet` for a bar width and
 * `b.amount - a.amount` in a comparator are legitimate and look identical to a regex.
 *
 * Bindings are RESOLVED on both sides, which review showed matters in four ways that a
 * name match missed: `import * as fmt` + `fmt.uah(a+b)`, `bag.uah(a+b)`, `fmt['num'](a+b)`,
 * and — the asymmetry — a locally declared `const round2 = v => v` that silenced the check
 * while aliasing the REAL rounder (`round2 as r2`) tripped it.
 *
 * `--write` regenerates the baseline, keeping existing reasons. Adoption only.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'money-rounding.json')

/** Enforced: these render a number a human reads as money. */
const MONEY_FORMATTERS = new Set(['uah', 'uahAuto'])

/** Reported only: generic number/weight formatters. A ₴ figure can still flow through
 *  `num()` (e.g. a ₴/кг label), so these are counted and printed, never gated. */
const REPORTED_FORMATTERS = new Set(['num', 'kg', 'tonnage'])

const ALL_FORMATTERS = new Set([...MONEY_FORMATTERS, ...REPORTED_FORMATTERS])

/** The only two things that make an arithmetic result safe to print. */
const WRAPPER_NAMES = new Set(['round2', 'sum'])

/** Module specifiers that count as the format / calc modules. The optional extension
 *  matters: tsconfig.app.json sets allowImportingTsExtensions, so `@/lib/format.ts` is a
 *  legal import that the earlier pattern did not match. */
const FORMAT_MODULE = /(^|\/)lib\/format(\.tsx?)?$|^\.\.?\/format(\.tsx?)?$/
const CALC_MODULE = /(^|\/)lib\/calc(\.tsx?)?$|^\.\.?\/calc(\.tsx?)?$/

const FORMAT_SOURCE = 'src/lib/format.ts'
const CALC_SOURCE = 'src/lib/calc.ts'

const ARITH = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
])

const PLACEHOLDER =
  /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above|ok|fine|dead)\.?$/i

/**
 * @typedef {object} Violation
 * @property {string} file
 * @property {string} formatter  the original (unaliased) formatter name
 * @property {string} expr       normalised source text of the offending arithmetic
 * @property {number} line       for humans only — never part of the key
 */

/**
 * The key omits the line number: keying on lines fires on every unrelated edit above the
 * site, and a ratchet that cries wolf gets deleted. Occurrences are counted separately so
 * two sites sharing one key cannot hide behind each other — review proved that fixing one
 * of the two identical DashboardPage sites left the check green with a stale entry still
 * licensed, i.e. half a fix registered as no fix.
 *
 * @param {{file: string, formatter: string, expr: string}} v
 * @returns {string}
 */
const keyOf = (v) => `${v.file}|${v.formatter}|${v.expr}`

/** @param {string} s @returns {string} */
const normalise = (s) => s.replace(/\s+/g, ' ').trim()

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('ratchet:money: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** @returns {string[]} */
function sourceFiles() {
  const raw = execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  }).toString('utf8')
  return raw
    .split('\u0000')
    .filter(Boolean)
    .filter((f) => /^src\/.*\.tsx?$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f))
    .sort()
}

/**
 * @typedef {object} Bindings
 * @property {Map<string, string>} direct     local name → original formatter name
 * @property {Set<string>} namespaces         locals bound to `import * as X from format`
 * @property {Set<string>} wrappers           local names that really are round2/sum
 * @property {boolean} wrapperShadowed        a local declaration shadows a wrapper name
 */

/**
 * @param {ts.SourceFile} sf
 * @param {string} rel
 * @returns {Bindings}
 */
function bindingsFor(sf, rel) {
  /** @type {Map<string, string>} */
  const direct = new Map()
  /** @type {Set<string>} */
  const namespaces = new Set()
  /** @type {Set<string>} */
  const wrappers = new Set()
  let wrapperShadowed = false

  if (rel === FORMAT_SOURCE) {
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && ALL_FORMATTERS.has(stmt.name.text)) {
        direct.set(stmt.name.text, stmt.name.text)
      }
      // A formatter rewritten as `export const uah = …` would otherwise drop out silently.
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && ALL_FORMATTERS.has(d.name.text)) {
            direct.set(d.name.text, d.name.text)
          }
        }
      }
    }
  }
  if (rel === CALC_SOURCE) {
    for (const stmt of sf.statements) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && WRAPPER_NAMES.has(stmt.name.text)) {
        wrappers.add(stmt.name.text)
      }
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && WRAPPER_NAMES.has(d.name.text)) wrappers.add(d.name.text)
        }
      }
    }
  }

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    const isFormat = FORMAT_MODULE.test(spec)
    const isCalc = CALC_MODULE.test(spec)
    if (!isFormat && !isCalc) continue
    const clause = stmt.importClause
    if (!clause) continue
    const named = clause.namedBindings
    if (named && ts.isNamespaceImport(named)) {
      // `import * as fmt from '@/lib/format'` — every fmt.<formatter>() call is in scope.
      if (isFormat) namespaces.add(named.name.text)
      continue
    }
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const original = (el.propertyName ?? el.name).text
        if (isFormat && ALL_FORMATTERS.has(original)) direct.set(el.name.text, original)
        if (isCalc && WRAPPER_NAMES.has(original)) wrappers.add(el.name.text)
      }
    }
  }

  // A locally declared `round2`/`sum` is NOT a rounder. Review proved a two-line
  // `const round2 = v => v` silenced the check entirely.
  /** @param {ts.Node} n */
  const findShadows = (n) => {
    if (
      (ts.isVariableDeclaration(n) || ts.isFunctionDeclaration(n)) &&
      n.name &&
      ts.isIdentifier(n.name) &&
      WRAPPER_NAMES.has(n.name.text) &&
      !wrappers.has(n.name.text) &&
      rel !== CALC_SOURCE
    ) {
      wrapperShadowed = true
    }
    ts.forEachChild(n, findShadows)
  }
  findShadows(sf)

  return { direct, namespaces, wrappers, wrapperShadowed }
}

/** @param {ts.CallExpression} call @param {Bindings} b @returns {string | null} */
function resolveFormatter(call, b) {
  const e = call.expression
  if (ts.isIdentifier(e)) return b.direct.get(e.text) ?? null
  if (ts.isPropertyAccessExpression(e)) {
    // fmt.uah(...) — the namespace case — and bag.uah(...) on any object.
    const name = e.name.text
    if (!ALL_FORMATTERS.has(name)) return null
    if (ts.isIdentifier(e.expression) && b.namespaces.has(e.expression.text)) return name
    // A member call naming a formatter is treated as that formatter. Over-inclusive by
    // design: missing a real ₴ print is worse than one baseline entry.
    return name
  }
  if (ts.isElementAccessExpression(e)) {
    const arg = e.argumentExpression
    if (arg && ts.isStringLiteral(arg) && ALL_FORMATTERS.has(arg.text)) return arg.text
  }
  return null
}

/** @param {ts.CallExpression} call @param {Bindings} b @returns {boolean} */
function isWrapperCall(call, b) {
  const e = call.expression
  const name = ts.isIdentifier(e)
    ? e.text
    : ts.isPropertyAccessExpression(e)
      ? e.name.text
      : null
  if (!name) return false
  return b.wrappers.has(name)
}

/**
 * @param {ts.Node} node
 * @param {Bindings} b
 * @returns {ts.Node[]}
 */
function unwrappedArithmetic(node, b) {
  /** @type {ts.Node[]} */
  const hits = []
  /** @param {ts.Node} n */
  const visit = (n) => {
    if (ts.isParenthesizedExpression(n)) return visit(n.expression)
    if (ts.isCallExpression(n)) {
      if (isWrapperCall(n, b)) return
      n.arguments.forEach(visit)
      return
    }
    if (ts.isBinaryExpression(n) && ARITH.has(n.operatorToken.kind)) {
      hits.push(n)
      return
    }
    ts.forEachChild(n, visit)
  }
  visit(node)
  return hits
}

/**
 * A one-line `export { uah } from './lib/format'` would make every downstream import
 * invisible to FORMAT_MODULE. Rather than resolve re-export chains, refuse to have any.
 *
 * @param {ts.SourceFile} sf
 * @param {string} rel
 * @returns {string | null}
 */
function reExportsFormat(sf, rel) {
  if (rel === FORMAT_SOURCE) return null
  for (const stmt of sf.statements) {
    if (!ts.isExportDeclaration(stmt)) continue
    const spec = stmt.moduleSpecifier
    if (spec && ts.isStringLiteral(spec) && FORMAT_MODULE.test(spec.text)) {
      return `${rel} re-експортує lib/format — імпорти через нього стають невидимими для цієї перевірки`
    }
  }
  return null
}

/** @returns {{ enforced: Violation[], reported: Violation[], reExports: string[], shadows: string[] }} */
function scan() {
  /** @type {Violation[]} */
  const enforced = []
  /** @type {Violation[]} */
  const reported = []
  /** @type {string[]} */
  const reExports = []
  /** @type {string[]} */
  const shadows = []

  for (const rel of sourceFiles()) {
    const abs = path.join(ROOT, rel)
    const sf = ts.createSourceFile(
      abs,
      readFileSync(abs, 'utf8'),
      ts.ScriptTarget.ES2023,
      true,
      ts.ScriptKind.TSX,
    )
    const reExport = reExportsFormat(sf, rel)
    if (reExport) reExports.push(reExport)

    const b = bindingsFor(sf, rel)
    if (b.wrapperShadowed) {
      shadows.push(`${rel} оголошує власний round2/sum — локальна декларація не є округленням`)
    }
    if (b.direct.size === 0 && b.namespaces.size === 0) continue

    /** @param {ts.Node} n */
    const walk = (n) => {
      if (ts.isCallExpression(n)) {
        const original = resolveFormatter(n, b)
        const arg = original ? n.arguments[0] : undefined
        if (original && arg) {
          for (const hit of unwrappedArithmetic(arg, b)) {
            const v = {
              file: rel,
              formatter: original,
              expr: normalise(hit.getText(sf)),
              line: sf.getLineAndCharacterOfPosition(hit.getStart(sf)).line + 1,
            }
            ;(MONEY_FORMATTERS.has(original) ? enforced : reported).push(v)
          }
        }
      }
      ts.forEachChild(n, walk)
    }
    walk(sf)
  }
  return { enforced, reported, reExports, shadows }
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
  const { enforced, reported, reExports, shadows } = scan()

  // Occurrence counts, not just presence: two sites sharing a key must both be fixed.
  /** @type {Map<string, number>} */
  const foundCounts = new Map()
  for (const v of enforced) foundCounts.set(keyOf(v), (foundCounts.get(keyOf(v)) ?? 0) + 1)

  /** @type {{createdAt: string, note: string, entries: (Violation & {reason: string, occurrences?: number})[]}} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    baseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    if (!write) fail([`немає ${path.relative(ROOT, BASELINE)} — створіть через --write`])
  }

  if (write) {
    const existing = new Map(baseline.entries.map((e) => [keyOf(e), e.reason]))
    /** @type {Map<string, Violation & {reason: string, occurrences: number}>} */
    const byKey = new Map()
    for (const v of enforced) {
      const k = keyOf(v)
      const prev = byKey.get(k)
      if (prev) prev.occurrences += 1
      else byKey.set(k, { ...v, reason: existing.get(k) ?? '', occurrences: 1 })
    }
    const entries = [...byKey.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, entries }, null, 2)}\n`)
    process.stdout.write(
      `ratchet:money: baseline перезаписано — ${entries.length} ключів, ` +
        `${entries.filter((e) => reasonProblem(e.reason)).length} без придатної причини\n`,
    )
    return
  }

  /** @type {string[]} */
  const problems = []

  // A baseline that lists one key twice makes both entries unfalsifiable.
  const seen = new Set()
  for (const e of baseline.entries) {
    const k = keyOf(e)
    if (seen.has(k)) problems.push(`ДУБЛІКАТ У BASELINE: ${k} — один ключ, два записи.`)
    seen.add(k)
  }

  const baselineByKey = new Map(baseline.entries.map((e) => [keyOf(e), e]))

  for (const [k, count] of foundCounts) {
    const e = baselineByKey.get(k)
    if (!e) {
      const v = enforced.find((x) => keyOf(x) === k)
      problems.push(
        `НОВЕ: ${v?.file}:${v?.line} — ${v?.formatter}(${v?.expr}) друкує гроші з ` +
          `результату арифметики без round2()/sum().`,
      )
      continue
    }
    const expected = e.occurrences ?? 1
    if (expected !== count) {
      problems.push(
        `ЗМІНИЛАСЯ КІЛЬКІСТЬ: ${k} — у baseline ${expected}, у коді ${count}. ` +
          `Часткове виправлення не зараховується: або виправити всі, або оновити baseline.`,
      )
    }
  }
  for (const e of baseline.entries) {
    if (!foundCounts.has(keyOf(e))) {
      problems.push(
        `ЗАСТАРІЛИЙ ЗАПИС: ${e.file} — ${e.formatter}(${e.expr}) більше не знаходиться. ` +
          `Прибрати з baseline: храповик крутиться лише на зменшення.`,
      )
    }
    const problem = reasonProblem(e.reason)
    if (problem) problems.push(`БЕЗ ПРИЧИНИ: ${e.file} ${e.formatter}(${e.expr}) — ${problem}.`)
  }

  // Structural evasions: fail rather than quietly lose coverage.
  problems.push(...reExports)
  problems.push(...shadows)

  if (problems.length) fail(problems)

  process.stdout.write(
    `ratchet:money: ${foundCounts.size} ключів (${enforced.length} місць) з арифметикою у ` +
      `uah/uahAuto, усі перелічені у baseline від ${baseline.createdAt}\n`,
  )
  // Reported, not gated — and said out loud so "green" is not read as "all money checked".
  if (reported.length) {
    process.stdout.write(
      `ratchet:money: УВАГА — ${reported.length} місць друкують арифметику через ` +
        `num/kg/tonnage. Ці форматери НЕ під храповиком (правило звужено, бо на них він ` +
        `давав переважно шум), тому ₴-величина через num() тут не перевіряється:\n`,
    )
    for (const v of reported) {
      process.stdout.write(`    ${v.file}:${v.line} ${v.formatter}(${v.expr})\n`)
    }
  }
}

main()
