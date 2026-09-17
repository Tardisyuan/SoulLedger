/**
 * The three families and what each is for — strictly:
 *
 *   ui     Archivo            interface text
 *   mono   IBM Plex Mono      every value a person could check against a record:
 *                            codes, dates, counts, scores, raw enum members
 *   serif  Source Serif 4     only words someone SAID: a statement, an appeal,
 *                            a rejection reason
 *
 * React Native has no font-family fallback list and picks no file by
 * `fontWeight` for a custom family, so each weight is its own family name.
 * Han glyphs are not in any of the three; for `ui` and `mono` the OS falls back
 * to its CJK sans (PingFang / Noto Sans CJK — 黑体), which is what the design
 * asks for. For `serif` that same fallback would give a sans, so quoted text
 * containing Han characters picks the platform's CJK serif (宋体) itself.
 */
import { Archivo_400Regular } from "@expo-google-fonts/archivo/400Regular";
import { Archivo_500Medium } from "@expo-google-fonts/archivo/500Medium";
import { Archivo_600SemiBold } from "@expo-google-fonts/archivo/600SemiBold";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono/400Regular";
import { IBMPlexMono_500Medium } from "@expo-google-fonts/ibm-plex-mono/500Medium";
import { SourceSerif4_400Regular } from "@expo-google-fonts/source-serif-4/400Regular";
import { Platform } from "react-native";

export const FONT_ASSETS = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  SourceSerif4_400Regular,
};

type FontName = keyof typeof FONT_ASSETS;

export const family = {
  ui: { 400: "Archivo_400Regular", 500: "Archivo_500Medium", 600: "Archivo_600SemiBold" },
  mono: { 400: "IBMPlexMono_400Regular", 500: "IBMPlexMono_500Medium" },
  serif: "SourceSerif4_400Regular",
} as const satisfies { ui: Record<number, FontName>; mono: Record<number, FontName>; serif: FontName };

const HAN = /[㐀-鿿豈-﫿]/;

/** The family for quoted words: Source Serif 4, or the system's CJK serif when the words are Chinese. */
export function quoteFamily(text: string): string {
  if (!HAN.test(text)) return family.serif;
  return Platform.select({ ios: "Songti SC", default: "serif" });
}
