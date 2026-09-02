import tsPlugin from "@typescript-eslint/eslint-plugin";
import eslintParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

/**
 * Lint for `@soulledger/core`.
 *
 * WHY A SECOND CONFIG AND NOT THE FRONTEND'S. Moving 5,196 lines out of
 * `frontend/` took them out of `eslint .` — ESLint's flat config refuses to
 * lint files outside its own base path, so `eslint . ../packages/core/src`
 * exits 2 with "all of the files matching the glob are ignored". Left alone,
 * that is a check quietly covering less than it did the day before, which is
 * this repository's most-recorded failure mode. So the coverage is restored
 * here rather than lost silently.
 *
 * It is deliberately NOT a copy of `frontend/eslint.config.mjs`. That file is
 * almost entirely the Stage 11 design-system guard — spacing steps, type scale,
 * corner radii, `text-[hsl(var(--color-*))]` spelling — enforced against
 * `className` strings. There are no class names in this package and there never
 * will be; importing those rules would add ~500 lines of guard that can only
 * ever pass, and a rule that cannot fail is worse than no rule because it reads
 * like coverage.
 *
 * What is left is what actually applies here: the TypeScript hygiene rules, and
 * the React hooks rules for the one hook and one form helper that live in
 * `src/hooks` and `src/validations`.
 *
 * The boundary this package exists to hold — no `document`, no `window`, no
 * `localStorage` — is NOT enforced here. It is enforced by `tsconfig.json`'s
 * `lib: ["ES2020"]` and the allowlist in `src/platform/host-globals.d.ts`,
 * because a type error is not something a lint disable-comment can wave through.
 */
export default [
  {
    ignores: ["node_modules/**"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: eslintParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      // `_` is this repository's discard marker — `frontend/eslint.config.mjs`
      // says so in as many words ("argsIgnorePattern 放行按约定写的 `_` 前缀")
      // while switching the rule off wholesale for the web tree, with a recorded
      // reason: turning it on there would have been a mass rewrite. This package
      // is small and already clean, so the rule stays ON here and the convention
      // is spelled out rather than the rule being switched off. Being stricter
      // than the web tree is deliberate; being stricter by accident, and forcing
      // edits to the two `const { [k]: _, ...rest }` omissions in
      // `validations/useFormValidation.ts`, would not be.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // `no-undef` is off for TypeScript on purpose: tsc already resolves every
      // identifier, and it does it against this package's deliberately narrow
      // `lib`. ESLint has no idea which globals are allowed here, so it would
      // report `WebSocket` and miss `document` — exactly backwards.
      "no-undef": "off",
    },
  },
];
