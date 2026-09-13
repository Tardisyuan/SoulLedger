import { describe, expect, it } from "vitest";
import ts from "typescript";

/**
 * `src/api/generated/schema.ts` MUST BE WHAT `schema:generate` MAKES FROM THE
 * COMMITTED `openapi/schema.yml` — byte for byte.
 *
 * The backend test `test_committed_schema_matches_the_backend.py` pins the YAML
 * to the serializers. Its TypeScript half only checked that every component
 * *name* appears in the .ts (audit BT-08, 2026-09-12): add a field to a
 * serializer, regenerate the YAML, forget `schema:generate`, and both files'
 * component sets still match — the frontend compiles against a type without
 * the field, and every gate is green.
 *
 * It lives here rather than in that Python file because this is where the
 * toolchain is: the comparison is "run the generator, compare the output", and
 * the generator is a node package. This runs in `npm run --workspace
 * packages/core test`, which `.git/hooks/pre-push` runs on any `^packages/`
 * change — and a regenerated YAML *is* a `packages/` change — and which CI runs.
 *
 * Same call the CLI makes (`bin/cli.js` → `generateSchema`): COMMENT_HEADER +
 * astToString(openapiTS(schema)), with no flags, matching the `schema:generate`
 * script. Measured 2026-09-14: the CLI's output and the committed file `cmp`
 * equal, so a red here is drift, not formatting.
 *
 * Files are read through `ts.sys` for the reason `domBoundary.test.ts` gives:
 * this package's tsconfig has `types: []`, so `node:fs` has no types here.
 *
 * WHY THE GENERATOR IS IMPORTED THROUGH A VARIABLE. A static
 * `import openapiTS from "openapi-typescript"` puts its `index.d.ts` into the
 * tsc program, and that file imports `node:stream` / `node:fs` — which drags
 * all of `@types/node` in. Measured 2026-09-14: with the static import,
 * `nodeGlobals.test.ts` goes red listing `process`, `Buffer`, `require`, …
 * as resolvable across the whole package. A non-literal specifier keeps the
 * generator's types out of the program; the three names used are typed below.
 */

type Generator = {
  default: (schema: string) => Promise<unknown>;
  astToString: (ast: unknown) => string;
  COMMENT_HEADER: string;
};
const GENERATOR = "openapi-typescript";

function read(relative: string): string {
  const configPath = ts.findConfigFile(ts.sys.getCurrentDirectory(), (f) => ts.sys.fileExists(f), "tsconfig.json");
  if (!configPath) throw new Error(`no tsconfig.json found upward from ${ts.sys.getCurrentDirectory()}`);
  const path = configPath.replace(/tsconfig\.json$/, relative);
  const text = ts.sys.readFile(path);
  if (text === undefined) throw new Error(`cannot read ${path}`);
  return text;
}

describe("generated schema.ts", () => {
  it("equals what openapi-typescript generates from the committed schema.yml", async () => {
    const yaml = read("openapi/schema.yml");
    const committed = read("src/api/generated/schema.ts");
    // A floor, so a clobbered pair of empty files cannot agree with each other.
    expect(committed.length).toBeGreaterThan(100_000);

    const { default: openapiTS, astToString, COMMENT_HEADER } = (await import(
      /* @vite-ignore */ GENERATOR
    )) as Generator;
    const generated = `${COMMENT_HEADER}${astToString(await openapiTS(yaml))}`;

    if (generated !== committed) {
      const a = generated.split("\n");
      const b = committed.split("\n");
      const line = a.findIndex((l, i) => l !== b[i]);
      throw new Error(
        `src/api/generated/schema.ts is stale: first difference at line ${line + 1}\n` +
          `  generated: ${JSON.stringify(a[line])}\n` +
          `  committed: ${JSON.stringify(b[line])}\n` +
          "Run `npm run schema:generate --workspace @soulledger/core` and commit the result.",
      );
    }
  }, 60_000);
});
