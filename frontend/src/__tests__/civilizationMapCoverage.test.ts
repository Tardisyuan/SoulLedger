import { readFileSync } from "node:fs";
import path from "node:path";

import {
  CIVILIZATION_CODES,
  CIVILIZATION_DISPLAY_NAMES,
  CIVILIZATION_LABELS,
  CIVILIZATION_OPTIONS,
} from "@soulledger/core/config/civilizations";
import {
  judgmentCreateSchema,
  soulCreateSchema,
} from "@soulledger/core/validations/schemas";

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

/** Repo root, not frontend root. `CIVILIZATION_ICONS` now lives in
 *  `packages/core`, and the pages that consume it still live in `frontend`, so
 *  the addresses this file checks span both trees and have to be written from
 *  the one place that contains both. */
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

/** Every hand-written civilization-keyed map, and what it costs when a member
 *  is missing. The consequence is recorded so a reader deciding whether to add
 *  their new map here can tell whether it belongs. */
const TEXT_MAPS: { file: string; name: string; keyedBy: "civilization" | "tenantCode"; costs: string }[] = [
  {
    file: "frontend/app/organizations/page.tsx", name: "CATEGORY_COLORS",
    keyedBy: "civilization",
    costs: "an organization subtree renders uncoloured, beside coloured siblings",
  },
  // REMOVED, and the map with it: `app/judgment/[id]/page.tsx` carried a
  // `CIVILIZATION_ICONS` of two-letter stand-ins (CN / EU / EG / GR) painted
  // into a round avatar beside the soul's name. The Stage 12 rewrite of that
  // page shows the civilization through <DomainEnum namespace="souls.civilizations">
  // instead — translated copy with the raw member in `title` — so there is no
  // hand-written civilization-keyed map on that page left to check. The entry
  // is deleted rather than repointed because `keysOf` THROWS on a map it
  // cannot find, which would have turned a real deletion into a parser error
  // that reads like a broken test.
  {
    file: "frontend/app/realms/page.tsx", name: "CIVILIZATION_CONFIG",
    keyedBy: "civilization",
    costs: "the realms page renders that civilization's group with no header",
  },
  {
    // MOVED, not removed: this map used to exist TWICE — the same twelve lines
    // in `app/organizations/page.tsx` and `app/actors/page.tsx` — and by
    // 2026-09-02 the copies had drifted in their comments while their values
    // still agreed. Only one recorded that Greek gained Hades, Aeacus,
    // Rhadamanthus and Minos in `realms/0018`. It now lives once, in config,
    // and both pages import it.
    file: "packages/core/src/config/civilizations.ts", name: "CIVILIZATION_ICONS",
    keyedBy: "civilization",
    costs: "the organizations and actors pages both show no icon for that civilization",
  },
];

function keysOf(file: string, name: string): string[] {
  const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
  // `export const` too — a map that moved into config is exported.
  const start = new RegExp(`^(?:export )?const ${name}\\b[^=]*=\\s*\\{`, "m").exec(source);
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
    // Three, not four, and the argument this comment demands:
    // CIVILIZATION_ICONS was TWO entries — one per page — because the map was
    // duplicated. It is one map now, in config, imported by both pages, so it
    // is one entry. Nothing stopped being checked; one thing stopped being
    // checked twice. (The earlier drop, five to four, was the judgment detail
    // page's own CIVILIZATION_ICONS being deleted with the avatar it painted.)
    //
    // The floor still exists so the assertions below cannot compare two empty
    // lists, and it is still flush against the real count — the next map to
    // disappear has to be argued for here rather than absorbed by slack.
    expect(TEXT_MAPS.length).toBeGreaterThanOrEqual(3);
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

  it("names all six addresses at once when one is short", () => {
    // The message is the point. A fifth civilization turns exactly one file red
    // and needs to be told every place it has to be added, or it will be added
    // in one and forgotten in five.
    //
    // Five, not six. This number is the count of places a fifth civilization
    // has to be added, so it drops whenever two addresses become one — and
    // CIVILIZATION_ICONS just did: it was written into two pages and is now
    // written once in config. A fifth cosmology needs the icon added in ONE
    // place now, not two. Leaving it at six would have the failure message
    // promise an address that no longer exists.
    //
    // (The earlier drop, seven to six, was the judgment detail page's own
    // CIVILIZATION_ICONS being deleted with its avatar.)
    const addresses = [
      ...TEXT_MAPS.map((m) => `${m.file}::${m.name}`),
      "packages/core/src/config/civilizations.ts::CIVILIZATION_LABELS",
      "packages/core/src/config/civilizations.ts::CIVILIZATION_DISPLAY_NAMES",
    ];
    expect(addresses).toHaveLength(5);
  });
});

/**
 * The same list, held against the VALIDATORS rather than the maps.
 *
 * WHAT WENT UNCAUGHT, AGAIN. Everything above checks maps — objects keyed by
 * civilization. `lib/validations/schemas.ts` spelled the members as a zod
 * enum, which is a *list*, so none of the map assertions could ever see it,
 * and it sat three members long (CHINESE / EUROPEAN / EGYPTIAN) while
 * CIVILIZATION_OPTIONS had four. The pick-list in the soul-create modal
 * renders from CIVILIZATION_OPTIONS, so 希腊 was offered and then rejected on
 * submit with "请选择文明" — pointed at a select that plainly had a
 * civilization chosen. Creating a Greek soul through the UI was impossible
 * from the day GREEK landed.
 *
 * This is not the maps' failure mode. A missing map key renders something
 * wrong but harmless; a missing enum member is a wall. The check above was
 * running and would have gone red for a map — its subject list just did not
 * contain the thing that was broken.
 *
 * BEHAVIOURAL, NOT TEXTUAL. The maps are read as text because importing their
 * page modules would drag React in. These schemas are pure zod, so there is no
 * reason to read them as text and every reason not to: parsing an actual value
 * through the actual schema is immune to however the members get spelled. Both
 * schemas now derive from CIVILIZATION_OPTIONS, which is why neither appears
 * in the address list above — deriving REMOVES an address instead of adding
 * one. This test is what keeps them derived: retype a literal enum here and
 * omit a member, and it goes red on the omitted member by name.
 */
describe("every civilization-accepting validator accepts every civilization", () => {
  it.each([...CIVILIZATION_OPTIONS])("soulCreateSchema accepts %s", (civ) => {
    const result = soulCreateSchema.safeParse({
      name: "验证用",
      civilization: civ,
    });
    expect(result.success).toBe(true);
  });

  it.each([...CIVILIZATION_OPTIONS])("judgmentCreateSchema accepts %s", (civ) => {
    const result = judgmentCreateSchema.safeParse({
      soul_id: "00000000-0000-4000-8000-000000000000",
      court: "一殿",
      civilization: civ,
    });
    expect(result.success).toBe(true);
  });

  // Assert the absence too. Without this, a schema that had quietly become
  // `z.string()` — accepting anything, including the misconfigured-tenant
  // sentinel these enums exist to keep out — would pass every case above.
  it("still rejects a non-civilization, so the cases above mean something", () => {
    expect(soulCreateSchema.safeParse({ name: "x", civilization: "UNKNOWN" }).success).toBe(false);
    expect(soulCreateSchema.safeParse({ name: "x", civilization: "ATLANTEAN" }).success).toBe(false);
  });
});
