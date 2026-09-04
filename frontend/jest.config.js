/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // Mapped rather than resolved through node_modules. The workspace symlink
    // would work, but jest's default `transformIgnorePatterns` is
    // `/node_modules/`, and a package whose "build" is its TypeScript source
    // has to be transformed. Pointing at the real files keeps them outside that
    // pattern, so ts-jest compiles them like any other source in the repo.
    '^@soulledger/core$': '<rootDir>/../packages/core/src/index.ts',
    '^@soulledger/core/api$': '<rootDir>/../packages/core/src/api/index.ts',
    '^@soulledger/core/validations$': '<rootDir>/../packages/core/src/validations/index.ts',
    '^@soulledger/core/platform$': '<rootDir>/../packages/core/src/platform/index.ts',
    '^@soulledger/core/messages/(.*)$': '<rootDir>/../packages/core/messages/$1',
    '^@soulledger/core/(.*)$': '<rootDir>/../packages/core/src/$1.ts',
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: [
    'lib/**/*.ts',
    'src/**/*.{ts,tsx}',
    'app/**/*.tsx',
    '!src/**/*.d.ts',
    '!src/__tests__/**',
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
  // AND THE MOVED CODE IS NOW OUTSIDE COVERAGE ACCOUNTING ALTOGETHER. It is
  // still exercised — the suites that tested it still do, through the
  // `@soulledger/core` mappings above — but jest instruments only under
  // `rootDir`. Adding `../packages/core/src/**/*.ts` here was tried and is
  // worse than the gap: jest lists the files and reports them at **0%**,
  // which reads as "this package is untested" when it is not. Recorded rather
  // than papered over; the fix is a coverage run owned by the package itself,
  // and that does not exist yet.
  //
  // Each number is ~1 point below the measured figure, deliberately not flush
  // against it (51.44 -> 51 would leave 0.44 points of room). One new
  // component landing without tests moves these by more than that — branch
  // coverage was observed sliding 20.59 -> 20.34 in a single afternoon — and a
  // gate that cries wolf on ordinary work is a gate someone deletes. One point
  // still catches any real regression: it is ~52 statements or ~50 branches.
  coverageThreshold: {
    global: {
      branches: 46,
      functions: 44,
      lines: 55,
      statements: 54,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
