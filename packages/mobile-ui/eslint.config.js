const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["node_modules/**", "ios/**", "android/**", ".expo/**", "dist/**"],
  },
  {
    files: ["*.config.js"],
    languageOptions: { globals: { __dirname: "readonly", require: "readonly", module: "writable" } },
  },
]);
