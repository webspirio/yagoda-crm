#!/usr/bin/env node
/**
 * Input validation at the untrusted edge.
 *
 * This app has no HTTP handler, no RPC endpoint and no queue consumer, so "which modules are
 * remotely callable" has exactly one answer: the zustand `persist` middleware, which
 * rehydrates `yagoda-crm-demo-v3` out of localStorage and hands it straight to the money
 * engine. `partialize` persists receptions, payouts, prices and settings — all the money —
 * and today nothing between that JSON and `openDebts()`/`round2()` is more than a type
 * declaration.
 *
 * The rule: every key `partialize` persists must be narrowed at runtime on the rehydrate
 * path, or be listed in the dated baseline.
 *
 * WHAT COUNTS AS A NARROWING — and why this is no longer a name match.
 *
 * The first version accepted any callee matching /^(Array\.isArray|is[A-Z]\w*|assert\w*|
 * validate\w*|narrow\w*|parse\w+Schema|\w+Guard)$/. Review defeated it in one line: five
 * calls to functions that DO NOT EXIST —
 *
 *     isTotallyUnchecked(p.receptions); assertNothingAtAll(p.payouts); …
 *
 * — made the ratchet declare five money keys validated and instruct the author to delete
 * their baseline entries. A checkbox satisfied by dead code is worse than no detector.
 *
 * A narrowing must now be something whose SEMANTICS can be read off the AST:
 *   - `Array.isArray(x)`
 *   - `typeof x === '…'` / `!==`
 *   - `x instanceof C`
 *   - `'k' in x`
 *   - a call resolving to a declaration IN THIS FILE whose return type is a type predicate
 *   - a schema check — `S.parse(x)` / `S.safeParse(x)` / `S.assert(x)` — where the receiver
 *     looks like a schema (`*Schema`, `z`, `yup`, `v`)
 * and its RESULT MUST BE USED. A bare expression statement narrows nothing, which is
 * exactly what made the five undefined calls work.
 *
 * Anything that looks like a guard but cannot be verified is REPORTED, never credited.
 *
 * WHERE IT COUNTS. `nonExecuting` treats as not-guaranteed-to-run: any function boundary (a
 * guard inside an uninvoked closure is a definition, not an execution), a loop body, a
 * `catch`, code after a `return`/`throw`, and one side of an if/ternary/short-circuit.
 * Being the GUARD is not being guarded, so a condition position counts as full.
 *
 * KEY ATTRIBUTION. Only the first property after the parameter root is credited, so
 * `Array.isArray(p.settings.prices)` credits `settings` and not `prices`.
 *
 * `--write` regenerates the baseline, keeping existing reasons. Adoption only.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const BASELINE = path.join(ROOT, 'scripts', 'verify', 'baselines', 'persist-boundary.json')
const STORE = 'src/lib/store.ts'

/** Callbacks on the persist options that actually see the rehydrated payload. */
const REHYDRATE_HOOKS = ['merge', 'onRehydrateStorage', 'deserialize']

/**
 * Built-ins that look like validation and narrow nothing. `parseInt('abc')` yields NaN,
 * `isNaN(x)` returns a boolean about a value it did not constrain, and `JSON.parse("{}")`
 * validates a literal rather than the input.
 */
const NOT_NARROWING = new Set([
  'parseInt',
  'parseFloat',
  'Number',
  'String',
  'Boolean',
  'isNaN',
  'isFinite',
  'toString',
  'valueOf',
  'JSON.parse',
  'JSON.stringify',
])

/** Schema-library entry points, accepted when the receiver looks like a schema. */
const SCHEMA_METHODS = new Set(['parse', 'safeParse', 'assert', 'validateSync'])
const SCHEMA_RECEIVER = /Schema|^z$|^yup$|^v$/

const PLACEHOLDER =
  /^(todo|fixme|tbd|n\/?a|xxx|\?+|-+|—+|wip|later|see above|same as above|as above)\.?$/i

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('ratchet:persist: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.exit(1)
}

