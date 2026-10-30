/**
 * The sidebar's static icon table covers every icon name the database can be seeded with.
 *
 * `src/lib/menuIcons.ts` resolves `menu.icon` from a static table (the IconPicker whitelist plus the
 * seeded names outside it) and only falls back to downloading the whole of lucide (~194 KB gz) for a
 * name it does not have (perf A1, 2026-10-30). A seeded name missing from the table still draws —
 * late, after that download, on every page — so nothing on screen goes red. This test is what does.
 *
 * Sources: the menus migrations (they are the menu seed: 0021 seeds the first sixteen, later ones add
 * one or two each) and the E2E fixtures' mocked menus. Each name must resolve statically, and to the
 * same icon the whole-module resolver picks — a table that mapped `Users` to the wrong icon would
 * otherwise pass.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import * as lucide from "lucide-react";
import { iconResolver, staticMenuIcon } from "@/src/lib/menuIcons";

const FRONTEND = path.resolve(__dirname, "..", "..");
const MIGRATIONS = path.join(FRONTEND, "..", "backend", "apps", "menus", "migrations");
const E2E = path.join(FRONTEND, "e2e");

function filesUnder(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : [],
  );
}

/** `"icon": "X"` (dict literals), `icon = "X"` (docstrings naming the seeded value), `icon: "X"` (TS fixtures). */
const ICON_VALUE = /["']?\bicon["']?\s*[:=]\s*["']([A-Za-z0-9-]+)["']/g;

function namesIn(files: string[]): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(ICON_VALUE)) {
      if (!found.has(m[1])) found.set(m[1], path.relative(path.join(FRONTEND, ".."), file));
    }
  }
  return found;
}

const SEEDED = namesIn(filesUnder(MIGRATIONS, ".py"));
const FIXTURES = namesIn(filesUnder(E2E, ".ts"));
const full = iconResolver(lucide);

describe("the scan finds the names", () => {
  it("reads the menus migrations and the E2E fixtures", () => {
    // Every assertion below is "nothing is missing", which an empty scan satisfies.
    expect(SEEDED.size).toBeGreaterThan(30);
    expect([...SEEDED.keys()]).toEqual(expect.arrayContaining(["BarChart", "Building2", "Scroll", "Settings", "Monitor"]));
    expect([...FIXTURES.keys()]).toContain("users");
  });
});

describe("every seeded or fixture icon name is in the static table", () => {
  it("resolves without loading lucide, to the icon the whole-module resolver would draw", () => {
    const missing = [...SEEDED, ...FIXTURES]
      .filter(([name]) => {
        const icon = staticMenuIcon(name);
        return icon === null || icon !== full(name);
      })
      .map(([name, file]) => `${name}  (${file})`);
    if (missing.length > 0) {
      throw new Error(
        `Not in src/lib/menuIcons.ts's static table (or mapped to another icon). Add the import to its ` +
          `SEEDED list, or to the IconPicker catalog if it should be pickable:\n\n${missing.join("\n")}`,
      );
    }
    expect(missing).toEqual([]);
  });

  it("misses names that are not icons, so the table cannot answer for everything", () => {
    for (const name of ["NoSuchIcon", "Icon", "createLucideIcon", "constructor", "toString", ""]) {
      expect(staticMenuIcon(name)).toBeNull();
    }
    expect(staticMenuIcon(null)).toBeNull();
  });
});
