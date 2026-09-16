import { defineConfig, devices } from '@playwright/test';
import { loadRepoEnv } from './e2e/support/env';

/**
 * End-to-end tests for the site.
 *
 * §11 of the plan lists a Playwright walk — search, size filter, product page, outclick
 * — as a launch gate, and it was the last gate with nothing behind it: `pnpm e2e` ran
 * `playwright test` against a package that had no Playwright and no tests, which exits 0.
 * A green command that asserts nothing is worse than a missing one.
 *
 * These run against a real catalogue rather than a fixture database. That is a deliberate
 * trade and it shapes every test here:
 *
 *   - The read path is the Neon HTTP driver (ADR-0001), which speaks Neon's SQL-over-HTTP
 *     protocol and cannot be pointed at a plain Postgres. Seeding a local database would
 *     mean either a proxy container — and there is no Docker on the development machine
 *     by design — or a second driver in `packages/db` that production never uses. Testing
 *     the code path that ships is worth more than testing a parallel one.
 *   - So no test may assert a value the crawl can change. Prices, names and stock are
 *     rewritten nightly; what survives is invariants — every card the size filter returns
 *     claims that size, shops list cheapest first, the outclick logs the click it
 *     redirects. Those are the product's actual promises.
 *   - Which case to use is discovered from the catalogue instead of hardcoded, and a case
 *     the catalogue cannot supply skips loudly rather than passing quietly. A test that
 *     cannot fail is the failure mode this suite exists to avoid.
 */
loadRepoEnv();

const PORT = Number(process.env.E2E_PORT ?? 3100);

/** Point at a deployment to run the same suite as a smoke test. */
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Every assertion here waits on a server-rendered page that queries Neon over HTTPS,
  // and a cold branch takes a moment to wake.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // One retry on CI, none locally. The suite reads a live catalogue, so a crawl landing
  // mid-run can move a row under a test; a failure that repeats twice is ours.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    // Phone-only breakage has slipped through desktop-only checks twice — the sort
    // `<select>` that navigated off a moving wheel picker, and a brand strip whose scroll
    // affordance was invisible. WebKit on an iPhone profile is the browser those bugs
    // were in, so it is the second project rather than a narrow Chrome.
    { name: 'mobile', use: { ...devices['iPhone 13'] } },
  ],

  webServer: external
    ? undefined
    : {
        // Production mode, not `next dev`. Dev serves its client chunks only to the
        // origin it was started on and behaves differently around caching; a suite that
        // passes there says nothing about what is deployed.
        command: `pnpm exec next start --port ${PORT}`,
        // Not the homepage: this URL is answered only once the database is reachable, so
        // the wait covers the thing every test depends on.
        url: `${baseURL}/patike`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
