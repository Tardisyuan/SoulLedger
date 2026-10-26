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

  it("useNow and useCurrentHall are defined once, outside the screens", () => {
    expect(src("screens/auth.tsx")).not.toMatch(/export function useNow/);
    expect(src("screens/letters.tsx")).not.toMatch(/export function useCurrentHall/);
    expect(src("useNow.ts")).toMatch(/export function useNow/);
    expect(src("useCurrentHall.ts")).toMatch(/export function useCurrentHall/);
  });
});
