import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
// The built app is served under its production base path, because a smoke test at `/`
// would pass on an artifact whose asset URLs are all wrong on GitHub Pages.
const BASE = `http://127.0.0.1:${PORT}/yagoda-crm/`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  // No retries, deliberately. A retry turns a flaky red into a green and this whole
  // layer exists to stop that.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    // The full Chromium build, not the headless shell — so the binary this runs is
    // exactly the one the registry's `playwright-browser` precondition probes for.
    // A probe that checks a different file than the run uses turns an absent browser
    // into FAILED instead of SKIPPED.
    channel: 'chromium',
  },
  webServer: {
    // `vite preview` serves ./dist — it never builds. The registry encodes that with
    // `after: ['build']`, so a stale or absent dist is NOT_RUN, not a mystery failure.
    // `npm run preview` carries the --base flag itself, so this and a human running the
    // preview get the identical artifact. The flag is not optional: vite.config.ts sets
    // `base` only when `command === 'build'`, and `vite preview` runs as `serve`, so
    // without it dist/index.html asks for /yagoda-crm/assets/... while the server answers
    // from / — every asset 404s into a blank page. This smoke row is what surfaced that.
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    // Never reuse. A server already on the port was started with flags this config
    // does not know — that is how a smoke test ends up validating a different artifact
    // than the one just built, and reporting green for it.
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
