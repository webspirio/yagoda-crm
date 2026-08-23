#!/usr/bin/env node
/**
 * The PII boundary of a PUBLIC repository.
 *
 * `.gitignore:16` ignores `input/` and `:25` ignores `docs/`, with a comment recording that
 * eight of those files quote real surnames out of the client's non-anonymised workbook (434
 * occurrences) and that 208 real supplier names live in `input/`. This repo is public and
 * serves GitHub Pages, so one `git add -A` publishes all of it, permanently.
 *
 * Until now that boundary was prose plus two lines of .gitignore with nothing checking it —
 * and `.gitignore` was not even in the source hash, so changing the boundary did not
 * invalidate a cached green. This is the highest-consequence, lowest-cost check here: every
 * other failure in this layer costs time, this one cannot be undone.
 *
 * It asserts three things:
 *   1. `docs/` and `input/` are still ignored by git;
 *   2. no file under either path is tracked (`git add -f` bypasses ignore rules);
 *   3. no spreadsheet is tracked anywhere — the client's data arrived as .xlsx.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

/** Paths whose contents must never be committed. */
const SENSITIVE_DIRS = ['docs', 'input']

/** @param {string[]} lines @returns {never} */
function fail(lines) {
  process.stderr.write('pii-boundary: ЧЕРВОНО\n')
  for (const l of lines) process.stderr.write(`  ${l}\n`)
  process.stderr.write(
    '  Репозиторій ПУБЛІЧНИЙ і подає GitHub Pages. Публікація прізвищ клієнта не відкатується.\n',
  )
  process.exit(1)
}

function main() {
  /** @type {string[]} */
  const problems = []

  // 1 — still ignored?
  for (const dir of SENSITIVE_DIRS) {
    let ignored = true
    try {
      execFileSync('git', ['check-ignore', '-q', `${dir}/`], { cwd: ROOT })
    } catch {
      ignored = false
    }
    if (!ignored) {
      problems.push(
        `${dir}/ БІЛЬШЕ НЕ ІГНОРУЄТЬСЯ git. У .gitignore є коментар, чому саме цей каталог ` +
          `не публікується; якщо його змінили — це саме та зміна, яку не можна робити тихо.`,
      )
    }
  }

  // 2 — nothing under them tracked, ignore rules notwithstanding
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\u0000')
    .filter(Boolean)
  for (const f of tracked) {
    if (SENSITIVE_DIRS.some((d) => f === d || f.startsWith(`${d}/`))) {
      problems.push(`ВІДСЛІДКОВУЄТЬСЯ ЧУТЛИВИЙ ФАЙЛ: ${f} — прибрати з індексу (git rm --cached).`)
    }
    if (/\.(xlsx?|xlsm|numbers)$/i.test(f)) {
      problems.push(`ВІДСЛІДКОВУЄТЬСЯ ТАБЛИЦЯ: ${f} — дані клієнта прийшли саме у такому вигляді.`)
    }
  }

  if (problems.length) fail(problems)

  process.stdout.write(
    `pii-boundary: ${SENSITIVE_DIRS.map((d) => `${d}/`).join(' і ')} ігноруються, жодного з ` +
      `${tracked.length} відслідковуваних файлів під ними немає, таблиць немає\n`,
  )
  process.stdout.write(
    `pii-boundary: УВАГА — перевіряється лише МЕЖА, не вміст: сканування відслідковуваних ` +
      `файлів на прізвища тут немає\n`,
  )
}

main()