/** @param {ts.Expression} e @returns {string} */
function calleeText(e) {
  if (ts.isIdentifier(e)) return e.text
  if (ts.isPropertyAccessExpression(e)) {
    const left = ts.isIdentifier(e.expression) ? e.expression.text : ''
    return left ? `${left}.${e.name.text}` : e.name.text
  }
  return ''
}

/**
 * The identifier at the root of a property/element-access chain, plus the FIRST property
 * after it. `state.receptions[0].debt` gives root `state`, first `receptions`.
 *
 * @param {ts.Node} node
 * @returns {{ root: string | null, first: string | null }}
 */
function chainOf(node) {
  /** @type {string | null} */
  let first = null
  let n = node
  for (;;) {
    if (ts.isPropertyAccessExpression(n)) {
      first = n.name.text
      n = n.expression
      continue
    }
    if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression
      if (a && ts.isStringLiteral(a)) first = a.text
      n = n.expression
      continue
    }
    if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) {
      n = n.expression
      continue
    }
    break
  }
  return { root: ts.isIdentifier(n) ? n.text : null, first }
}

/**
 * True when `n` cannot be relied on to execute on the rehydrate path.
 *
 * @param {ts.Node} n
 * @param {ts.Node} stop  the rehydrate callback
 * @returns {boolean}
 */
function nonExecuting(n, stop) {
  let child = n
  let p = n.parent
  while (p && p !== stop) {
    if (
      ts.isArrowFunction(p) ||
      ts.isFunctionExpression(p) ||
      ts.isFunctionDeclaration(p) ||
      ts.isMethodDeclaration(p)
    ) {
      return true
    }
    if (
      ts.isForStatement(p) ||
      ts.isForOfStatement(p) ||
      ts.isForInStatement(p) ||
      ts.isWhileStatement(p) ||
      ts.isDoStatement(p) ||
      ts.isCatchClause(p)
    ) {
      return true
    }
    if (ts.isIfStatement(p) && child !== p.expression) return true
    if (ts.isConditionalExpression(p) && child !== p.condition) return true
    if (ts.isCaseClause(p) && child !== p.expression) return true
    if (
      ts.isBinaryExpression(p) &&
      (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) &&
      child !== p.left
    ) {
      return true
    }
    if (ts.isBlock(p)) {
      for (const stmt of p.statements) {
        if (stmt === child) break
        if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true
      }
    }
    child = p
    p = p.parent
  }
  return false
}

/**
 * A narrowing's result must be consumed. A bare expression statement constrains nothing —
 * this is what let calls to undefined functions pass.
 *
 * @param {ts.Node} n
 * @returns {boolean}
 */
function resultIsUsed(n) {
  let p = n.parent
  while (
    p &&
    (ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isNonNullExpression(p))
  ) {
    p = p.parent
  }
  if (!p) return false
  if (ts.isExpressionStatement(p)) return false
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) {
    return resultIsUsed(p)
  }
  return (
    ts.isIfStatement(p) ||
    ts.isConditionalExpression(p) ||
    ts.isBinaryExpression(p) ||
    ts.isReturnStatement(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isPropertyAssignment(p) ||
    ts.isCallExpression(p) ||
    ts.isWhileStatement(p) ||
    ts.isDoStatement(p) ||
    ts.isSwitchStatement(p) ||
    ts.isArrowFunction(p) ||
    ts.isTemplateSpan(p)
  )
}

/**
 * Names of same-file functions declared with a type-predicate return (`v is T`).
 *
 * @param {ts.SourceFile} sf
 * @returns {Set<string>}
 */
function typePredicateNames(sf) {
  /** @type {Set<string>} */
  const names = new Set()
  /** @param {ts.Node} n */
  const walk = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name && n.type && ts.isTypePredicateNode(n.type)) {
      names.add(n.name.text)
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer
      if (
        (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
        init.type &&
        ts.isTypePredicateNode(init.type)
      ) {
        names.add(n.name.text)
      }
    }
    ts.forEachChild(n, walk)
  }
  walk(sf)
  return names
}

