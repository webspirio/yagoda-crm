#!/usr/bin/env node
/**
 * The memo's proves/does-not-prove table must match the registry exactly.
 *
 * Drift between those two artifacts is a defect in the one pair whose entire job is
 * honesty: if CLAUDE.md claims a check proves something it no longer proves, the memo has
 * become the false-confidence artifact it was written to remove. So the table is
 * generated, not written, and this check compares it byte for byte.
 *
 * `--write` regenerates the region between the markers in CLAUDE.md.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { CHECKS } from '../registry.mjs'

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const MEMO = path.join(ROOT, 'CLAUDE.md')

const BEGIN = '<!-- BEGIN:verify-table -->'
const END = '<!-- END:verify-table -->'

/**
 * Escaped for a markdown table cell.
 *
 * Throws on an embedded marker: `indexOf(END)` would find the injected copy instead of the
 * real one, `--write` would append another marker every run and never converge.
 *
 * @param {string} s
 * @returns {string}
 */
function cell(s) {
  if (s.includes('BEGIN:verify-table') || s.includes('END:verify-table')) {
    throw new Error(`рядок registry містить маркер таблиці — це зламало б CLAUDE.md: ${s.slice(0, 60)}`)
  }
  return s.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

/** @returns {string} */
function renderTable() {
  const lines = [
    BEGIN,
    '<!-- Згенеровано з scripts/verify/registry.mjs. Руками не правити:',
    '     перевірка `memo` порівнює цей блок побайтово і падає на розбіжності.',
    '     Щоб змінити текст — правити registry.mjs, потім',
    '     `node scripts/verify/checks/memo-drift.mjs --write`. -->',
    '',
    '| перевірка | рівень | що доводить | чого НЕ доводить |',
    '| --- | --- | --- | --- |',
  ]
  for (const c of CHECKS) {
    const needs = c.needs ? ` (потребує: ${cell(c.needs)})` : ''
    const after = c.after?.length ? ` (після: ${cell(c.after.join(', '))})` : ''
    lines.push(
      `| \`${c.id}\` | ${c.tier}${needs}${after} | ${cell(c.proves)} | ${cell(c.blindSpot)} |`,
    )
  }
  // A checksum over the RAW strings. cell() collapses whitespace, so two different registry
  // strings could render to one identical table cell and the "byte-for-byte" claim would
  // hold of the table while the registry had changed underneath it.
  const raw = CHECKS.map(
    (c) => `${c.id}\u0000${c.tier}\u0000${c.needs ?? ''}\u0000${(c.after ?? []).join(',')}\u0000${c.proves}\u0000${c.blindSpot}`,
  ).join('\u0001')
  lines.push('', `<!-- registry-checksum: ${createHash('sha256').update(raw).digest('hex').slice(0, 32)} -->`)
  lines.push(END)
  return lines.join('\n')
}

function main() {
  const write = process.argv.includes('--write')
  let memo
  try {
    memo = readFileSync(MEMO, 'utf8')
  } catch {
    process.stderr.write(`memo: ЧЕРВОНО\n  немає ${path.relative(ROOT, MEMO)}\n`)
    process.exit(1)
  }

  const start = memo.indexOf(BEGIN)
  const end = memo.indexOf(END)
  if (start === -1 || end === -1 || end < start) {
    process.stderr.write(
      `memo: ЧЕРВОНО\n  у CLAUDE.md немає маркерів ${BEGIN} … ${END}.\n` +
        `  Без них таблиця не може бути згенерованою, а отже не може не розійтися з registry.\n`,
    )
    process.exit(1)
  }

  const current = memo.slice(start, end + END.length)
  const expected = renderTable()

  if (write) {
    if (current === expected) {
      process.stdout.write('memo: таблиця вже актуальна\n')
      return
    }
    writeFileSync(MEMO, memo.slice(0, start) + expected + memo.slice(end + END.length))
    process.stdout.write(`memo: таблицю перегенеровано (${CHECKS.length} рядків)\n`)
    return
  }

  if (current !== expected) {
    // Show the first differing line: a whole-table diff is unreadable and gets skimmed.
    const a = current.split('\n')
    const b = expected.split('\n')
    let i = 0
    while (i < Math.max(a.length, b.length) && a[i] === b[i]) i += 1
    process.stderr.write(
      `memo: ЧЕРВОНО\n` +
        `  Таблиця у CLAUDE.md розійшлася з scripts/verify/registry.mjs (рядок ${i + 1}).\n` +
        `  у CLAUDE.md: ${a[i] ?? '(немає рядка)'}\n` +
        `  у registry:  ${b[i] ?? '(немає рядка)'}\n` +
        `  Полагодити: node scripts/verify/checks/memo-drift.mjs --write\n`,
    )
    process.exit(1)
  }

  process.stdout.write(
    `memo: таблиця «доводить / не доводить» збігається з registry — ${CHECKS.length} рядків\n`,
  )
}

main()
