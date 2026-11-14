/**
 * The civilization on a page's head, for both apps (Design v4 第四十六批第四节「两个 App：跟」; the officer app reaches
 * this file through `mobile-officer/src/shared.ts`). The web's versions are `frontend/app/globals.css`
 * (`.page-head-topline`, `.page-head-pat`, `.page-head-mark`) and `frontend/src/components/brand/HeadMark.tsx`.
 *
 *   Topline      the line across the top of the screen, inset 30 each side (clear of the rounded corners). The web's
 *                four shapes, 3 high: 地府 solid · 欧洲 1 + gap 1 + 1 · 埃及 a 6 gap every 48 · 希腊 a 1 base line under
 *                2-high teeth (4 wide, every 8). The neutral skin: 2, solid. React Native has no CSS gradients, so
 *                the shapes are Views.
 *   HeadTexture  the paper texture (第四十五批第五节), only under a first-level page's head: ink at 6% dark / 5% light,
 *                solid over the top 40%, fading out below. Never the civilization's colour. The neutral skin has none.
 *   HeadMark     the mark at the head's top right, only on 官员端「案卷」 and 灵魂端「此生」: 80% of the web's size, ink at
 *                34% / 30%, hidden from screen readers (it is ornament, not words to read).
 *
 * Imports only leaf modules (`ui`, `i18n`, `fonts`, `theme`) — never `session`: the officer app shares this file, and
 * each app hands `HeadMark` its own hall names.
 */
import type { Locale } from "@soulledger/core/config/locale";
import { Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Ellipse, LinearGradient, Path, Stop, Text as SvgText } from "react-native-svg";

import { family, titleFamily } from "./fonts";
import { useI18n } from "./i18n";
import type { CivKey } from "./theme";
import { useTheme } from "./ui";

// ── the top line ───────────────────────────────────────────────────────

/** Clear of the screen's rounded corners, each side. */
export const TOPLINE_INSET = 30;

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The top line's pieces for a line `width` wide; its height is the lowest piece's foot (3, the neutral skin 2). */
export function toplineBars(civ: CivKey, width: number): Bar[] {
  // `on` long pieces every `period`, the last one cut at the line's end.
  const run = (period: number, on: number, y: number, h: number): Bar[] =>
    Array.from({ length: Math.max(0, Math.ceil(width / period)) }, (_, i) => ({ x: i * period, y, w: Math.min(on, width - i * period), h }));
  switch (civ) {
    case "cn":
      return [{ x: 0, y: 0, w: width, h: 3 }];
    case "eu":
      return [
        { x: 0, y: 0, w: width, h: 1 },
        { x: 0, y: 2, w: width, h: 1 },
      ];
    case "eg":
      return run(48, 42, 0, 3);
    case "gr":
      return [...run(8, 4, 0, 2), { x: 0, y: 2, w: width, h: 1 }];
    default:
      return [{ x: 0, y: 0, w: width, h: 2 }];
  }
}

/** Drawn over the frame at the very top of the screen, holds no touch. In the civilization's colour (one of its four places). */
export function Topline() {
  const t = useTheme();
  const { width: screen } = useWindowDimensions();
  const bars = toplineBars(t.civ, Math.max(0, screen - 2 * TOPLINE_INSET));
  const height = Math.max(...bars.map((b) => b.y + b.h));
  return (
    <View testID="topline" pointerEvents="none" style={{ position: "absolute", top: 0, left: TOPLINE_INSET, right: TOPLINE_INSET, height }}>
      {bars.map((b, i) => (
        <View key={i} testID="topline-bar" style={{ position: "absolute", left: b.x, top: b.y, width: b.w, height: b.h, backgroundColor: t.plaque }} />
      ))}
    </View>
  );
}

// ── the paper texture ──────────────────────────────────────────────────

/** The web's `--head-tex`: ink at 6% dark, 5% light. */
export const TEXTURE_ALPHA = { dark: 0.06, light: 0.05 } as const;

