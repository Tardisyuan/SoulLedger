const path = require("path");

// The React this workspace resolves, wherever npm put it. Until the web admin
// moved to React 19 (feat/react-19) that was mobile/node_modules/react; now all
// three workspaces declare 19.2.3 and npm hoists one copy to the repo root, so a
// hard-coded mobile/node_modules path points at nothing.
const reactDir = path.dirname(require.resolve("react/package.json", { paths: [__dirname] }));

module.exports = {
  // Half the cores, not jest"s default of cores-1: seven workers filled all
  // eight cores of the dev machine and pushed its 16 GB into swap (2026-10-19).
  // JEST_WORKERS overrides; `-w` on the command line still wins over both.
  maxWorkers: process.env.JEST_WORKERS || "50%",
  workerIdleMemoryLimit: "1GB",
  // In node_modules, not the OS temp dir (2026-10-30): on the gate box TMPDIR is /sl-tmp, emptied of files
  // older than a day, so the first run each day transformed everything again. rsync keeps node_modules/
  // (scripts/run-gates.sh).
  cacheDirectory: "<rootDir>/node_modules/.cache/jest",
  preset: "jest-expo",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  // AfterEnv, not setupFiles: the act guard at the bottom needs afterEach.
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  // Coverage floor (review 2026-10-31 C22): evaluated only with --coverage (`npm run test:coverage`), like the web's.
  // The denominator is every source file under src/, not just the ones a test loads (the shared soul-app code
  // it imports from ../mobile is counted there, not here). Measured on unRAID 2026-10-31 (1034 tests): statements
  // 87.72 / branches 80.59 / functions 80.68 / lines 89.59. Ratchet: about two points under the reading; raise it
  // when the reading rises, never lower it to make a red run green.
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/__tests__/**"],
  coverageDirectory: "<rootDir>/node_modules/.cache/coverage",
  coverageThreshold: { global: { statements: 85, branches: 78, functions: 78, lines: 87 } },
  // Above the 5 s findBy/waitFor budget set in jest.setup.js, so a miss fails on its own message.
  testTimeout: 15_000,
  // One React for the whole run — the one this workspace resolves — so a
  // hoisted package can never pick up a different copy; see metro.config.js.
  moduleNameMapper: {
    "^react$": reactDir,
    "^react/(.*)$": `${reactDir}/$1`,
  },
  // Hoisted packages (e.g. @react-navigation/core) look for react-native from
  // the repo root, where it is not installed.
  modulePaths: [path.join(__dirname, "node_modules")],
  // jest-expo transforms only an allow-list of node_modules; @soulledger/core is
  // TypeScript source reached through a symlink, and axios ships ESM.
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@soulledger/.*|@gorhom/.*|axios))",
  ],
};
