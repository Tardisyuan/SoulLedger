const path = require("path");

const here = (p) => path.join(__dirname, "node_modules", p);

module.exports = {
  preset: "jest-expo",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  setupFiles: ["<rootDir>/jest.setup.js"],
  // One React for the whole run; see metro.config.js for why the root copy
  // (18.3.1, the web admin's) must never be picked up here.
  moduleNameMapper: {
    "^react$": here("react"),
    "^react/(.*)$": here("react/$1"),
  },
  // Hoisted packages (e.g. @react-navigation/core) look for react-native from
  // the repo root, where it is not installed.
  modulePaths: [path.join(__dirname, "node_modules")],
  // jest-expo transforms only an allow-list of node_modules; @soulledger/core is
  // TypeScript source reached through a symlink, and axios ships ESM.
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@soulledger/.*|axios))",
  ],
};
