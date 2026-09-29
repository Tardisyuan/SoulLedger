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
import { Cinzel_400Regular } from "@expo-google-fonts/cinzel/400Regular";
import { GFSDidot_400Regular } from "@expo-google-fonts/gfs-didot/400Regular";
import { JosefinSlab_400Regular } from "@expo-google-fonts/josefin-slab/400Regular";
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
  // Regular only: nothing sets quoted words in a heavier weight. The 600 subset
  // (1.49 MB) was bundled with no caller and removed 2026-09-18.
  NotoSerifSC_400: require("../assets/fonts/NotoSerifSC-Subset-400.ttf"),
  // v2 朱印 (规范 v2 §印 / §匾): the seal's glyph and the plaque's title, per civilization.
  // Loaded with the rest at boot, under the native splash — from the bundle, not the network,
  // so there is no "load on demand" to win. Together ≈ 1.56 MB, 1.0 MB of it the hieroglyphs.
  LXGWSeal_400: require("../assets/fonts/LXGWSeal-Regular.ttf"),
  UnifrakturMaguntia_400Regular,
  NotoSansEgyptianHieroglyphs_400Regular,
  GFSDidot_400Regular,
  JosefinSlab_400Regular,
  Cinzel_400Regular,
};

type FontName = keyof typeof FONT_ASSETS;

export const family = {
  ui: { 400: "Archivo_400Regular", 500: "Archivo_500Medium", 600: "Archivo_600SemiBold" },
  mono: { 400: "IBMPlexMono_400Regular", 500: "IBMPlexMono_500Medium" },
  serif: "SourceSerif4_400Regular",
  serifHan: "NotoSerifSC_400",
  /** 印文: 霞鹜篆书 · 花体首字母 · 圣书字 · GFS Didot. Never translated (补足 A6). */
  seal: { cn: "LXGWSeal_400", eu: "UnifrakturMaguntia_400Regular", eg: "NotoSansEgyptianHieroglyphs_400Regular", gr: "GFSDidot_400Regular" },
  /**
   * 匾题字. 地府's is Ma Shan Zheng in the spec; its one file is 5.9 MB, so the App sets
   * Han titles in the bundled Noto Serif SC subset — the spec stack's own second family
   * (`plaqueFamily`) — until someone decides a subset of it is worth carrying.
   */
  plaque: { cn: "NotoSerifSC_400", eu: "UnifrakturMaguntia_400Regular", eg: "JosefinSlab_400Regular", gr: "Cinzel_400Regular" },
} as const satisfies {
  ui: Record<number, FontName>;
  mono: Record<number, FontName>;
  serif: FontName;
  serifHan: FontName;
  seal: Record<Exclude<CivKey, "neutral">, FontName>;
  plaque: Record<Exclude<CivKey, "neutral">, FontName>;
};

const HAN = /[㐀-鿿豈-﫿]/;

/**
 * A plaque title's family: the civilization's display face, or — for Han text, which
 * none of the Latin faces has — the Chinese serif, as the spec's stack falls back
 * (`'Josefin Slab','Noto Serif SC',serif`). React Native has no per-glyph stack.
 */
export function plaqueFamily(civ: Exclude<CivKey, "neutral">, text: string): string {
  return HAN.test(text) ? family.serifHan : family.plaque[civ];
}

/** The family for quoted words: the bundled Noto Serif SC when they contain Han characters, else Source Serif 4. */
export function quoteFamily(text: string): string {
  return HAN.test(text) ? family.serifHan : family.serif;
}
