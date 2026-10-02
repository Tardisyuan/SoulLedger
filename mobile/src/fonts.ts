/**
 * The three families and what each is for — strictly:
 *
 *   ui     Archivo            interface text
 *   mono   IBM Plex Mono      every value a person could check against a record:
 *                            codes, dates, counts, scores, raw enum members
 *   serif  Source Serif 4     only words someone SAID: a statement, an appeal,
 *          + Noto Serif SC    a rejection reason (the Han serif, a bundled subset);
 *                            one exception: the app name on the pre-login bar
 *                            (`AppHeader serif`, product decision 2026-09-26)
 *   title  Noto Serif SC 600  titles and display text (`TYPE.title` / `TYPE.display`):
 *                            v3 第一批「标题与展示大字用衬线 Noto Serif SC 600」. Its Latin
 *                            letters are Noto's own serif, as the web's `font-title` draws them
 *
 * React Native has no font-family fallback list and picks no file by
 * `fontWeight` for a custom family, so each weight is its own family name.
 * Han glyphs are not in Archivo or Plex Mono; for `ui` and `mono` the OS falls
 * back to its CJK sans (PingFang / Noto Sans CJK — 黑体), which is what the
 * design asks for. For quotes that fallback would give a sans, and iOS ships no
 * CJK serif at all (Songti SC is an on-demand download, absent on the
 * simulator), so quoted text containing Han characters uses the bundled
 * Noto Serif SC subset: 通用规范汉字表 一级 3500 字 + punctuation, built by
 * `mobile/scripts/subset-serif-sc.sh` (SIL OFL 1.1, `assets/fonts/OFL.txt`).
 * A rarer character outside the subset falls back to the system font, glyph
 * by glyph.
 */
import { Archivo_400Regular } from "@expo-google-fonts/archivo/400Regular";
import { Archivo_500Medium } from "@expo-google-fonts/archivo/500Medium";
import { Archivo_600SemiBold } from "@expo-google-fonts/archivo/600SemiBold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4/400Regular";
import { GFSDidot_400Regular } from "@expo-google-fonts/gfs-didot/400Regular";
import { NotoSansEgyptianHieroglyphs_400Regular } from "@expo-google-fonts/noto-sans-egyptian-hieroglyphs/400Regular";
import { UnifrakturMaguntia_400Regular } from "@expo-google-fonts/unifrakturmaguntia/400Regular";

import type { CivKey } from "./theme";

export const FONT_ASSETS = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  SourceSerif4_400Regular,
  // Quoted words are Regular. The 600 subset (1.49 MB, the same charset) is v3's titles and
  // display text; it was dropped 2026-09-18 when nothing called it and is back for `family.title`.
  NotoSerifSC_400: require("../assets/fonts/NotoSerifSC-Subset-400.ttf"),
  NotoSerifSC_600: require("../assets/fonts/NotoSerifSC-Subset-600.ttf"),
  // v2 朱印 (规范 v2 §印): the cold start's seal glyph, per civilization; the hieroglyphs are also
  // v3's outline seal's for 埃及. Loaded with the rest at boot, under the native splash. v2's plaque
  // title faces (Josefin Slab, Cinzel; 地府's Ma Shan Zheng, loaded per soul) went with v2's plaque
  // (2026-10-02): v3's band sets its title in the interface face.
  LXGWSeal_400: require("../assets/fonts/LXGWSeal-Regular.ttf"),
  // Status glyphs (Design E 组): ✓✕◇↺◌○▣↻◎≡?◐⇄ from ONE font. Archivo has only ≡ and ?, so each
  // fell back to the OS per glyph — ◌ from one font, its neighbours from another. 5 KB, the same
  // bytes the web serves (scripts/build-glyph-font.py; DejaVu Sans subset, licence beside it).
  SoulLedgerGlyphs: require("../assets/fonts/SoulLedgerGlyphs.ttf"),
  UnifrakturMaguntia_400Regular,
  NotoSansEgyptianHieroglyphs_400Regular,
  GFSDidot_400Regular,
};

type FontName = keyof typeof FONT_ASSETS;

export const family = {
  ui: { 400: "Archivo_400Regular", 500: "Archivo_500Medium", 600: "Archivo_600SemiBold" },
  mono: { 400: "IBMPlexMono_400Regular", 500: "IBMPlexMono_500Medium" },
  serif: "SourceSerif4_400Regular",
  serifHan: "NotoSerifSC_400",
  /** v3 titles and display text: Noto Serif SC 600 (bundled subset; a rarer Han character falls back per glyph). */
  title: "NotoSerifSC_600",
  /** Badge glyphs only (`Badge` in ui.tsx) — the family has no letters beyond `?`. */
  glyph: "SoulLedgerGlyphs",
  /** 印文: 霞鹜篆书 · 花体首字母 · 圣书字 · GFS Didot. Never translated (补足 A6). */
  seal: { cn: "LXGWSeal_400", eu: "UnifrakturMaguntia_400Regular", eg: "NotoSansEgyptianHieroglyphs_400Regular", gr: "GFSDidot_400Regular" },
} as const satisfies {
  ui: Record<number, FontName>;
  mono: Record<number, FontName>;
  serif: FontName;
  serifHan: FontName;
  title: FontName;
  glyph: FontName;
  seal: Record<Exclude<CivKey, "neutral">, FontName>;
};

const HAN = /[㐀-鿿豈-﫿]/;

/** The family for quoted words: the bundled Noto Serif SC when they contain Han characters, else Source Serif 4. */
export function quoteFamily(text: string): string {
  return HAN.test(text) ? family.serifHan : family.serif;
}
