/**
 * The app's copy, checked against the three bundles it ships with.
 *
 * Keys are harvested from the source text (every `"soul_app.…"` literal, plus
 * the enum namespaces the screens hand to `EnumText`), so a key typed in a
 * screen but missing from a bundle is red here rather than rendered as a
 * dotted path on a phone.
 */
import { DESIRED_REBIRTH_FORMS, SOUL_ERROR_CODES } from "@soulledger/core/api/soul";
import fs from "fs";
import path from "path";

import { BUNDLES, translate } from "../i18n";
import { SOUL_STATE_BADGES, lexiconKey, type LexiconWord } from "../rules";

const LEXICON_WORDS: LexiconWord[] = [
  "merit",
  "demerit",
  "merit_entry",
  "demerit_entry",
  "records",
  "judgments",
  "court",
  "judging",
  "past_read_only",
  "no_past_lives",
  "no_rebirth_title",
  "no_rebirth_body",
];

type Bundle = Record<string, unknown>;

function flatten(node: unknown, prefix = ""): Record<string, string> {
  if (typeof node === "string") return { [prefix]: node };
  if (!node || typeof node !== "object") return {};
  return Object.assign(
    {},
    ...Object.entries(node as Bundle).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
  );
}

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sources(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const SRC = path.join(__dirname, "..");
const files = [...sources(SRC), path.join(SRC, "..", "App.tsx")];
const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
const locales = Object.keys(BUNDLES) as (keyof typeof BUNDLES)[];
const flat = Object.fromEntries(locales.map((l) => [l, flatten(BUNDLES[l])]));
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe("soul_app copy", () => {
  const used = [...new Set([...text.matchAll(/(?<!namespace=)"(soul_app\.[a-z_.]+[a-z_])"/g)].map((m) => m[1]))];

  it("the harvest found the screens' keys (a scanner that finds nothing passes everything)", () => {
    expect(used.length).toBeGreaterThan(60);
    expect(used).toContain("soul_app.login.submit");
  });

  it.each(locales)("every key used in the app exists in %s", (locale) => {
    expect(used.filter((key) => !(key in flat[locale]))).toEqual([]);
  });

  it("the three bundles carry the same soul_app keys with the same placeholders", () => {
    const shape = (l: string) =>
      Object.entries(flat[l])
        .filter(([k]) => k.startsWith("soul_app."))
        .map(([k, v]) => `${k}:${placeholders(v).join(",")}`)
        .sort();
    expect(shape("en")).toEqual(shape("zh-Hans"));
    expect(shape("egy")).toEqual(shape("zh-Hans"));
  });

  it.each(locales)("every error code the client can emit has copy in %s", (locale) => {
    const keys = [...SOUL_ERROR_CODES, "unknown"].map((c) => `soul_app.errors.${c}`);
    expect(keys.filter((k) => !(k in flat[locale]))).toEqual([]);
  });

  it.each(locales)("enum namespaces the screens use are covered in %s", (locale) => {
    const needed = [
      ...["UNDER_REVIEW", "REJECTED", "APPEALING", "APPEAL_REJECTED", "APPROVED"].map((s) => `soul_app.status.${s}`),
      ...DESIRED_REBIRTH_FORMS.map((f) => `reincarnation.forms.${f}`),
      // The radio cards read these through a template key the harvest above cannot see.
      ...DESIRED_REBIRTH_FORMS.map((f) => `soul_app.form_notes.${f}`),
      ...["merit", "demerit"].map((w) => `soul_app.life.${w}`),
      // Every soul state has its own badge (rules.ts) and its own copy — no neutral fallback.
      ...Object.keys(SOUL_STATE_BADGES).map((s) => `soul_app.soul_states.${s}`),
      // Lexicon keys are built from the civilization and the word, also out of the harvest's sight.
      ...(["neutral", "cn", "eu", "eg", "gr"] as const).flatMap((civ) => LEXICON_WORDS.map((w) => lexiconKey(civ, w))),
      "common.value.unrecorded",
      "common.value.unrecognized",
      // The settings switches and the primer's list build their keys from the category.
      ...["rebirth", "judgment", "residence"].flatMap((c) => [
        `soul_app.settings.${c}`,
        `soul_app.settings.${c}_note`,
        `soul_app.push.primer_${c}`,
        `soul_app.push.primer_${c}_note`,
      ]),
    ];
    expect(needed.filter((k) => !(k in flat[locale]))).toEqual([]);
  });

  it("interpolates and never echoes a filled key", () => {
    expect(translate("en", "soul_app.life.cycle", { cycle: "2" })).toBe("Life 2");
    expect(translate("egy", "soul_app.errors.unknown", { code: "x" })).toBe("Isfet (x)");
    expect(translate("en", "soul_app.no_such_key")).toBe("soul_app.no_such_key");
  });
});
