import { defineConfig } from 'vitest/config'
import { configDefaults } from 'vitest/config'

/**
 * Coverage floors are read from the environment because they are enforced in exactly
 * one place — `.github/workflows/verify.yml`. Locally the floor is 0 and the number is
 * reported, so a 1% wobble on a laptop cannot teach anyone to route around the gate.
 * Lowering a floor is therefore a visible diff in the enforcing workflow file.
 */
function floor(name: string): number {
  const raw = process.env[name]
  const missing = raw === undefined || raw.trim() === ''
  // Under CI a missing floor is a broken gate, not a floor of zero. Deleting the env block
  // from verify.yml, or typing a variable name wrong, previously turned coverage gating off
  // while the run stayed green — the loudest possible claim in this repo failing silently.
  if (process.env.CI && missing) {
    throw new Error(
      `${name} не задано, а CI встановлено. Пороги покриття живуть у ` +
        `.github/workflows/verify.yml; без них перевірка coverage нічого не вимагає, ` +
        `і зелений результат був би неправдою.`,
    )
  }
  if (missing) return 0
  const n = Number(raw)
  // A non-numeric value yields NaN, and every threshold comparison against NaN passes.
  if (!Number.isFinite(n)) {
    throw new Error(`${name}=${JSON.stringify(raw)} не число — поріг став би NaN, а NaN проходить завжди.`)
  }
  return n
}

export default defineConfig({
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    // Explicit, not inherited: the default include also matches `e2e/*.spec.ts`, which
    // Playwright owns. `test:files` asserts every test file is claimed by exactly one
    // runner, so this pair cannot silently drop a file the way a narrow glob would.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'e2e/**', 'dist/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'lcov'],
      reportsDirectory: './coverage',
      // `include` is what pulls the 41 untested .tsx files into the report. Without them
      // a table of covered lib files would read as full coverage. (vitest 4 removed the
      // old `coverage.all` flag; `include` now carries that behaviour on its own —
      // verified: the report counts 868 .tsx lines at 0%.)
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/components/ui/**', // vendored shadcn primitives
      ],
      thresholds: {
        'src/lib/**': {
          lines: floor('COVERAGE_LIB_LINES'),
          branches: floor('COVERAGE_LIB_BRANCHES'),
          functions: floor('COVERAGE_LIB_FUNCTIONS'),
          statements: floor('COVERAGE_LIB_STATEMENTS'),
        },
      },
    },
  },
})