/**
 * The web's four `.page-head-pat` gradients, drawn for a `width` × `height` box: 地府 a 1-wide vertical every 24 (稿纸) ·
 * 欧洲 1-wide 45° hatching every 6 (铜版排线) · 埃及 a 1-high rule every 22 (纸草分栏) · 希腊 dots r 1.3 every 8 (陶片颗粒).
 * `fill`: the dots are filled, the rest are strokes 1 wide.
 */
export function headTextureShape(civ: Exclude<CivKey, "neutral">, width: number, height: number): { d: string; fill: boolean } {
  const steps = (from: number, to: number, step: number) => Array.from({ length: Math.max(0, Math.floor((to - from) / step) + 1) }, (_, i) => from + i * step);
  if (civ === "cn") return { fill: false, d: steps(0.5, width, 24).map((x) => `M${x} 0V${height}`).join("") };
  if (civ === "eg") return { fill: false, d: steps(21.5, height, 22).map((y) => `M0 ${y}H${width}`).join("") };
  if (civ === "eu") {
    // repeating-linear-gradient(45deg): the stripes run down to the right, 6 apart across them — 6√2 along a row.
    return { fill: false, d: steps(-height, width, 6 * Math.SQRT2).map((x) => `M${x.toFixed(2)} 0L${(x + height).toFixed(2)} ${height}`).join("") };
  }
  const r = 1.3;
  const dots: string[] = [];
  for (const x of steps(4, width, 8)) for (const y of steps(4, height, 8)) dots.push(`M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`);
  return { fill: true, d: dots.join("") };
}

