// Coverage thresholds for CI — fail the build if coverage drops below these.
import { defineConfig } from 'vitest/config';

// Vite's built-in shebang stripping doesn't handle \r\n (Windows line endings).
// dashboard-tui.js has a shebang and CRLF, causing "Invalid or unexpected token".
function stripShebang() {
  return {
    name: 'strip-shebang',
    transform(code, id) {
      if (code.startsWith('#!')) {
        return code.replace(/^#!.*\r?\n/, '');
      }
    },
  };
}

export default defineConfig({
  plugins: [stripShebang()],
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
