/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  collectCoverageFrom: [
    'lib/api.ts',
    'app/**/*.tsx',
    'src/**/*.tsx',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
