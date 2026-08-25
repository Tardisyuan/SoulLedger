import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CIVILIZATION_CODES,
  CIVILIZATION_DISPLAY_NAMES,
  CIVILIZATION_LABELS,
  CIVILIZATION_OPTIONS,
} from "@/src/config/civilizations";

/**
 * Every hand-written map keyed by civilization, held against the one list.
 *
 * WHAT WENT UNCAUGHT. An audit dropped GREEK from all seven maps below at once
 * and ran the whole suite: `npx tsc --noEmit` exit 0, `npx jest` 71 suites and
 * 1306 tests green. Every one of them is `Record<string, string>`, so a missing
 * key is not a type error, and every consumer falls back to something that
 * renders — a blank icon, an uncoloured badge, a headerless group, or the raw
 * tenant code printed where a name should be.
 *
 * That is the shape `civilizations.ts`'s own header warns about in as many
 * words: "A civilization missing from these maps does not fail loudly … the UI
 * renders a blank badge, a raw tenant code, or an untranslated key — the
 * silent-wrong-value shape this repository keeps finding." The warning was
 * there; the check was not.
 *
 * WHY THIS FILE AND NOT SEVEN ASSERTIONS NEXT TO SEVEN MAPS. The maps are the
 * enumeration; a test beside each one would be seven places to forget. The
 * fifth civilization has to turn exactly one file red and be told all seven
 * addresses at once, which is what the failure message does.
 *
 * READ AS TEXT, deliberately. Four of the seven live in `app/**` page modules
 * that pull in React components, next/navigation and a query client; importing
 * them to read a constant would drag that whole graph into a unit test and make
 * this file fail for reasons that have nothing to do with civilizations. The
 * keys are literal identifiers in an object literal, which is a shape a regex
 * reads without ambiguity — and if the shape ever stops matching, the parser
 * throws rather than reporting zero maps.
 */

const FRONTEND_ROOT = path.join(__dirname, "..", "..");

/** Every hand-written civilization-keyed map, and what it costs when a member
 *  is missing. The consequence is recorded so a reader deciding whether to add
 *  their new map here can tell whether it belongs. */
const TEXT_MAPS: { file: string; name: string; keyedBy: "civilization" | "tenantCode"; costs: string }[] = [
  {
    file: "app/organizations/page.tsx", name: "CIVILIZATION_ICONS",
    keyedBy: "civilization",
    costs: "an organization subtree renders with no icon",
  },
  {
    file: "app/organizations/page.tsx", name: "CATEGORY_COLORS",
    keyedBy: "civilization",
    costs: "an organization subtree renders uncoloured, beside coloured siblings",
  },
  {
    file: "app/judgment/[id]/page.tsx", name: "CIVILIZATION_ICONS",
    keyedBy: "civilization",
    costs: "the judgment page shows a blank civilization badge",
  },
  {
    file: "app/realms/page.tsx", name: "CIVILIZATION_CONFIG",
    keyedBy: "civilization",
    costs: "the realms page renders that civilization's group with no header",
  },
  {
    file: "app/actors/page.tsx", name: "CIVILIZATION_ICONS",
    keyedBy: "civilization",
    costs: "the actors page shows no icon for that civilization's cast",
  },
];

function keysOf(file: string, name: string): string[] {
  const source = readFileSync(path.join(FRONTEND_ROOT, file), "utf8");
  const start = new RegExp(`^const ${name}\\b[^=]*=\\s*\\{`, "m").exec(source);
  if (start === null) {
    throw new Error(
      `Could not find \`const ${name}\` in ${file}. Fix this parser or update ` +
        `TEXT_MAPS — do not delete the entry, which would silently stop ` +
        `checking a map that still exists.`
    );
  }
  const body = source.slice(start.index + start[0].length);
  const end = body.indexOf("\n}");
  if (end === -1) throw new Error(`Unterminated object literal for ${name} in ${file}`);
  const keys = [...body.slice(0, end).matchAll(/^\s{2}(?:"([^"]+)"|([A-Z_][A-Z0-9_]*))\s*:/gm)]
    .map((m) => m[1] ?? m[2]);
  if (keys.length === 0) {
    throw new Error(`Parsed no keys out of ${name} in ${file} — the parser is broken`);
  }
  return keys;
}

describe("the parser is looking at something", () => {
  // Without these, every assertion below compares two empty lists.
  it("has civilizations to check for", () => {
    expect(CIVILIZATION_OPTIONS.length).toBeGreaterThanOrEqual(4);
  });

  it("names every map it believes exists, and finds each one", () => {
    expect(TEXT_MAPS.length).toBeGreaterThanOrEqual(5);
    for (const { file, name } of TEXT_MAPS) {
      expect(keysOf(file, name).length).toBeGreaterThan(0);
    }
  });
});

describe("every civilization-keyed map covers every civilization", () => {
  it.each(TEXT_MAPS.map((m) => [`${m.file}::${m.name}`, m] as const))(
    "%s",
    (_label, map) => {
      const expected =
        map.keyedBy === "civilization"
          ? [...CIVILIZATION_OPTIONS]
          : CIVILIZATION_OPTIONS.map((civ) => CIVILIZATION_CODES[civ]);
      const missing = expected.filter((key) => !keysOf(map.file, map.name).includes(key));
      expect(missing).toEqual([]);
    }
  );

  // The two in config/civilizations.ts are imported rather than parsed: they
  // are in the same module as the list they must cover, so there is no
  // component graph to drag in and no reason to read them as text.
  it("CIVILIZATION_LABELS covers every civilization", () => {
    expect(CIVILIZATION_OPTIONS.filter((civ) => !CIVILIZATION_LABELS[civ])).toEqual([]);
  });

  it("CIVILIZATION_DISPLAY_NAMES covers every tenant code", () => {
    const missing = CIVILIZATION_OPTIONS
      .map((civ) => CIVILIZATION_CODES[civ])
      .filter((code) => !CIVILIZATION_DISPLAY_NAMES[code]);
    expect(missing).toEqual([]);
  });

  it("names all seven addresses at once when one is short", () => {
    // The message is the point. A fifth civilization turns exactly one file red
    // and needs to be told every place it has to be added, or it will be added
    // in one and forgotten in six.
    const addresses = [
      ...TEXT_MAPS.map((m) => `${m.file}::${m.name}`),
      "src/config/civilizations.ts::CIVILIZATION_LABELS",
      "src/config/civilizations.ts::CIVILIZATION_DISPLAY_NAMES",
    ];
    expect(addresses).toHaveLength(7);
  });
});
