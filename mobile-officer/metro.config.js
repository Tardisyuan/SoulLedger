// Expo's default config already understands npm workspaces (watchFolders and
// nodeModulesPaths cover the repo root, so `@soulledger/core` resolves).
//
// WHAT IT DOES NOT DO: keep one React. The web admin pins react 18.3.1, which
// npm hoists to the repo root; this app needs 19.2.3, which lands in
// mobile/node_modules. Packages that npm hoisted beside the old copy
// (`@react-navigation/core`, `use-sync-external-store`) would `require("react")`
// from the root and get 18 — two Reacts in one bundle, "Invalid hook call" at
// the first render. So every `react` / `react/*` request is answered from this
// workspace, whoever asks. `jest.config.js` does the same for tests.
//
// UPDATE 2026-09-19 (feat/react-19): the web admin is on 19.2.3 too, and npm
// now hoists a single React to the root — the split above no longer exists.
// The resolver stays because it is layout-agnostic (`require.resolve` from
// here finds the root copy just as well) and brings the guarantee back for
// free if the versions ever diverge again.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const pinned = /^react(\/.*)?$/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (pinned.test(moduleName)) {
    return { type: "sourceFile", filePath: require.resolve(moduleName, { paths: [__dirname] }) };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
