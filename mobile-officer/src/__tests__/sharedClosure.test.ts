/**
 * Which of the soul app's files (`mobile/src/`) end up in the officer app's bundle.
 *
 * The officer app imports the soul app's leaf modules in place (`src/shared.ts`). A leaf that
 * later imports `session` or a screen would quietly pull the soul's accounts into this bundle,
 * and no other check would notice: the import compiles, and both apps' tests stay green. So this
 * reads the files as text (it imports no app code) and walks every relative import, starting
 * from each non-test file under `mobile-officer/src/` and continuing through `mobile/src/`'s own
 * relative imports, and pins the set of `mobile/src/` files that walk reaches.
 *
 * The set must EQUAL the list below, not merely avoid the forbidden ones: a new file in it is a
 * change to what both apps share, and should be seen in review. Adding one is fine -- add it here.
 * `import type` counts too (the walk does not tell it apart), which is stricter than the bundle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "path";

const ROOT = resolvePath(__dirname, "../../..");
const OFFICER = join(ROOT, "mobile-officer/src");
const MOBILE = join(ROOT, "mobile/src");

const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function resolve(from: string, spec: string): string {
  const base = resolvePath(dirname(from), spec);
  for (const e of EXTS) {
    const f = base + e;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  // An import the walk cannot follow would make the closure silently smaller.
  throw new Error(`${relative(ROOT, from)}: cannot resolve ${spec}`);
}
const imports = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(SPEC)].map((m) => resolve(file, m[1]));
const isTest = (rel: string) => /(^|\/)__tests__\//.test(rel) || /\.test\.[jt]sx?$/.test(rel);
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(join(dir, d.name)) : /\.[jt]sx?$/.test(d.name) ? [join(dir, d.name)] : []
  );
const inMobile = (f: string) => f.startsWith(MOBILE + sep);

const STARTS = walk(OFFICER).filter((f) => !isTest(relative(OFFICER, f)));
const seen = new Set<string>();
const queue = STARTS.flatMap(imports).filter(inMobile);
while (queue.length) {
  const f = queue.pop()!;
  if (seen.has(f)) continue;
  seen.add(f);
  queue.push(...imports(f).filter(inMobile));
}
const CLOSURE = [...seen].map((f) => relative(MOBILE, f).split(sep).join("/")).sort();

const EXPECTED = [
  "appVersion.ts",
  "brandMark.ts",
  "brandMarkView.tsx",
  "crashReport.ts",
  "deepLink.ts",
  "emblems.tsx",
  "errorBoundary.tsx",
  "feedback.tsx",
  "fonts.ts",
  "i18n.tsx",
  "layout.ts",
  "network.tsx",
  "online.ts",
  "passwordRulesView.tsx",
  "platform.ts",
  "theme.ts",
  "ui.tsx",
  "versionGate.tsx",
  "voiceCache.ts",
];

describe("the soul-app files the officer app reaches", () => {
  it("walks real files, so the checks below are not vacuous", () => {
    expect(STARTS.length).toBeGreaterThan(10);
    expect(STARTS).toContain(join(OFFICER, "shared.ts"));
  });

  it("is exactly the reviewed list", () => {
    expect(CLOSURE).toEqual(EXPECTED);
  });

  // rules / loginRules: the soul's presentation and sign-in rules; ui.tsx reads layout.ts and the
  // sign-out sheet lives in logout.tsx so neither comes along (cq-apps 2026-10-30 #2).
  it("never includes the soul's session, chrome, navigation, push, cold start, rules or screens", () => {
    const forbidden = CLOSURE.filter((f) =>
      /^(session|chrome|navigation|push|coldStart|rules|loginRules|logout)\.[jt]sx?$/.test(f) || f.startsWith("screens/")
    );
    expect(forbidden).toEqual([]);
  });
});
