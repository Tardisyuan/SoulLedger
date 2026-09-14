const path = require('path');

// `coverageThreshold`'s path/glob keys are NOT run through jest's `<rootDir>`
// token substitution (that only applies to a fixed set of config keys —
// `coverageThreshold` isn't one of them, per `jest-config`'s normalize step).
// At threshold-check time jest does its own `path.resolve(thresholdGroup)` —
// resolved against `process.cwd()` at the moment jest runs, not `rootDir` —
// so a relative key means different things depending on whether jest is
// invoked from `frontend/` (via `npm run test:coverage` there) or the repo
// root. Building the key as an already-absolute path here makes that
// `path.resolve()` a no-op, so it means the same thing regardless of cwd.
//
// It also must be a directory PATH, not a glob. Jest's coverageThreshold
// treats the two differently (`@jest/reporters`'s CoverageReporter, THRESHOLD_
// GROUP_TYPES): a PATH key (a literal file/dir prefix, no wildcard) aggregates
// every matching file into one combined summary and checks it once — a GLOB
// key (contains `*`) checks EACH matched file individually against the same
// numbers. Confirmed 2026-09-14: with a `**/*.{ts,tsx}` glob key, files far
// below the aggregate (e.g. an API module at 0% functions) each produced
// their own failure — 26 errors — even though the combined package average
// was above threshold. A bare directory prefix (no glob) matches every file
// under it via a `file.startsWith(prefix)` check and aggregates, matching how
// the frontend `global` threshold already behaves.
const coreCoverageDir = path.resolve(__dirname, '..', 'packages/core/src') + path.sep;

