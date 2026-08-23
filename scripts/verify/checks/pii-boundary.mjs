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
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')

/** Paths whose contents must never be committed. */
const SENSITIVE_DIRS = ['docs', 'input']

/**
 * A personal-name shape: two or three capitalised Cyrillic words. Deliberately the same
 * pattern used to verify seed-suppliers.ts's claim that its 206 names are invented — that
 * check found zero full-name overlap, and this keeps it true.
 */
const NAME_RE = /[А-ЯЄІЇҐ][а-яєіїґʼ'’-]+(?:\s+[А-ЯЄІЇҐ][а-яєіїґʼ'’-]+){1,2}/g

/**
 * Name-shaped strings from a .xlsx, read straight out of the zip's sharedStrings part so no
 * dependency is needed. The client's workbook is never printed, only counted against.
 *
 * @param {string} file
 * @returns {Set<string>}
 */
function namesFromXlsx(file) {
  /** @type {Set<string>} */
  const out = new Set()
  let xml = ''
  try {
    // `unzip -p` is present on macOS and on GitHub runners; absence just means no comparison.
    xml = execFileSync('unzip', ['-p', file, 'xl/sharedStrings.xml'], {
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString('utf8')
  } catch {
    return out
  }
  for (const m of xml.matchAll(/<t[^>]*>([^<]+)<\/t>/g)) {
    const s = m[1].trim()
    const full = s.match(new RegExp(`^${NAME_RE.source}$`))
    if (full) out.add(s)
  }
  return out
}

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

  // ── 4. CONTENT, not just the boundary ─────────────────────────────────────────────
  // High-signal PII that has no business in a demo, regardless of the client's workbook.
  // Ukrainian mobile forms, with separators allowed after the prefix too: the first
  // version required digits immediately after +380 and so missed `+380 67 123 45 67`.
  const tel =
    /(?:\+ ?380|\b0)[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/
  const mail = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
  const iban = /\bUA\d{27}\b/
  const SKIP_CONTENT = /^(package-lock\.json|scripts\/verify\/checks\/pii-boundary\.mjs)$/
  for (const f of tracked) {
    if (SKIP_CONTENT.test(f)) continue
    if (!/\.(ts|tsx|js|mjs|json|md|html|css|ya?ml|svg)$/.test(f)) continue
    let text
    try {
      text = readFileSync(path.join(ROOT, f), 'utf8')
    } catch {
      continue
    }
    text.split('\n').forEach((line, i) => {
      // noreply/example addresses are boilerplate, not someone's mailbox
      if (mail.test(line) && !/noreply|example\.(com|org)|@users\./.test(line)) {
        problems.push(`E-MAIL У КОДІ: ${f}:${i + 1} — прибрати або замінити на example.com.`)
      }
      if (tel.test(line)) problems.push(`ТЕЛЕФОН У КОДІ: ${f}:${i + 1}.`)
      if (iban.test(line)) problems.push(`IBAN У КОДІ: ${f}:${i + 1}.`)
    })
  }

  // ── 5. do any tracked names match the client's actual workbook? ───────────────────
  // Runs only where input/ exists, i.e. on the machine that has the client's file. In CI it
  // cannot run, and that is said out loud rather than passing quietly.
  let nameCheck = 'input/ відсутній — звірку з реальним реєстром НЕ проводили'
  const workbook = path.join(ROOT, 'input', 'data-example.xlsx')
  if (existsSync(workbook)) {
    const real = namesFromXlsx(workbook)
    /** @type {Set<string>} */
    const trackedNames = new Set()
    for (const f of tracked) {
      if (!/\.(ts|tsx|json|md)$/.test(f)) continue
      try {
        for (const m of readFileSync(path.join(ROOT, f), 'utf8').matchAll(NAME_RE)) {
          trackedNames.add(m[0])
        }
      } catch {
        /* unreadable file is not a name leak */
      }
    }
    const hits = [...trackedNames].filter((n) => real.has(n))
    if (hits.length) {
      // Deliberately does NOT print the names: this output goes into logs and transcripts.
      problems.push(
        `РЕАЛЬНІ ІМЕНА В GIT: ${hits.length} з ${trackedNames.size} імен, що ` +
          `відслідковуються, зустрічаються у файлі клієнта. Імена тут НЕ друкуються — ` +
          `дивитися локально. Це публікація персональних даних, і вона не відкатується.`,
      )
    }
    nameCheck =
      `звірено з input/: ${real.size} імен у файлі клієнта, ${trackedNames.size} у git, ` +
      `${hits.length} перетинів`
  }

  if (problems.length) fail(problems)

  process.stdout.write(`pii-boundary: ${nameCheck}\n`)
  process.stdout.write(
    `pii-boundary: ${SENSITIVE_DIRS.map((d) => `${d}/`).join(' і ')} ігноруються, жодного з ` +
      `${tracked.length} відслідковуваних файлів під ними немає, таблиць немає\n`,
  )
  // The honest residue, restated now that content IS scanned: what this still cannot see.
  process.stdout.write(
    `pii-boundary: УВАГА — сканується вміст на телефони, e-mail та IBAN і звіряються ` +
      `ІМЕНА з input/, але тільки за формою «два-три слова з великої». Прізвище в іншій ` +
      `формі, у транслітерації або всередині довшого рядка не буде знайдене; історія git ` +
      `не читається взагалі, тож те, що вже закомічено раніше, тут не видно; а без input/ ` +
      `(як у CI) звірка з реальним реєстром не відбувається зовсім.\n`,
  )
}

main()
