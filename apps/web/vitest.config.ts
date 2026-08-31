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
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
