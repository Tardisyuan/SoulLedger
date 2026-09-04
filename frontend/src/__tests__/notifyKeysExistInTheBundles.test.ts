/**
 * Every message key handed to `notify` is a real key in all three bundles.
 *
 * WHY THIS HAD TO EXIST BEFORE THE KEY FORM COULD. `notify` used to take a
 * rendered string, and every call site wrote `notify(t("some.key") || "English
 * fallback", kind)`. Those fallbacks look like the safety net for a missing key
 * and they are not one — **not a single one of them can ever fire**, for two
 * independent reasons:
 *
 *   1. `t()` returns the key itself when it cannot find it. A missing key
 *      therefore yields a truthy string, and `||` never reaches its right side.
 *   2. `messageValuesAreNotTheirOwnKeys.test.ts` already forbids an empty
 *      value in any bundle, which is the only other way `t()` returns something
 *      falsy.
 *
 * So a key deleted from the bundles would have put `souls.detail.error_delete`
 * on screen, in a toast, in production, with the English "fallback" sitting
 * three characters away doing nothing. Dropping those strings loses no
 * behaviour. What it loses is the *appearance* of a net, and this file is the
 * real one, moved from run time to build time where it can actually go red.
 *
 * MEASURED, not assumed: all 24 keys the hooks passed through `t()` before this
 * change were present in zh-Hans, en and egy already. The fallbacks were dead
 * on the day they were written.
 *
 * ---------------------------------------------------------------------------
 * WHY A SOURCE SCAN AND NOT A HAND-WRITTEN LIST. The thing being guarded is
 * "the call sites and the bundles agree", and a hand-written list of keys is a
 * third copy that can drift from both. The subject set is therefore derived —
 * and, because a derivation that returns nothing passes loudly, the derivation
 * is itself asserted: the files must be found, and the key count must clear a
 * floor.
 *
 * WHAT IT CANNOT SEE. A key built at run time — `notify(\`souls.\${x}\`)` — is
 * invisible to a regex, and so is one handed in from a variable. Neither exists
 * today and the floor below is what would notice if the count fell because
 * someone introduced one. `{ text: … }` is deliberately out of scope: it is not
 * a key and no bundle should hold it.
 * ---------------------------------------------------------------------------
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zh from "@soulledger/core/messages/zh-Hans.json";

type Bundle = Record<string, unknown>;

const BUNDLES: Array<[string, Bundle]> = [
  ["zh-Hans", zh as Bundle],
  ["en", en as Bundle],
  ["egy", egy as Bundle],
];

/**
 * Every tree `notify` can be called from, on both sides of the package
 * boundary.
 *
 * `packages/core/src` is in here because that is where the six hooks now live —
 * the whole point of the key form was to let them out of `frontend/`. The web
 * trees stay in the list rather than being trimmed to "where the call sites are
 * today": a scan narrowed to the files that currently match stops being able to
 * report the first call site that appears somewhere else.
 */
const ROOT = path.join(__dirname, "..", "..", "..");
const SCANNED_DIRS = [
  "packages/core/src",
  "frontend/src/hooks",
  "frontend/hooks",
  "frontend/lib",
  "frontend/src/components",
  "frontend/app",
];

function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCE_FILES = SCANNED_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));

/**
 * `notify("a.b.c"` and `notify({ key: "a.b.c"`, with comments stripped first.
 *
 * Comments are stripped because this repository has already shipped a scanner
 * that reported its own documentation as a violation (see the note in
 * `suiteShape.test.ts` about the `RequirePermission` stub). Here the failure
 * would be the mirror image and quieter: the doc comment over `NotifyMessage`
 * shows `notify` examples, and a scan that read them would be asserting against
 * prose.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const CALL_SITES: Array<{ file: string; key: string }> = [];
for (const file of SOURCE_FILES) {
  const source = stripComments(readFileSync(file, "utf8"));
  for (const match of source.matchAll(/\bnotify\(\s*"([^"]+)"/g)) {
    CALL_SITES.push({ file: path.relative(ROOT, file), key: match[1] });
  }
  for (const match of source.matchAll(/\bnotify\(\s*\{\s*key:\s*"([^"]+)"/g)) {
    CALL_SITES.push({ file: path.relative(ROOT, file), key: match[1] });
  }
}

function lookup(bundle: Bundle, key: string): string | null {
  let value: unknown = bundle;
  for (const part of key.split(".")) {
    if (value && typeof value === "object" && part in (value as Bundle)) {
      value = (value as Bundle)[part];
    } else {
      return null;
    }
  }
  return typeof value === "string" ? value : null;
}

describe("every key `notify` is given is a key the bundles have", () => {
  it("scanned real files and found real call sites", () => {
    // The guard for the guard, twice over. A wrong `SCANNED_DIRS`, a renamed
    // hooks directory, or a regex that stopped matching all present the same
    // way as a clean codebase: an empty offenders list.
    expect(SOURCE_FILES.length).toBeGreaterThan(100);
    // 26 in the six hooks today. A floor rather than a pin, because the number
    // moves whenever a mutation gains or loses a toast — but it must not
    // collapse.
    expect(CALL_SITES.length).toBeGreaterThanOrEqual(24);
  });

  it("found the call sites in the files they are actually in", () => {
    // Names the subject rather than counting it. If `notify` moved out of these
    // six files without this list being updated, the count above could still
    // clear its floor on call sites somewhere else entirely.
    const files = [...new Set(CALL_SITES.map((c) => c.file))].sort();
    expect(files).toEqual([
      "packages/core/src/hooks/useDispositions.ts",
      "packages/core/src/hooks/useJudgmentQueue.ts",
      "packages/core/src/hooks/useJudgments.ts",
      "packages/core/src/hooks/useReincarnation.ts",
      "packages/core/src/hooks/useSocial.ts",
      "packages/core/src/hooks/useSouls.ts",
    ]);
  });

  it.each(BUNDLES)("%s has all of them", (locale, bundle) => {
    const missing = CALL_SITES.filter(({ key }) => lookup(bundle, key) === null).map(
      ({ file, key }) => `${locale}: ${key} (${file})`
    );
    expect(missing).toEqual([]);
  });

  it("no call site passes an English sentence where a key belongs", () => {
    // The trap the key form opens: `notify("Failed to delete post", "error")`
    // renders as itself, because an unresolvable key comes back unchanged. It
    // is indistinguishable on screen from working code in an English locale and
    // wrong in the other two. Two such calls existed in `useSocial.ts` and are
    // now `social.post_delete_error` / `social.comment_delete_error`.
    //
    // Checked by shape, not by the bundle lookup above: a sentence that IS
    // absent from the bundles is already caught there, and this states the
    // narrower rule so the failure names the real problem.
    const sentences = CALL_SITES.filter(({ key }) => /\s/.test(key) || !key.includes("."));
    expect(sentences.map(({ file, key }) => `${file}: ${key}`)).toEqual([]);
  });
});
