/**
 * `frontend/demo/` must not reach a normal build. Nothing in it is a secret; the point is that a normal build behaves as
 * if the demo did not exist, and every mention of it is a chance for that to stop being true. The bundler drops a branch
 * only if its condition is a literal comparison on the inlined variable, so that exact spelling is what this holds.
 * What a real build contains is checked by scripts/check-demo-bundle.sh.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FRONTEND = join(__dirname, "..", "..");
const GATE = 'process.env.NEXT_PUBLIC_DEMO_MODE === "1"';
const ENTRY_POINTS = ["app/(auth)/login/page.tsx", "app/layout.tsx", "src/components/providers/PlatformProvider.tsx"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : sources(path);
    return /\.(ts|tsx|mjs|js)$/.test(name) ? [path] : [];
  });
}

describe("the demo stays out of a normal build", () => {
  const files = ["app", "src", "lib", "components"].flatMap((d) => sources(join(FRONTEND, d)));
  const importers = files.filter((f) => /["']@\/demo\//.test(readFileSync(f, "utf8"))).map((f) => relative(FRONTEND, f));

  it("is imported from exactly the three known places", () => {
    expect(importers.sort()).toEqual([...ENTRY_POINTS].sort());
  });

  it.each(ENTRY_POINTS)("%s imports it only behind the literal gate, and only lazily", (file) => {
    const source = readFileSync(join(FRONTEND, file), "utf8");
    const lines = source.split("\n");
    expect(lines.some((line) => /^\s*import\b.*@\/demo\//.test(line))).toBe(false);
    lines.forEach((line, i) => {
      if (!/@\/demo\//.test(line)) return;
      expect([lines[i], lines[i - 1], lines[i - 2]].join("\n")).toContain(GATE);
    });
  });

  it("next.config inlines the variable as a literal even when unset", () => {
    const config = readFileSync(join(FRONTEND, "next.config.js"), "utf8");
    expect(config).toMatch(/NEXT_PUBLIC_DEMO_MODE: demo \? "1" : ""/);
  });
});
