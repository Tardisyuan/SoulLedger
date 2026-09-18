const path = require("path");

// The React this workspace resolves, wherever npm put it. Until the web admin
// moved to React 19 (feat/react-19) that was mobile/node_modules/react; now all
// three workspaces declare 19.2.3 and npm hoists one copy to the repo root, so a
// hard-coded mobile/node_modules path points at nothing.
const reactDir = path.dirname(require.resolve("react/package.json", { paths: [__dirname] }));

module.exports = {
  preset: "jest-expo",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  setupFiles: ["<rootDir>/jest.setup.js"],
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
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@soulledger/.*|axios))",
  ],
};
