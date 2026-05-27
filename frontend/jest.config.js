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
    'lib/api.ts',
    'app/**/*.tsx',
    'src/**/*.tsx',
    '!src/**/*.d.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
};
