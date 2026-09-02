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
  //   this pass         statements 51.44 / branches 40.39 / functions 41.00 / lines 51.96
  //
  // The jump came from covering the two WebSocket clients, the event
  // registry, the sidebar-menu gates, the remaining souls/social hooks, and
  // five page components (ledger, welcome, dashboard, workflow,
  // notifications, audit).
  //
  // Each number is ~1 point below the measured figure, deliberately not flush
  // against it (51.44 -> 51 would leave 0.44 points of room). One new
  // component landing without tests moves these by more than that — branch
  // coverage was observed sliding 20.59 -> 20.34 in a single afternoon — and a
  // gate that cries wolf on ordinary work is a gate someone deletes. One point
  // still catches any real regression: it is ~52 statements or ~50 branches.
  coverageThreshold: {
    global: {
      branches: 39,
      functions: 40,
      lines: 51,
      statements: 50,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