export function HeadTexture({ width, height, testID = "head-texture" }: { width: number; height: number; testID?: string }) {
  const t = useTheme();
  if (t.civ === "neutral" || !width || !height) return null;
  const { d, fill } = headTextureShape(t.civ, width, height);
  const alpha = TEXTURE_ALPHA[t.scheme];
  const paint = "url(#head-tex)";
  return (
    <Svg testID={testID} pointerEvents="none" width={width} height={height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Defs>
        <LinearGradient id="head-tex" x1={0} y1={0} x2={0} y2={height} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={t.ink} stopOpacity={alpha} />
          <Stop offset={0.4} stopColor={t.ink} stopOpacity={alpha} />
          <Stop offset={1} stopColor={t.ink} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Path d={d} fill={fill ? paint : "none"} stroke={fill ? "none" : paint} strokeWidth={fill ? 0 : 1} />
    </Svg>
  );
}

// ── the head mark ──────────────────────────────────────────────────────

/** The web's `--head-mark`: ink at 34% dark, 30% light. */
export const MARK_ALPHA = { dark: 0.34, light: 0.3 } as const;
/** 第四十六批第三节: when the title's right edge comes nearer the mark than this, the mark is not drawn at all. */
export const MARK_CLEARANCE = 24;
/** Right of the head's edge, and down from the head's top (under the status bar), per civilization. */
export const MARK_TOP: Record<Exclude<CivKey, "neutral">, number> = { cn: 12, eu: 16, eg: 14, gr: 16 };
/** 地府 longer than this falls back to 地府 / DIYU (第四十六批第三节). */
export const HAN_MAX = 5;
export const LATIN_MAX = 14;

/**
 * The hall's own name in the interface language, as the web's `useHallName`: egy without one of its own (the server
 * falls back to zh) is English — an egy screen shows no Han hall name. None at all (an old cached profile): undefined.
 */
export function hallNameFor(names: Readonly<Record<string, string>> | null | undefined, locale: Locale): string | undefined {
  if (!names) return undefined;
  const zh = names["zh-Hans"];
  if (locale === "zh-Hans") return zh || undefined;
  if (locale === "egy" && names.egy && names.egy !== zh) return names.egy;
  return names.en || undefined;
}

/** 地府's mark: the hall's name set vertically — Han one character a line, otherwise Latin capitals turned 90°. */
export function diyuMark(name: string | undefined, locale: Locale): { script: "han" | "latin"; text: string } {
  if (locale === "zh-Hans") {
    const n = Array.from(name ?? "").length;
    return { script: "han", text: name && n <= HAN_MAX ? name : "地府" };
  }
  const up = (name ?? "").toUpperCase();
  return { script: "latin", text: up && Array.from(up).length <= LATIN_MAX ? up : "DIYU" };
}

/** Whether the mark may be drawn: the text beside it ends at least `MARK_CLEARANCE` short of its left edge. */
export const markFits = (textRight: number, markLeft: number) => textRight + MARK_CLEARANCE <= markLeft;

/** The web's 80%: 地府 Han 20/23, its Latin 10 (the web's 12) with .28em; 欧洲 / 希腊 14 with .38em; 埃及's drawing 90 × 24. */
const HAN = { fontSize: 20, lineHeight: 23 };
const LATIN_V = { size: 10, spacing: 2.8, width: 13 };
const WORD = { fontSize: 14, lineHeight: 17, letterSpacing: 14 * 0.38 };

/**
 * `names`: the hall's `hall_names` (the soul's `/me/` tenant, the officer's login tenant). `right`: from the head's right
 * edge (20, or past a button group: 20 + its width + 16). `hidden`: laid out (so `onLayout` can measure it) but not
 * shown — the caller's `markFits` said no.
 */
export function HeadMark({
  names,
  right = 20,
  top = 0,
  hidden,
  onLayout,
}: {
  names?: Readonly<Record<string, string>> | null;
  right?: number;
  top?: number;
  hidden?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const t = useTheme();
  const { locale } = useI18n();
  if (t.civ === "neutral") return null;
  const color = t.ink;
  let body;
  if (t.civ === "cn") {
    const { script, text } = diyuMark(hallNameFor(names, locale), locale);
    if (script === "han") {
      body = Array.from(text).map((ch, i) => (
        <Text key={i} allowFontScaling={false} style={[HAN, { fontFamily: titleFamily(ch), color, textAlign: "center" }]}>
          {ch}
        </Text>
      ));
    } else {
      // No `writing-mode` in React Native: the word is drawn turned 90° (reading down), as the web's vertical-rl.
      const length = Math.ceil(Array.from(text).length * (LATIN_V.size * 0.75 + LATIN_V.spacing));
      body = (
        <Svg width={LATIN_V.width} height={length}>
          <SvgText x={0} y={0} transform="translate(3 0) rotate(90)" fill={color} fontSize={LATIN_V.size} fontWeight="600" letterSpacing={LATIN_V.spacing} fontFamily={family.serif}>
            {text}
          </SvgText>
        </Svg>
      );
    }
  } else if (t.civ === "eg") {
    // 安卡、玛阿特之羽、荷鲁斯之眼、柱形 — the web's drawing (HeadMark.tsx), path for path; not Unicode hieroglyphs.
    body = (
      <Svg width={90} height={24} viewBox="0 0 112 30" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <Ellipse cx={12} cy={7} rx={4.5} ry={5.5} />
        <Path d="M4 14h16M12 12.5V28" />
        <Path d="M40 28C40 18 37 9 33 3c6 3 10 10 10 18 0 3-1 5-3 7z" fill={color} stroke="none" />
        <Path d="M58 13c5-6 15-6 20 0-5 5-15 5-20 0z" />
        <Circle cx={68} cy={13} r={2.6} fill={color} stroke="none" />
        <Path d="M57 8c6-4 16-4 22 0M64 18v7c0 2-2 3-4 2M72 18c2 4 6 6 10 5" />
        <Path d="M96 4v22M90 26h12M92 4h8" />
      </Svg>
    );
  } else {
    // IVSTITIA / ΚΡΙΣΙΣ (「审判」): ornament, not translated.
    body = (
      <Text allowFontScaling={false} style={[WORD, { fontFamily: family.serif, color }]}>
        {t.civ === "eu" ? "IVSTITIA" : "ΚΡΙΣΙΣ"}
      </Text>
    );
  }
  return (
    <View
      testID={`head-mark-${t.civ}`}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={onLayout}
      style={{ position: "absolute", right, top: top + MARK_TOP[t.civ], opacity: hidden ? 0 : MARK_ALPHA[t.scheme], alignItems: "center" }}
    >
      {body}
    </View>
  );
}