// rootDir sits at the repo root, not at `frontend/`, and that is load-bearing
// for coverage, not cosmetic. Jest only instruments and reports on files
// under `rootDir`; `packages/core` is a sibling of `frontend`, so with
// rootDir at `frontend/` its code could never appear in a coverage report no
// matter what `collectCoverageFrom` named — confirmed 2026-09-14 by pointing
// `collectCoverageFrom` at `../packages/core/src/**` from the old rootDir:
// the numbers did not move and no core file appeared. Almost all of core's
// own logic (hooks, API modules) is exercised by *this* jest run via the
// `@soulledger/core` mappings below — vitest in `packages/core` only covers
// the ~7 files it has its own tests for. Moving rootDir up and adding
// `roots: ['<rootDir>/frontend']` (so test discovery still only walks
// `frontend/`) makes that existing coverage visible instead of manufacturing
// new tests for it.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: path.resolve(__dirname, '..'),
  roots: ['<rootDir>/frontend'],
  // Without this, `--coverage` writes to the new rootDir's default
  // `<rootDir>/coverage`, i.e. the repo root — untracked and outside every
  // `.gitignore` rule (`frontend/.gitignore` only covers `frontend/coverage/`).
  // Kept at its pre-move location.
  coverageDirectory: '<rootDir>/frontend/coverage',
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/frontend/$1',
    // Mapped rather than resolved through node_modules. The workspace symlink
    // would work, but jest's default `transformIgnorePatterns` is
    // `/node_modules/`, and a package whose "build" is its TypeScript source
    // has to be transformed. Pointing at the real files keeps them outside that
    // pattern, so ts-jest compiles them like any other source in the repo.
    '^@soulledger/core$': '<rootDir>/packages/core/src/index.ts',
    '^@soulledger/core/api$': '<rootDir>/packages/core/src/api/index.ts',
    '^@soulledger/core/validations$': '<rootDir>/packages/core/src/validations/index.ts',
    '^@soulledger/core/platform$': '<rootDir>/packages/core/src/platform/index.ts',
    '^@soulledger/core/messages/(.*)$': '<rootDir>/packages/core/messages/$1',
    '^@soulledger/core/(.*)$': '<rootDir>/packages/core/src/$1.ts',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: [
    '<rootDir>/frontend/**/__tests__/**/*.test.ts',
    '<rootDir>/frontend/**/__tests__/**/*.test.tsx',
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/frontend/tsconfig.json' }],
  },
  // `components/**` and `middleware.ts` were missing until 2026-09-14 (audit
  // FT-10) — both inside rootDir, so unlike packages/core (see below) nothing
  // stopped them being measured; they were simply never named. That is eleven
  // shared primitives, data-table and data-grid among them, and the route gate
  // every request passes through. `app/**/*.ts` picks up `app/fonts.ts`.
  // (The audit also named `hooks/`: there is no top-level `hooks/` directory;
  // `src/hooks/**` is already covered by `src/**`.)
  collectCoverageFrom: [
    '<rootDir>/frontend/lib/**/*.ts',
    '<rootDir>/frontend/src/**/*.{ts,tsx}',
    '<rootDir>/frontend/app/**/*.{ts,tsx}',
    '<rootDir>/frontend/components/**/*.{ts,tsx}',
    '<rootDir>/frontend/middleware.ts',
    '!<rootDir>/frontend/src/**/*.d.ts',
    '!<rootDir>/frontend/src/__tests__/**',
    // Core's own source, added now that rootDir can see it (see the note
    // above). Excludes mirror packages/core/vitest.config.ts's own excludes.
    '<rootDir>/packages/core/src/**/*.{ts,tsx}',
    '!<rootDir>/packages/core/src/**/__tests__/**',
    '!<rootDir>/packages/core/src/api/generated/**',
  ],
  // Baseline lock, not a target. This threshold was 60 across the board while
  // nothing ever ran it — `npm test` was bare `jest`, so CI never passed
  // --coverage and the numbers were never checked. An aspirational 60 here
  // would only get the gate deleted again. Ratchet these up as coverage
  // climbs; the target is still 60.
  //
  // History of measured coverage, each entry the reading taken when these
  // numbers were last moved:
  //   gate switched on  statements 30.03 / branches 20.59 / functions 19.66 / lines 30.01
  //   two passes ago    statements 51.44 / branches 40.39 / functions 41.00 / lines 51.96
  //   this pass         statements 56.90 / branches 46.80 / functions 48.92 / lines 57.55
  //
  // The 30 -> 51 jump came from covering the two WebSocket clients, the event
  // registry, the sidebar-menu gates, the remaining souls/social hooks, and
  // five page components (ledger, welcome, dashboard, workflow,
  // notifications, audit).
  //
  // THE 51 -> 57 JUMP IS NOT COVERAGE IMPROVING. Nothing was tested that was
  // not tested the day before; `lib/api`, `lib/ws`, `lib/validations`,
  // `src/config` and `lib/query_keys` moved to `packages/core`, and
  // `collectCoverageFrom` below is resolved against `rootDir`, so those ~5,200
  // lines simply left the denominator. The measurement is of a smaller and
  // better-covered set. Ratcheted anyway, because the alternative is a gate
  // sitting seven points below the real number — which is the same slack this
  // file argues against two paragraphs down.
  //
  // AND IT CAN MOVE THE OTHER WAY, WHICH IS WHAT HAPPENED NEXT. The six souls /
  // social / judgment hooks moved to `packages/core/src/hooks` once `notify`
  // took a message key and `useI18n` left them. Those files were among the
  // best-covered in the tree — six dedicated suites, all of which still run —
  // so taking them out of the denominator pulled the average DOWN rather than
  // up:
  //
  //   before the move   statements 57.68 / branches 48.74 / functions 49.78 / lines 58.32
  //   after the move    statements 55.53 / branches 48.30 / functions 45.84 / lines 56.09
  //
  // Nothing stopped being tested between those two readings; 2137 tests pass on
  // both sides of it. The four numbers below are lowered to sit ~1 point under
  // the second reading, which is a real loss of accounting and is recorded here
  // rather than hidden by leaving a threshold nobody can meet. Branches is left
  // at 46 — it did not move enough to need touching, and lowering a number that
  // still holds would be slack for its own sake.
  //
  // AND THE MOVED CODE WAS OUTSIDE COVERAGE ACCOUNTING ALTOGETHER, FOR A
  // WHILE. It was still exercised — the suites that tested it still ran,
  // through the `@soulledger/core` mappings above — but jest instruments only
  // under `rootDir`, and `rootDir` was `frontend/` back then. Adding
  // `../packages/core/src/**/*.ts` to `collectCoverageFrom` from that rootDir
  // was tried and did nothing: jest never even listed the files, because a
  // path outside `rootDir` isn't reachable by a `<rootDir>`-relative glob no
  // matter what the glob says. That is fixed now — see the note at the top of
  // this file: `rootDir` moved to the repo root on 2026-09-14 specifically so
  // `collectCoverageFrom` could name `packages/core/src/**` and have it count.
  // A separate path-keyed threshold for it lives below the global one.
  //
  // Each number is ~1 point below the measured figure, deliberately not flush
  // against it (51.44 -> 51 would leave 0.44 points of room). One new
  // component landing without tests moves these by more than that — branch
  // coverage was observed sliding 20.59 -> 20.34 in a single afternoon — and a
  // gate that cries wolf on ordinary work is a gate someone deletes. One point
  // still catches any real regression: it is ~52 statements or ~50 branches.
  //
  // AND THE a11y ENGINE MOVED THEM UP, WITHOUT ANYONE WRITING AN ASSERTION
  // ABOUT COVERAGE. `src/__tests__/a11yEngineBaseline.test.tsx` renders 29
  // subjects — every shared primitive, four hand-rolled surfaces and three
  // whole routes — so that axe can walk the DOM they produce. Rendering them
  // executes them, and the four numbers moved together:
  //
  //   before that suite  statements 55.53 / branches 48.30 / functions 45.84 / lines 56.09
  //   after it           statements 60.54 / branches 52.90 / functions 51.19 / lines 61.18
  //
  // Unlike the 51 -> 57 jump above, this one is real: nothing left the
  // denominator, 34 new tests joined the run, and the numerator grew because
  // code that had never been rendered now is. Ratcheted to ~1 point under, per
  // the rule two paragraphs down.
  //
  // AND THEN IT SAT TEN POINTS BELOW THE REAL NUMBER. The four values stayed at
  // 59/51/50/60 while the suite grew to 153 suites / 2805 tests. Measured
  // 2026-09-14 on `91c698d`, `npm run test:coverage`, exit 0:
  //
  //   statements 69.07 / branches 60.69 / functions 59.38 / lines 69.95
  //
  // Ratcheted to measured minus 2, rounded down (the user's call for this
  // pass — 2 rather than the ~1 above, for the same reason given there: a gate
  // that fails on ordinary work gets deleted). Ten points of slack was a
  // gate that could not have caught anything smaller than a thousand lines of
  // untested code.
  //
  // MOVING rootDir TO THE REPO ROOT (2026-09-14, branched from `45c4c20` —
  // not the `91c698d` the 2805-test reading above was taken on, a different
  // branch point, so the two test counts below aren't directly comparable)
  // DID NOT MOVE THE GLOBAL NUMBERS BEYOND ORDINARY NOISE. `roots:
  // ['<rootDir>/frontend']` keeps test discovery unchanged, and `global` here
  // still means "every file collectCoverageFrom names that isn't claimed by a
  // more specific key below" — core now has its own key, so it is carved out
  // of `global` rather than folded into it. Measured with the config in this
  // file, `npm run test:coverage` from `frontend/`, exit 0, 153 suites / 2810
  // passed:
  //
  //   frontend (global)  statements 69.11 / branches 60.78 / functions 59.50 / lines 69.98
  //   packages/core       statements 83.44 / branches 76.65 / functions 68.10 / lines 84.39
  //
  // The frontend figure sits within a few hundredths of the 69.07/60.69/
  // 59.38/69.95 reading above (this branch carries a handful of commits the
  // other one doesn't) — the rootDir move itself did not shift it, so
  // `global` below is left untouched at measured-minus-2. Core's threshold is
  // set the same way, minus 2 rounded down: 83->81 / 76->74 / 68->66 / 84->82.
  coverageThreshold: {
    global: {
      branches: 58,
      functions: 57,
      lines: 67,
      statements: 67,
    },
    // Keyed by directory path (see the note above `coreCoverageDir`) — see
    // https://jestjs.io/docs/configuration#coveragethreshold-object. Files
    // under this path are excluded from `global` above, not double-counted.
    [coreCoverageDir]: {
      branches: 74,
      functions: 66,
      lines: 82,
      statements: 81,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/frontend/jest.setup.js'],
};
