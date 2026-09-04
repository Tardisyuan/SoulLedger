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
    // `src/api/generated/**` is openapi-typescript's output. Linting it would
    // report on a file nobody edits and whose only correct fix is upstream —
    // and every finding would come back on the next `schema:generate`. It is
    // still type-checked, which is the part that matters: `npx tsc` compiles it
    // along with everything that imports it.
    ignores: ["node_modules/**", "src/api/generated/**"],
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
      // No build-time environment variables in a platform-independent package.
      //
      // WHY LINT AND NOT THE TYPE BOUNDARY. The `lib: ["ES2020"]` narrowing
      // above is what keeps `document` and `localStorage` out, and the header
      // of this file explains why that job belongs to tsc. It cannot do this
      // one: `process.env` is not a DOM global, so the "no DOM" boundary had
      // nothing to say about it, and three modules read
      // `process.env.NEXT_PUBLIC_API_URL` — a *Next.js* variable — with a
      // `http://localhost:8000` fallback. Expo defines no `NEXT_PUBLIC_*` and
      // Tauri reads `import.meta.env.VITE_*`, so both would have taken that
      // fallback in silence, and on a phone `localhost` is the phone.
      //
      // A host capability reaches this package through `PlatformAdapter`. The
      // API base URL is one, so it is a port (`baseUrl`), and the web build
      // supplies `NEXT_PUBLIC_API_URL` to it from `frontend/lib/platform/web.ts`.
      // THE PRIMARY GUARD IS NOW THE TYPE, NOT THIS RULE. `process` is no
      // longer declared in `src/platform/host-globals.d.ts`, so every spelling
      // of it is a compile error, and `src/platform/__tests__/nodeGlobals.test.ts`
      // holds that. This rule is kept as the second line because a lint message
      // says *why* at the point of writing, where `Cannot find name 'process'`
      // does not — and because someone re-adding the declaration should still
      // meet a refusal here.
      //
      // The selector is the whole identifier and not `process.env`, after
      // mutation-testing the narrower form against this config:
      // `process.env.X`, `process["env"].X` and `import.meta.env` were caught,
      // but `process["env"].X` only by accident of spelling, and
      // `const { env } = process`, `const p = process; p.env.X` and
      // `globalThis.process.env.X` were not caught at all. Chasing member
      // expressions is chasing shapes; the name is the thing. (Only the
      // destructuring form is a plausible accident. The rest are contortions —
      // but a guard whose coverage depends on nobody contorting is the shape
      // this repository keeps rediscovering.)
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name='process']",
          message:
            "`process` is a host concern. @soulledger/core must not read " +
            "build-time environment variables — Expo and Tauri do not define " +
            "the same ones, and the fallback fails silently. Add a field to " +
            "PlatformAdapter (src/platform/types.ts) and let each host supply it. " +
            "(The name is not declared in host-globals.d.ts either, so this is " +
            "also a type error; this rule exists to say why.)",
        },
        {
          selector: "MetaProperty[meta.name='import'][property.name='meta']",
          message:
            "`import.meta.env` is a bundler-specific host concern, for the " +
            "same reason as `process.env`. Use a PlatformAdapter field.",
        },
      ],
    },
  },
];
