/**
 * Two require cycles were broken by moving leaf code out of screens (perf review 2026-10-27):
 *   session -> push -> screens/sentence -> screens/applications -> session
 *   screens/letters -> screens/auth -> screens/loginMfa -> chrome -> screens/letters
 * Metro serves `undefined` for a binding read at module top level inside a cycle, and which
 * file loads first decides who breaks. Mutation: import a screen from push.ts / chrome.tsx, or
 * put useNow / useCurrentHall back in a screen -> red.
 */
import { readFileSync } from "fs";
import { join } from "path";

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
/** Runtime (non-`import type`) imports of a file. */
const runtimeImports = (f: string) =>
  [...src(f).matchAll(/^import\s+(?!type\s)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);

describe("leaf modules reach no screen", () => {
  it.each(["push.ts", "chrome.tsx", "assistPanel.tsx", "sentenceKinds.ts", "useNow.ts", "useCurrentHall.ts"])(
    "%s has no runtime import of ./screens/*",
    (f) => {
      const screens = runtimeImports(f).filter((m) => m.startsWith("./screens/"));
      expect(screens.filter((m) => m === "./screens/letters" || m === "./screens/sentence" || m === "./screens/auth")).toEqual([]);
    }
  );

  // cq-apps 2026-10-30 #1: applications -> life -> sentence -> applications (and applications <-> sentence)
  // ran through useResidence / realmName / useResidenceNames and the stack-param types. They live in
  // residence.ts / navTypes.ts now. Mutation: import useResidenceNames from "./applications" in sentence.tsx -> red.
  it.each(["residence.ts", "navTypes.ts"])("%s has no runtime import of ./screens/*", (f) => {
    expect(runtimeImports(f).filter((m) => m.startsWith("./screens/"))).toEqual([]);
  });

  it.each([
    ["screens/sentence.tsx", ["./applications", "./life"]],
    ["screens/life.tsx", ["./applications"]],
  ])("%s does not import back up the applications/life/sentence chain at runtime", (f, banned) => {
    expect(runtimeImports(f).filter((m) => banned.includes(m))).toEqual([]);
  });

  it("the residence helpers and stack params are defined once, outside the screens", () => {
    for (const f of ["screens/life.tsx", "screens/applications.tsx"]) {
      expect(src(f)).not.toMatch(/export function (useResidence|useResidenceNames|realmName)\b/);
      expect(src(f)).not.toMatch(/export type (AppStackParams|LifeFocus|LifeParams)\b/);
    }
    expect(src("residence.ts")).toMatch(/export function useResidenceNames/);
    expect(src("navTypes.ts")).toMatch(/export type AppStackParams/);
  });

  it("useNow and useCurrentHall are defined once, outside the screens", () => {
    expect(src("screens/auth.tsx")).not.toMatch(/export function useNow/);
    expect(src("screens/letters.tsx")).not.toMatch(/export function useCurrentHall/);
    expect(src("useNow.ts")).toMatch(/export function useNow/);
    expect(src("useCurrentHall.ts")).toMatch(/export function useCurrentHall/);
  });
});
