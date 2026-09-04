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
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/api/generated/**"],
  },
});
