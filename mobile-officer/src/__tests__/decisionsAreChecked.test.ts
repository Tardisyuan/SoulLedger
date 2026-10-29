/**
 * Every decision the officer app sends goes through `confirmedDecision` (deviceCheck.ts), so the switch on 我的
 * (批准、驳回前验证面容 / 指纹) covers all of them. Phone QA 10-29b: the wangsi review and the release of a sentence
 * served called their APIs directly, and an officer with the switch on concluded a case without the phone asking.
 *
 * Read from source, not imported: a call site written any other way is red here, with its file and line.
 * The low-level approve / reject calls live only in rules.ts, inside `submitDecision` -- which is itself a decision.
 * NOT decisions (they never ask, by design, deviceCheck.ts): comments, co-sign, claim, 放回 (`judgmentApi.release`
 * gives a claimed case back to the queue), defer / undefer, reassign, letters.
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const SRC = join(__dirname, "..");
const DECISION = /\b(submitDecision|decideGrievance|dispositionApi\s*\.\s*release|sendOn|returnCase)\s*\(/g;
const LOW_LEVEL = /\b(approveNode|approveCooldownShortening|rejectCooldownShortening|decideCrossCivilization|dispatchApi\s*\.\s*(approve|reject))\s*\(/g;
const WRAP = 'confirmedDecision(t("officer_app.biometric.prompt"), () =>';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `file:line` of each decision call not written as `confirmedDecision(<prompt>, () => … call(`. */
function unchecked(file: string, text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DECISION)) {
    const before = text.slice(0, m.index);
    if (/export (async )?function\s*$/.test(before)) continue; // the definition of submitDecision itself
    const at = before.lastIndexOf(WRAP);
    // Between the wrapper's `() =>` and the call: one expression -- no statement, no block.
    if (at < 0 || /[;{}]/.test(before.slice(at + WRAP.length))) out.push(`${file}:${before.split("\n").length}`);
  }
  return out;
}

const files = sources(SRC).filter((f) => !f.endsWith("deviceCheck.ts"));
const texts = files.map((f) => [relative(SRC, f), readFileSync(f, "utf8")] as const);

it("every decision call site goes through confirmedDecision", () => {
  const sites = texts.filter(([f]) => f !== "rules.ts").flatMap(([f, s]) => [...s.matchAll(DECISION)].map(() => f));
  // Not vacuous: the scan still finds the four screens that send decisions.
  expect(new Set(sites)).toEqual(new Set(["screens/sheets.tsx", "screens/wangsi.tsx", "screens/servingFact.tsx", "screens/cityGod.tsx"]));
  expect(sites.length).toBeGreaterThanOrEqual(5);
  expect(texts.flatMap(([f, s]) => unchecked(f, s))).toEqual([]);
});

it("the low-level approve / reject calls are only in rules.ts (inside submitDecision)", () => {
  const where = texts.filter(([, s]) => [...s.matchAll(LOW_LEVEL)].length > 0).map(([f]) => f);
  expect(where).toEqual(["rules.ts"]);
});

it("the scan is red on a direct call and on a call outside the wrapper's expression", () => {
  expect(unchecked("x.tsx", "wangsiApi.decideGrievance(id, true, n, false).then(done);")).toEqual(["x.tsx:1"]);
  expect(unchecked("x.tsx", `${WRAP} Promise.resolve()).then(() => {});\ndispositionApi.release(d.id);`)).toEqual(["x.tsx:2"]);
  expect(unchecked("x.tsx", `${WRAP} dispositionApi.release(d.id))`)).toEqual([]);
  expect(unchecked("x.tsx", `${WRAP} (a ? cityGodCasesApi.sendOn(id, n) : cityGodCasesApi.returnCase(id, n)))`)).toEqual([]);
});
