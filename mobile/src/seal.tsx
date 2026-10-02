/**
 * The seal (规范 v3 `.product-seal`). v2's filled「朱印」— body, edge-scan ring, frame drawings,
 * the 霞鹜篆书 / 花体 / GFS Didot glyph faces — went with its last caller, the cold start, which
 * writes the brand mark instead (src/coldStart.tsx, 2026-10-03).
 *
 * The glyph is data — `tenant.seal_glyphs`, 1–2 characters an admin sets — and when
 * that is empty, the civilization's default. It is never translated: a seal is an
 * object, not interface text. A screen reader hears the language pack's
 * 「第五殿之印」 (`seal.aria`), never the glyph.
 */
import { StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { family, quoteFamily } from "./fonts";
import type { CivKey } from "./theme";

export type SealCiv = Exclude<CivKey, "neutral">;

/** 补足 A6: 冥 · J (Justitia) · 𓆄 U+13184 (玛特之羽) · Μ U+039C (米诺斯). */
export const DEFAULT_GLYPHS: Record<SealCiv, string> = { cn: "冥", eu: "J", eg: "\u{13184}", gr: "Μ" };

/**
 * What a seal shows: the tenant's glyphs when they are usable, else the default.
 * Usable = one glyph, or two for 杜阿特 only (A6: 只有埃及允许 2). The server
 * validates the same rule; this is the fallback for anything that slips past it.
 */
export function sealGlyphs(civ: SealCiv, glyphs: readonly string[] | null | undefined): string[] {
  const max = civ === "eg" ? 2 : 1;
  return glyphs && glyphs.length >= 1 && glyphs.length <= max && glyphs.every(Boolean) ? [...glyphs] : [DEFAULT_GLYPHS[civ]];
}

/**
 * v3 印 (规范 v3 `.product-seal`; the Web's `Seal.tsx` since v3/band2): an OUTLINE, never a
 * filled body — a 2px outer frame and a 1px inner frame 6px in (≤ 32: 1px, 4px in), in one
 * colour: the civilization's (`theme.plaque`) on a page, white (`onPlaque`) on the band, which
 * is itself that colour. The shape says the civilization: 地府 square, 欧洲 circle, 埃及 arch
 * (64 × 70, round top), 希腊 hexagon. The glyph is `sealGlyphs` above, set in the app's
 * serif (Noto Serif SC for Han, Source Serif 4 for J / Μ) — the App bundles Noto Serif SC at
 * 400 only — and the hieroglyph face for 埃及. A soul of no known civilization has no seal.
 */
const EG_ASPECT = 70 / 64;
/** Glyph size = seal width × this: v3 draws 64 → 28 and 30 → 15; two hieroglyphs 0.34 each. */
const OUTLINE_GLYPH = 0.44;
const OUTLINE_GLYPH_SMALL = 0.5;
const OUTLINE_GLYPH_PAIR = 0.34;

/** The shape's outline, `i` in from a w × h box (a stroke centred on it). */
export function sealOutline(civ: SealCiv, w: number, h: number, i: number): string {
  const r = (n: number) => Math.round(n * 100) / 100;
  if (civ === "eu") {
    const cx = w / 2;
    const rad = w / 2 - i;
    return `M${r(cx - rad)} ${r(h / 2)}A${r(rad)} ${r(rad)} 0 1 0 ${r(cx + rad)} ${r(h / 2)}A${r(rad)} ${r(rad)} 0 1 0 ${r(cx - rad)} ${r(h / 2)}Z`;
  }
  if (civ === "eg") {
    const rad = w / 2 - i;
    return `M${r(i)} ${r(h - i)}V${r(i + rad)}A${r(rad)} ${r(rad)} 0 0 1 ${r(w - i)} ${r(i + rad)}V${r(h - i)}Z`;
  }
  if (civ === "gr") {
    const pts: [number, number][] = [[0.12, 0], [0.88, 0], [1, 0.5], [0.88, 1], [0.12, 1], [0, 0.5]];
    return `M${pts.map(([x, y]) => `${r(i + (w - 2 * i) * x)} ${r(i + (h - 2 * i) * y)}`).join("L")}Z`;
  }
  return `M${r(i)} ${r(i)}H${r(w - i)}V${r(h - i)}H${r(i)}Z`;
}

/** A glyph's face: hieroglyphs in theirs, Han and Latin / Greek in the app's two serifs. */
const outlineFace = (g: string) => ((g.codePointAt(0) ?? 0) >= 0x13000 ? family.hieroglyph : quoteFamily(g));

export function OutlineSeal({
  civ,
  size,
  color,
  glyphs,
  label,
  testID,
}: {
  civ: CivKey;
  /** The width; 埃及's arch is 70/64 of it tall. */
  size: number;
  /** The plaque colour on a page; `onPlaque` on the band. */
  color: string;
  glyphs?: readonly string[] | null;
  /** 「第五殿之印」, from `seal.aria`. Absent: decoration beside words that say the same. */
  label?: string;
  testID?: string;
}) {
  if (civ === "neutral") return null;
  const small = size <= 32;
  const w = size;
  const h = civ === "eg" ? Math.round(size * EG_ASPECT) : size;
  const shown = sealGlyphs(civ, glyphs);
  const pair = shown.length === 2;
  const fontSize = Math.round(size * (pair ? OUTLINE_GLYPH_PAIR : small ? OUTLINE_GLYPH_SMALL : OUTLINE_GLYPH));
  const a11y = label
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
  return (
    <View testID={testID} style={{ width: w, height: h }} {...a11y}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Path testID={testID && `${testID}-outer`} d={sealOutline(civ, w, h, small ? 0.5 : 1)} fill="none" stroke={color} strokeWidth={small ? 1 : 2} />
        <Path testID={testID && `${testID}-inner`} d={sealOutline(civ, w, h, small ? 3.5 : 5.5)} fill="none" stroke={color} strokeWidth={1} />
      </Svg>
      <View style={styles.glyphs}>
        {shown.map((g, i) => (
          <Text
            key={i}
            testID={testID && `${testID}-glyph`}
            allowFontScaling={false}
            style={[styles.glyph, { fontFamily: outlineFace(g), fontSize, lineHeight: Math.round(fontSize * 1.15), color }]}
          >
            {g}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  glyphs: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
  glyph: { textAlign: "center", includeFontPadding: false },
});
