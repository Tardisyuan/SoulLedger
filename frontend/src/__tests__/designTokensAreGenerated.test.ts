/**
 * @jest-environment node
 *
 * One source for the design tokens (fe-tokens §3.2, 2026-11-14): packages/core/tokens/*.tokens.json.
 * The token block of app/globals.css and mobile/src/theme.generated.ts are written from it by
 * scripts/build-tokens.mjs. This runs the script's `--check`, which writes nothing and exits 1 when
 * either output differs from what the JSON says — a value changed by hand in globals.css, a JSON edit
 * without a regeneration, or a name declared in the block that no token defines.
 *
 * It replaces nothing yet: ledgerPaletteContract and mobile's theme.test still hold the values to the
 * Design drafts. This holds the two outputs to each other.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..", "..");

describe("design tokens", () => {
  it("globals.css and theme.generated.ts are what the tokens JSON generates", () => {
    let out = "";
    try {
      execFileSync(process.execPath, [path.join(REPO, "scripts", "build-tokens.mjs"), "--check"], {
        cwd: REPO,
        stdio: "pipe",
      });
    } catch (e) {
      const err = e as { stderr?: Buffer; stdout?: Buffer };
      out = `${err.stdout ?? ""}${err.stderr ?? ""}` || String(e);
    }
    // Run `node scripts/build-tokens.mjs` and commit the result (and edit the JSON, not the outputs).
    expect(out).toBe("");
  });
});
