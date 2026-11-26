/**
 * Which of the shared package's files (`packages/mobile-ui/src/`) end up in the officer app's bundle,
 * and that none of the soul app's own files (`mobile/`) does.
 *
 * The officer app imports what it shares with the soul app from `@soulledger/mobile-ui` (`src/shared.ts`).
 * A package file that later imports the soul's `session` or a screen would quietly pull the soul's accounts
 * into this bundle, and no other check would notice: the import compiles, and both apps' tests stay green.
 * So this reads the files as text (it imports no app code) and walks every relative and
 * `@soulledger/mobile-ui/src/*` import, starting from the entry (`index.ts`, `App.tsx`) and each non-test file under `mobile-officer/src/`, and
 * continuing through the package's own imports, and pins the set of package files that walk reaches.
 *
 * The set must EQUAL the list below, not merely avoid the forbidden ones: a new file in it is a change to
 * what both apps share, and should be seen in review. Adding one is fine -- add it here.
 * `import type` counts too (the walk does not tell it apart), which is stricter than the bundle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve as resolvePath, sep } from "path";

const ROOT = resolvePath(__dirname, "../../..");
const OFFICER = join(ROOT, "mobile-officer/src");
const SHARED = join(ROOT, "packages/mobile-ui/src");
const MOBILE = join(ROOT, "mobile");

const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["'](\.{1,2}\/[^"']+|@soulledger\/(?:mobile|officer)[^"']*)["']/g;
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];
const PACKAGE = "@soulledger/mobile-ui/src/";

function resolve(from: string, spec: string): string {
  if (spec.startsWith("@soulledger/") && !spec.startsWith(PACKAGE)) {
    // @soulledger/mobile (the soul app) or @soulledger/officer: never a dependency of either side.
    throw new Error(`${relative(ROOT, from)}: imports ${spec}`);
  }
  const base = spec.startsWith(PACKAGE) ? join(SHARED, spec.slice(PACKAGE.length)) : resolvePath(dirname(from), spec);
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
const inShared = (f: string) => f.startsWith(SHARED + sep);
const inMobile = (f: string) => f.startsWith(MOBILE + sep);

// The entry (index.ts -> App.tsx) sits outside src/ and imports from it, so it is a start too.
const ENTRY = [join(ROOT, "mobile-officer/index.ts"), join(ROOT, "mobile-officer/App.tsx")];
const STARTS = [...ENTRY, ...walk(OFFICER).filter((f) => !isTest(relative(OFFICER, f)))];
const seen = new Set<string>();
const reached = STARTS.flatMap(imports);
const queue = reached.filter(inShared);
const mobileReached = reached.filter(inMobile);
while (queue.length) {
  const f = queue.pop()!;
  if (seen.has(f)) continue;
  seen.add(f);
  const next = imports(f);
  mobileReached.push(...next.filter(inMobile));
  queue.push(...next.filter(inShared));
}
const CLOSURE = [...seen].map((f) => relative(SHARED, f).split(sep).join("/")).sort();

const EXPECTED = [
  "appVersion.ts",
  "brandMark.ts",
  "brandMarkView.tsx",
  "civHead.tsx",
  "coldStartView.tsx",
  "crashReport.ts",
  "credentialFailure.ts",
  "deepLink.ts",
  "deviceCredential.ts",
  "dossierMarks.tsx",
  "emblems.tsx",
  "errorBoundary.tsx",
  "feedback.tsx",
  "fonts.ts",
  "i18n.tsx",
  "layout.ts",
  "lockView.tsx",
  "network.tsx",
  "online.ts",
  "passwordRulesView.tsx",
  "platform.ts",
  "pushCore.ts",
  "rememberedCard.tsx",
  "theme.generated.ts",
  "theme.ts",
  "ui.tsx",
  "versionGate.tsx",
  "voiceCache.ts",
];

describe("the shared files the officer app reaches", () => {
  it("walks real files, so the checks below are not vacuous", () => {
    expect(STARTS.length).toBeGreaterThan(10);
    expect(STARTS).toContain(join(OFFICER, "shared.ts"));
    for (const f of ENTRY) expect(existsSync(f)).toBe(true);
  });

  it("is exactly the reviewed list", () => {
    expect(CLOSURE).toEqual(EXPECTED);
  });

  // The soul's session, chrome, navigation, push, cold start, rules, screens ... all live in mobile/.
  it("never includes a file of the soul app itself", () => {
    expect(mobileReached.map((f) => relative(ROOT, f))).toEqual([]);
  });

  // The package is what both apps import, so it reaches back into neither (a relative path out of it would
  // put a mobile/ or mobile-officer/ file in both bundles). Its own assets (fonts) are inside it.
  it("no shared file imports anything outside the package by a relative path", () => {
    const out = walk(SHARED).flatMap((f) =>
      imports(f)
        .filter((t) => !t.startsWith(join(ROOT, "packages/mobile-ui") + sep))
        .map((t) => `${relative(ROOT, f)} -> ${relative(ROOT, t)}`)
    );
    expect(out).toEqual([]);
  });
});
