import { defineConfig } from "vitest/config";

/**
 * Test runner for `@soulledger/core`.
 *
 * There is exactly one thing to configure and it is `environment`. The default
 * is `node`, which is what this package needs and is also the only honest
 * choice: a `jsdom` environment would hand every test a `document`, `window`
 * and `localStorage`, and this package's entire reason to exist is that it
 * must run where those do not. A test suite whose harness supplies the very
 * globals the package forbids can pass while the package is broken on a phone.
 * It is set explicitly rather than left to the default so that switching it is
 * a visible edit with this comment attached, not a silent default change.
 *
 * `include` is narrowed to `src/**` so the runner never walks `node_modules`
 * or the openapi-typescript output in `src/api/generated/`.
 *
 * No `globals: true`: `describe` / `it` / `expect` are imported from "vitest"
 * in each test file. That keeps the files readable by tsc under this package's
 * `types: []` tsconfig without adding an ambient types entry, which is the
 * same boundary argument the package is built on.
 *
 * COVERAGE (`npm run test:coverage`; the pre-push hook and CI run that, not
 * bare `test`). `coverage.include` names every source file, not only the ones
 * a test imports — without it v8 reports on loaded files alone and an untested
 * module simply is not in the denominator. The numbers are therefore LOW, and
 * that is the honest reading: most of this package (the hooks, the API
 * modules) is exercised by the frontend's jest suites through the
 * `@soulledger/core` mapping, and jest instruments nothing outside its
 * `rootDir` (see the long note in `frontend/jest.config.js`). This gate
 * measures what *this package's own* tests reach.
 *
 * Measured 2026-09-14 (7 files / 34 tests):
 *   statements 11.15 / branches 9.14 / functions 6.86 / lines 11.73
 * Thresholds are measured minus 2, rounded down — a floor that catches a real
 * regression without failing on ordinary work. Ratchet up as tests land.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/api/generated/**"],
    coverage: {
      provider: "v8",
      // text-summary only: no report directory is written into the package.
      reporter: ["text-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/api/generated/**", "src/**/*.test.ts", "src/**/*.d.ts"],
      thresholds: {
        statements: 9,
        branches: 7,
        functions: 4,
        lines: 9,
      },
    },
  },
});
