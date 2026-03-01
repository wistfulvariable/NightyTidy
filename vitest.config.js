// Coverage thresholds for CI — fail the build if coverage drops below these.
// This is the only vitest config; all other settings use defaults.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 80,
      },
    },
  },
});