/**
 * @typedef {object} Narrowing
 * @property {ts.Node} target
 * @property {string} how
 * @property {boolean} verifiable
 */

/**
 * @param {ts.Node} n
 * @param {Set<string>} predicates
 * @returns {Narrowing | null}
 */
function narrowingAt(n, predicates) {
  if (ts.isBinaryExpression(n)) {
    const eq =
      n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
    if (eq) {
      for (const side of [n.left, n.right]) {
        if (ts.isTypeOfExpression(side)) {
          return { target: side.expression, how: 'typeof === …', verifiable: true }
        }
      }
    }
    if (n.operatorToken.kind === ts.SyntaxKind.InKeyword) {
      return { target: n.right, how: "'k' in x", verifiable: true }
    }
    if (n.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) {
      return { target: n.left, how: 'instanceof', verifiable: true }
    }
  }
  if (!ts.isCallExpression(n)) return null
  const name = calleeText(n.expression)
  const bare = name.split('.').pop() ?? ''
  if (NOT_NARROWING.has(name) || NOT_NARROWING.has(bare)) return null
  const arg = n.arguments[0]
  if (!arg) return null

  if (name === 'Array.isArray') {
    return { target: arg, how: 'Array.isArray(…)', verifiable: true }
  }
  if (SCHEMA_METHODS.has(bare)) {
    const recv = ts.isPropertyAccessExpression(n.expression) ? n.expression.expression : null
    const recvText = recv ? recv.getText() : ''
    if (SCHEMA_RECEIVER.test(recvText)) {
      return { target: arg, how: `${bare}() зі схеми`, verifiable: true }
    }
  }
  if (predicates.has(name)) {
    return { target: arg, how: `${name}() — type predicate`, verifiable: true }
  }
  if (/^(is[A-Z]|assert|validate|narrow|check|ensure)/.test(bare)) {
    return { target: arg, how: `${name}() — не підтверджується`, verifiable: false }
  }
  return null
}

/**
 * @typedef {object} KeyStatus
 * @property {string} key
 * @property {'unvalidated' | 'partial' | 'validated'} state
 * @property {string} detail
 */

