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
import { MaShanZheng_400Regular } from "@expo-google-fonts/ma-shan-zheng/400Regular";
import { platform } from "@soulledger/core/platform";
import * as Font from "expo-font";
import { useEffect, useState } from "react";

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
  // Status glyphs (Design E 组): ✓✕◇↺◌○▣↻◎≡? from ONE font. Archivo has only ≡ and ?, so each
  // fell back to the OS per glyph — ◌ from one font, its neighbours from another. 5 KB, the same
  // bytes the web serves (scripts/build-glyph-font.py; DejaVu Sans subset, licence beside it).
  SoulLedgerGlyphs: require("../assets/fonts/SoulLedgerGlyphs.ttf"),
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
  /** Badge glyphs only (`Badge` in ui.tsx) — the family has no letters beyond `?`. */
  glyph: "SoulLedgerGlyphs",
  /** 印文: 霞鹜篆书 · 花体首字母 · 圣书字 · GFS Didot. Never translated (补足 A6). */
  seal: { cn: "LXGWSeal_400", eu: "UnifrakturMaguntia_400Regular", eg: "NotoSansEgyptianHieroglyphs_400Regular", gr: "GFSDidot_400Regular" },
  /**
   * 匾题字. 地府's is Ma Shan Zheng (`PLAQUE_CN`), which is not here: it loads for 地府
   * souls only (see below), and until it has, 地府 titles fall back to the spec stack's second
   * family, the bundled Noto Serif SC subset.
   */
  plaque: { cn: "NotoSerifSC_400", eu: "UnifrakturMaguntia_400Regular", eg: "JosefinSlab_400Regular", gr: "Cinzel_400Regular" },
} as const satisfies {
  ui: Record<number, FontName>;
  mono: Record<number, FontName>;
  serif: FontName;
  serifHan: FontName;
  glyph: FontName;
  seal: Record<Exclude<CivKey, "neutral">, FontName>;
  plaque: Record<Exclude<CivKey, "neutral">, FontName>;
};

const HAN = /[㐀-鿿豈-﫿]/;

/**
 * 地府's plaque face, Ma Shan Zheng — the whole font, 5.86 MB, not a subset (user decision
 * 2026-09-30). It ships in the app like every font, but is registered only for a 地府 soul:
 * the moment the session says so (`rememberPlaqueFace`), then at every cold start under the
 * splash (`bootPlaqueFace`), and — as a last resort — when a 地府 plaque is drawn
 * (`usePlaqueFace`). The other three civilizations never pay the load.
 */
export const PLAQUE_CN = "MaShanZheng_400Regular";

/**
 * In `platform().persistent`: set while the signed-in soul is 地府's, so the next cold start
 * loads Ma Shan Zheng under the native splash (`bootPlaqueFace`) and the first plaque is
 * already in it — no Noto Serif SC frame, then a swap. Any other outcome removes it.
 */
export const PLAQUE_CN_KEY = "soul_plaque_cn";

let plaqueLoad: Promise<void> | null = null;

/** Start loading 地府's plaque face now; one request however often it is asked. Never rejects. */
export function preloadPlaqueFace(): Promise<void> {
  if (Font.isLoaded(PLAQUE_CN)) return Promise.resolve();
  // Shared only while in flight: once done, `isLoaded` answers, and a failed load may be asked again
  // (the title stays in the fallback meanwhile).
  plaqueLoad ??= Font.loadAsync({ [PLAQUE_CN]: MaShanZheng_400Regular })
    .catch(() => {})
    .finally(() => {
      plaqueLoad = null;
    });
  return plaqueLoad;
}

/** Who the session says is signed in decides whether the next cold start loads the face. */
export function rememberPlaqueFace(civ: CivKey | null): void {
  if (civ === "cn") {
    platform().persistent.set(PLAQUE_CN_KEY, "1");
    void preloadPlaqueFace();
  } else platform().persistent.remove(PLAQUE_CN_KEY);
}

/** At boot, under the splash, once the persistent store is hydrated: the face, if the last soul was 地府's. */
export function bootPlaqueFace(): Promise<void> {
  return platform().persistent.get(PLAQUE_CN_KEY) ? preloadPlaqueFace() : Promise.resolve();
}

/**
 * Whether 地府's plaque face is ready. For any other civilization: false, and nothing is
 * loaded. A failed load leaves it false — the title stays in the fallback, never blank.
 */
export function usePlaqueFace(civ: CivKey): boolean {
  const wanted = civ === "cn";
  const [loaded, setLoaded] = useState(() => Font.isLoaded(PLAQUE_CN));
  useEffect(() => {
    if (!wanted || loaded) return;
    let alive = true;
    void preloadPlaqueFace().then(() => alive && setLoaded(Font.isLoaded(PLAQUE_CN)));
    return () => {
      alive = false;
    };
  }, [wanted, loaded]);
  return wanted && loaded;
}

/**
 * A plaque title's family. 地府: Ma Shan Zheng once `cnFaceReady`, else Noto Serif SC. The
 * others: the civilization's display face, or — for Han text, which none of the Latin faces
 * has — the Chinese serif, as the spec's stack falls back (`'Josefin Slab','Noto Serif SC',serif`).
 * React Native has no per-glyph stack.
 */
export function plaqueFamily(civ: Exclude<CivKey, "neutral">, text: string, cnFaceReady = false): string {
  if (civ === "cn") return cnFaceReady ? PLAQUE_CN : family.serifHan;
  return HAN.test(text) ? family.serifHan : family.plaque[civ];
}

/** The family for quoted words: the bundled Noto Serif SC when they contain Han characters, else Source Serif 4. */
export function quoteFamily(text: string): string {
  return HAN.test(text) ? family.serifHan : family.serif;
}
