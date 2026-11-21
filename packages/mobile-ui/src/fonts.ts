/**
 * The families and what each is for (v4, user decision 2026-11-06: the draft's seven faces; the App
 * ships the six it draws, each at the weights it draws — EB Garamond at 400 only, GFS Didot not at all):
 *
 *   ui     SoulLedger Sans    interface text: Geist with Noto Sans SC's Han merged in behind it
 *          400 / 500 / 600    (mobile/scripts/build-cjk-fonts.py) — the web's `Geist, "Noto Sans SC"`
 *                             as one file, because React Native has no fallback list
 *   mono   Geist Mono         every value a person could check against a record:
 *          400 / 500          codes, dates, counts, scores, raw enum members
 *   serif  EB Garamond 400    only words someone SAID, when they have no Han (it has Greek)
 *   serifHan Noto Serif SC 500  the same words with Han in them (v4 loads the serif at 500 / 600;
 *                             a serif with no weight resolves to 500); one exception: the app name on
 *                             the pre-login bar (`AppHeader serif`, product decision 2026-09-26)
 *   title  Noto Serif SC 600  titles and display text (`TYPE.title` / `TYPE.display`). Its Latin
 *                             letters are Noto's own serif, as the web's `font-title` draws them
 *
 * React Native picks no file by `fontWeight` for a custom family, so each weight is its own family
 * name. Han in `mono` falls back to the OS's CJK sans. The Han faces are subsets — 通用规范汉字表
 * 一级 3500 字 + punctuation (SIL OFL 1.1, `assets/fonts/OFL.txt`, `Geist-OFL.txt`); a rarer
 * character falls back to the system font, glyph by glyph. GFS Didot draws only the Greek document's
 * ΚΡΙΣΙΣ on the web; no App screen has it, so it is not bundled (add it with the screen that does).
 */
import { EBGaramond_400Regular } from "@expo-google-fonts/eb-garamond/400Regular";
import { GeistMono_400Regular } from "@expo-google-fonts/geist-mono/400Regular";
import { GeistMono_500Medium } from "@expo-google-fonts/geist-mono/500Medium";
import { NotoSansEgyptianHieroglyphs_400Regular } from "@expo-google-fonts/noto-sans-egyptian-hieroglyphs/400Regular";

export const FONT_ASSETS = {
  // 1.18 MB each: Geist (~90 KB) and the Noto Sans SC subset.
  SoulLedgerSans_400: require("../assets/fonts/SoulLedgerSans-400.ttf"),
  SoulLedgerSans_500: require("../assets/fonts/SoulLedgerSans-500.ttf"),
  SoulLedgerSans_600: require("../assets/fonts/SoulLedgerSans-600.ttf"),
  GeistMono_400Regular,
  GeistMono_500Medium,
  EBGaramond_400Regular,
  // Quoted words 500, titles and display text 600 (1.49 MB each, the same charset).
  NotoSerifSC_500: require("../assets/fonts/NotoSerifSC-Subset-500.ttf"),
  NotoSerifSC_600: require("../assets/fonts/NotoSerifSC-Subset-600.ttf"),
  // Status glyphs (Design E 组): ✓✕◇↺◌○▣↻◎≡?◐⇄■□ from ONE font. The interface face has only ◌ ○ ? (from Noto Sans SC), so each
  // fell back to the OS per glyph — ◌ from one font, its neighbours from another. 5 KB, the same
  // bytes the web serves (scripts/build-glyph-font.py; DejaVu Sans subset, licence beside it).
  SoulLedgerGlyphs: require("../assets/fonts/SoulLedgerGlyphs.ttf"),
  // v2 朱印's glyph faces (霞鹜篆书, UnifrakturMaguntia, GFS Didot) went with v2's seal (2026-10-03);
  // its plaque title faces (Josefin Slab, Cinzel, Ma Shan Zheng) with v2's plaque (2026-10-02).
};

/**
 * 埃及's outline seal (its default glyph U+13184) — about 1 MB, and drawn only by a seal whose glyph is a
 * hieroglyph. Not in `FONT_ASSETS`, so neither app reads it at boot (S2, 2026-10-30): `OutlineSeal` loads it
 * the first time it has a hieroglyph to draw (`useHieroglyphFace` in seal.tsx).
 */
export const HIEROGLYPH_FONT = { NotoSansEgyptianHieroglyphs_400Regular };

type FontName = keyof typeof FONT_ASSETS | keyof typeof HIEROGLYPH_FONT;

export const family = {
  ui: { 400: "SoulLedgerSans_400", 500: "SoulLedgerSans_500", 600: "SoulLedgerSans_600" },
  mono: { 400: "GeistMono_400Regular", 500: "GeistMono_500Medium" },
  serif: "EBGaramond_400Regular",
  serifHan: "NotoSerifSC_500",
  /** v3 titles and display text: Noto Serif SC 600 (bundled subset; a rarer Han character falls back per glyph). */
  title: "NotoSerifSC_600",
  /** Badge glyphs only (`Badge` in ui.tsx) — the family has no letters beyond `?`. */
  glyph: "SoulLedgerGlyphs",
  /** 印文 in 圣书字 (`OutlineSeal`); other glyphs use the two serifs via `quoteFamily`. */
  hieroglyph: "NotoSansEgyptianHieroglyphs_400Regular",
} as const satisfies {
  ui: Record<number, FontName>;
  mono: Record<number, FontName>;
  serif: FontName;
  serifHan: FontName;
  title: FontName;
  glyph: FontName;
  hieroglyph: FontName;
};

const HAN = /[㐀-鿿豈-﫿]/;

/** The family for quoted words: the bundled Noto Serif SC when they contain Han characters, else EB Garamond. */
export function quoteFamily(text: string): string {
  return HAN.test(text) ? family.serifHan : family.serif;
}

/**
 * What the title subset draws besides Han (`scripts/build-cjk-fonts.py` BASE): ASCII,
 * Latin-1 punctuation and × ÷, general and CJK punctuation, fullwidth forms.
 */
const TITLE_SUBSET = /^[\u0020-\u007E\u00A0-\u00BF\u00D7\u00F7\u2010-\u2027\u2030-\u203B\u2E3A\u2E3B\u3000-\u303F\uFF00-\uFFEF\u3400-\u9FFF\uF900-\uFAFF\s]*$/;

/**
 * The family for a title (v3: Noto Serif SC 600) — unless it has a letter the subset lacks.
 * React Native falls back glyph by glyph, so `Jérôme` would be J·r·m·e in the serif and é·ô in
 * the system sans, and `Ḥr-m-ḥꜣb` or a Greek name likewise; such a title stays whole in the
 * interface face (600). Every bar title in the three language packs is inside the subset; a
 * rare Han character outside it still falls back alone, as it does in quoted words.
 */
export function titleFamily(text: string): string {
  return TITLE_SUBSET.test(text) ? family.title : family.ui[600];
}