/** @returns {{ statuses: KeyStatus[], hooksFound: string[], unverifiable: string[] }} */
function analyse() {
  const abs = path.join(ROOT, STORE)
  const sf = ts.createSourceFile(
    abs,
    readFileSync(abs, 'utf8'),
    ts.ScriptTarget.ES2023,
    true,
    ts.ScriptKind.TS,
  )

  /** @type {ts.ObjectLiteralExpression[]} */
  const persistOptions = []
  /** @param {ts.Node} n */
  const findPersist = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'persist') {
      const opts = n.arguments[1]
      if (opts && ts.isObjectLiteralExpression(opts)) persistOptions.push(opts)
    }
    ts.forEachChild(n, findPersist)
  }
  findPersist(sf)

  if (persistOptions.length === 0) {
    fail([
      `у ${STORE} не знайдено persist(state, options) з обʼєктом опцій.`,
      `Це не «все гаразд» — це неможливість перевірити межу.`,
    ])
  }
  if (persistOptions.length > 1) {
    fail([
      `у ${STORE} знайдено ${persistOptions.length} виклики persist() — детектор описує ` +
        `лише один, і тихо брав останній. Розширити детектор або розділити стори.`,
    ])
  }
  const options = persistOptions[0]

  /** @param {string} name @returns {ts.Expression | null} */
  const optionValue = (name) => {
    for (const prop of options.properties) {
      if (!ts.isPropertyAssignment(prop)) continue
      const k = prop.name
      if ((ts.isIdentifier(k) || ts.isStringLiteral(k)) && k.text === name) return prop.initializer
    }
    return null
  }

  const partialize = optionValue('partialize')
  if (!partialize) {
    fail([`у persist() немає partialize — зберігається ВЕСЬ стан, межа ширша за детектор.`])
  }
  if (!ts.isArrowFunction(partialize) && !ts.isFunctionExpression(partialize)) {
    fail([`partialize не є функцією — детектор не може прочитати межу.`])
  }
  const pfn = /** @type {ts.ArrowFunction | ts.FunctionExpression} */ (partialize)

  // Read the RETURNED literal. Taking the first object literal `forEachChild` reached
  // picked up sibling locals (`const defaults = {…}`) as persisted keys.
  /** @type {ts.ObjectLiteralExpression | null} */
  let returned = null
  if (ts.isBlock(pfn.body)) {
    for (const stmt of pfn.body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        const e = ts.isParenthesizedExpression(stmt.expression)
          ? stmt.expression.expression
          : stmt.expression
        if (ts.isObjectLiteralExpression(e)) returned = e
      }
    }
  } else {
    const e = ts.isParenthesizedExpression(pfn.body) ? pfn.body.expression : pfn.body
    if (ts.isObjectLiteralExpression(e)) returned = e
  }
  if (!returned) {
    fail([`partialize не повертає обʼєктного літерала — детектор не може перелічити межу.`])
  }

  /** @type {string[]} */
  const keys = []
  for (const prop of returned.properties) {
    if (ts.isSpreadAssignment(prop)) {
      fail([
        `partialize містить spread (${prop.getText().slice(0, 40)}) — тоді зберігається ` +
          `більше, ніж перелічено, і детектор порадив би прибрати живі записи з baseline. ` +
          `Перелічити ключі явно.`,
      ])
    }
    if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
      const nm = prop.name
      if (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) keys.push(nm.text)
    }
  }
  if (keys.length === 0) fail([`partialize не перелічив жодного ключа.`])

  const predicates = typePredicateNames(sf)
  /** @type {string[]} */
  const hooksFound = []
  /** @type {string[]} */
  const unverifiable = []
  /** @type {Map<string, {full: boolean, detail: string}>} */
  const narrowed = new Map()

  for (const hook of REHYDRATE_HOOKS) {
    const cb = optionValue(hook)
    if (!cb) continue
    if (!ts.isArrowFunction(cb) && !ts.isFunctionExpression(cb)) continue
    hooksFound.push(hook)

    /** @type {Set<string>} */
    const paramNames = new Set()
    for (const prm of cb.parameters) {
      if (ts.isIdentifier(prm.name)) paramNames.add(prm.name.text)
    }
    if (paramNames.size === 0) continue

    for (let grew = true; grew; ) {
      grew = false
      /** @param {ts.Node} n */
      const aliases = (n) => {
        if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name)) {
          const { root } = chainOf(n.initializer)
          if (root && paramNames.has(root) && !paramNames.has(n.name.text)) {
            paramNames.add(n.name.text)
            grew = true
          }
        }
        ts.forEachChild(n, aliases)
      }
      aliases(cb.body)
    }

    /** @param {ts.Node} n */
    const walk = (n) => {
      const found = narrowingAt(n, predicates)
      if (found) {
        const { root, first } = chainOf(found.target)
        if (root && paramNames.has(root) && first && keys.includes(first)) {
          if (!found.verifiable) {
            unverifiable.push(`${hook}: ${found.how} на ${found.target.getText()} → ${first}`)
          } else if (!resultIsUsed(n)) {
            unverifiable.push(
              `${hook}: ${found.how} на ${found.target.getText()} → ${first}: результат не ` +
                `використовується, тобто нічого не звужує`,
            )
          } else {
            const partial = nonExecuting(n, cb)
            const prev = narrowed.get(first)
            narrowed.set(first, {
              full: !partial || Boolean(prev?.full),
              detail:
                `${hook}: ${found.how} на ${found.target.getText()}` +
                `${partial ? ' (виконання не гарантоване)' : ''}`,
            })
          }
        }
      }
      ts.forEachChild(n, walk)
    }
    walk(cb.body)
  }

  /** @type {KeyStatus[]} */
  const statuses = keys.map((key) => {
    const nn = narrowed.get(key)
    if (!nn) {
      return { key, state: 'unvalidated', detail: 'жодного рантайм-звуження на шляху rehydrate' }
    }
    if (!nn.full) return { key, state: 'partial', detail: nn.detail }
    return { key, state: 'validated', detail: nn.detail }
  })

  return { statuses, hooksFound, unverifiable }
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
  const { statuses, hooksFound, unverifiable } = analyse()
  const unguarded = statuses.filter((s) => s.state !== 'validated')
  const unguardedKeys = new Set(unguarded.map((s) => s.key))

  /** @type {{createdAt: string, note: string, entries: {key: string, state: string, reason: string}[]}} */
  let baseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE, 'utf8'))
  } catch {
    baseline = { createdAt: new Date().toISOString().slice(0, 10), note: '', entries: [] }
    if (!write) fail([`немає ${path.relative(ROOT, BASELINE)} — створіть через --write`])
  }

  if (write) {
    const existing = new Map(baseline.entries.map((e) => [e.key, e.reason]))
    const entries = unguarded
      .map((s) => ({ key: s.key, state: s.state, reason: existing.get(s.key) ?? '' }))
      .sort((a, b) => a.key.localeCompare(b.key))
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, entries }, null, 2)}\n`)
    process.stdout.write(
      `ratchet:persist: baseline перезаписано — ${entries.length} записів, ` +
        `${entries.filter((e) => reasonProblem(e.reason)).length} без придатної причини\n`,
    )
    return
  }

  /** @type {string[]} */
  const problems = []
  const baselineKeys = new Set(baseline.entries.map((e) => e.key))

  for (const s of unguarded) {
    if (!baselineKeys.has(s.key)) {
      problems.push(
        `НОВИЙ НЕЗАХИЩЕНИЙ КЛЮЧ: partialize зберігає «${s.key}», а на шляху rehydrate ` +
          `${s.state === 'partial' ? 'звуження не гарантовано виконується' : 'звуження немає'} ` +
          `(${s.detail}).`,
      )
    }
  }
  for (const e of baseline.entries) {
    if (!unguardedKeys.has(e.key)) {
      const still = statuses.find((s) => s.key === e.key)
      problems.push(
        still
          ? `ЗАСТАРІЛИЙ ЗАПИС: «${e.key}» тепер звужується (${still.detail}) — прибрати з baseline.`
          : `ЗАСТАРІЛИЙ ЗАПИС: «${e.key}» більше не зберігається через partialize — прибрати.`,
      )
    }
    const problem = reasonProblem(e.reason)
    if (problem) problems.push(`БЕЗ ПРИЧИНИ: «${e.key}» — ${problem}.`)
  }

  if (problems.length) fail(problems)

  const partial = statuses.filter((s) => s.state === 'partial')
  process.stdout.write(
    `ratchet:persist: ${statuses.length} ключів у partialize · ` +
      `${statuses.length - unguarded.length} звужено · ${unguarded.length} у baseline від ` +
      `${baseline.createdAt}\n`,
  )
  if (partial.length) {
    process.stdout.write(
      `ratchet:persist: УВАГА — ${partial.length} ключ(і) мають звуження, виконання якого не ` +
        `гарантоване, і НЕ рахуються перевіреними: ` +
        `${partial.map((s) => `${s.key} (${s.detail})`).join('; ')}\n`,
    )
  }
  if (unverifiable.length) {
    process.stdout.write(
      `ratchet:persist: УВАГА — ${unverifiable.length} виклик(и) виглядають як перевірка, але ` +
        `детектор не може підтвердити, що вони щось звужують, тому НЕ зараховані: ` +
        `${unverifiable.join('; ')}\n`,
    )
  }
  if (!hooksFound.length) {
    process.stdout.write(
      `ratchet:persist: УВАГА — у persist() немає жодного з ${REHYDRATE_HOOKS.join('/')}, тобто ` +
        `рантайм-звуження немає взагалі: усі ${unguarded.length} ключів довіряються лише за ` +
        `декларацією типу\n`,
    )
  }
}

main()
