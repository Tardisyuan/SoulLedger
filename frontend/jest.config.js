/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
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
  // --coverage and the numbers were never checked. Measured reality on the day
  // the gate was switched on: statements 30.03 / branches 20.59 / lines 30.01 /
  // functions 19.66. These values sit just under that, so the gate holds today
  // and fails the moment coverage regresses. An aspirational 60 here would only
  // get the gate deleted again. Ratchet these up as coverage climbs; the target
  // is still 60.
  //
  // Each number is ~1 point below the measured figure, deliberately not flush
  // against it (30.03 -> 30 would leave 0.03 points of room). One new
  // component landing without tests moves these by more than that — branch
  // coverage was observed sliding 20.59 -> 20.34 in a single afternoon — and a
  // gate that cries wolf on ordinary work is a gate someone deletes. One point
  // still catches any real regression: it is ~170 statements or ~100 branches.
  coverageThreshold: {
    global: {
      branches: 19,
      functions: 19,
      lines: 29,
      statements: 29,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
