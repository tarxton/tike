import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Vitest needs the `@/` alias spelled out; it does not read tsconfig `paths`.
 *
 * Without it, any test that reaches a component fails at import — the component's own
 * `@/lib/...` imports are unresolvable — which looks like a broken test rather than a
 * missing config line.
 */
export default defineConfig({
  test: {
    /*
     * The Playwright suite is not Vitest's.
     *
     * `e2e/*.spec.ts` matches Vitest's default include, and `test.describe` from
     * @playwright/test throws the moment it is called outside the Playwright runner — so
     * `pnpm test` failed five files with "Playwright Test did not expect test.describe()
     * to be called here" while every real unit test passed. Two runners, two directories.
     */
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '.open-next/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
