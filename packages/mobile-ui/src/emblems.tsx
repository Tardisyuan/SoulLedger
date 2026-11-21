/**
 * The four civilization emblems, the neutral mark, and the handful of line
 * icons the screens use — all transcribed from the design handoff's SVG. One
 * `stroke`: a caller passes one ink and nothing else about colour.
 *
 * Every place the app draws a civilization emblem is 12–16pt (inline, divider), so the four
 * civilizations use Design v4 batch 24's small marks — the armillary sphere: a ring, the horizon band
 * sticking out of it, and each civilization's centre (`soulledger-emblem-<civ>-mark.svg`, 24 grid —
 * the same files as the web's `public/v4/emblems/`): the full 240 emblems turn to mud below 24. The neutral skin keeps the ledger-and-brush mark (viewBox 48), whose
 * `full` / `compact` drawings are picked by size.
 */
import type { ReactNode } from "react";
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";

import type { CivKey } from "./theme";

type Drawing = {
  rect?: { x: number; y: number; width: number; height: number; rx?: number };
  circle?: { cx: number; cy: number; r: number };
  paths: string[];
};

const BRUSH = "M37.5 5.5l4.5 4.5-15.5 15.5-5.5 1.5 1.5-5.5z";
const LEDGER_RECT = { x: 8, y: 12, width: 26, height: 30 };

/** The ledger with a judge's brush — the app's own mark (neutral skin). */
const LEDGER: Record<"full" | "compact", Drawing> = {
  full: { rect: LEDGER_RECT, paths: ["M14 12v30M8 20.5h26M8 29h26", BRUSH] },
  compact: { rect: LEDGER_RECT, paths: ["M14 12v30M8 20.5h26", BRUSH] },
};

/** Batch 24 small marks, viewBox 24, element for element; `ink` is the caller's one colour. */
const BAND = "M22.75 8.51L22.8 8.74L22.8 8.98L22.76 9.24L22.67 9.51L22.53 9.79L22.35 10.08L22.13 10.38L21.86 10.69M3.25 16.74L2.85 16.65L2.5 16.54L2.18 16.41L1.91 16.26L1.68 16.09L1.49 15.91L1.35 15.71L1.25 15.49L1.2 15.26L1.2 15.02L1.24 14.76L1.33 14.49L1.47 14.21L1.65 13.92L1.87 13.62L2.14 13.31M20.75 7.26L21.15 7.35L21.5 7.46L21.82 7.59L22.09 7.74L22.32 7.91L22.51 8.09L22.65 8.29L22.75 8.51";
const MARKS: Record<Exclude<CivKey, "neutral">, (ink: string) => ReactNode> = {
  cn: (ink) => <Circle cx={12} cy={12} r={3.6} fill={ink} />,
  eu: (ink) => (
    <>
      <Circle cx={12} cy={12} r={3.9} fill="none" stroke={ink} strokeWidth={1.2} />
      <Path d="M9.9 11.1h4.2L12 14.3Z" fill={ink} />
    </>
  ),
  eg: (ink) => (
    <>
      <Circle cx={12} cy={12} r={2.2} fill={ink} />
      <Circle cx={12} cy={12} r={4.4} fill="none" stroke={ink} strokeWidth={1} />
    </>
  ),
  gr: (ink) => (
    <>
      <Circle cx={12} cy={12} r={4.4} fill="none" stroke={ink} strokeWidth={1.2} />
      <Path d="M12 7.6v8.8M7.6 12h8.8M10 8.1Q8.4 12 10 15.9M14 8.1Q15.6 12 14 15.9" fill="none" stroke={ink} strokeWidth={1} />
    </>
  ),
};

function shapes(d: Drawing) {
  return (
    <>
      {d.circle ? <Circle {...d.circle} /> : null}
      {d.rect ? <Rect {...d.rect} /> : null}
      {d.paths.map((p) => (
        <Path key={p} d={p} />
      ))}
    </>
  );
}

export function Emblem({
  civ,
  size,
  stroke,
  variant = size >= 40 ? "full" : "compact",
  strokeWidth,
  testID,
}: {
  civ: CivKey;
  size: number;
  stroke: string;
  /** Neutral only: each mark is one drawing. */
  variant?: "full" | "compact";
  /** Neutral only (viewBox 48): the civilization marks carry the design's own widths. */
  strokeWidth?: number;
  testID?: string;
}) {
  if (civ !== "neutral") {
    return (
      <Svg testID={testID} width={size} height={size} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={8.2} fill="none" stroke={stroke} strokeWidth={1.5} />
        <Path d={BAND} fill="none" stroke={stroke} strokeWidth={1.3} strokeLinecap="round" />
        {MARKS[civ](stroke)}
      </Svg>
    );
  }
  // The handoff's weights: ~0.75 at watermark size, 1 at 66px, 1.6–2 inline.
  const width = strokeWidth ?? (size >= 120 ? 0.75 : size >= 40 ? 1 : 1.8);
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={stroke} strokeWidth={width}>
      {shapes(LEDGER[variant])}
    </Svg>
  );
}

// ── civilization flavour (handoff "灵魂簿 App · 文明气质", 1c–1h) ─────────────
// Copied path for path from the handoff's data block. Line art only, one stroke
// (the civilization's mark); the neutral theme uses only circles and rules.

/**
 * The one illustration per civilization (1e), viewBox 48: `f` at 72 for the
 * whole-page empty states and the welcome, `c` (outline and base only) at 24–28.
 */
export const HERO: Record<CivKey, { f: string; c: string }> = {
  neutral: { f: "M24 8A16 16 0 1 1 23.9 8M8 40H40", c: "M24 10A14 14 0 1 1 23.9 10" },
  cn: { f: "M6 14H42M10 10H38M12 14V42M36 14V42M20 14V42M28 14V42M6 42H42M16 22H32", c: "M6 12H42M12 12V42M36 12V42M6 42H42" },
  eu: {
    f: "M10 42V20A14 14 0 0 1 38 20V42M24 6V42M10 26H38M17 20A7 7 0 0 1 31 20M10 42H38",
    c: "M10 42V20A14 14 0 0 1 38 20V42M10 42H38",
  },
  eg: {
    f: "M24 42V20M24 20C24 12 16 8 10 6C14 12 18 16 24 20C30 16 34 12 38 6C32 8 24 12 24 20M24 20C21 14 22 8 24 4C26 8 27 14 24 20M12 42H36",
    c: "M24 42V20C24 12 16 8 10 6M24 20C24 12 32 8 38 6M12 42H36",
  },
  gr: { f: "M8 10H40M10 14H38M14 14V38M22 14V38M26 14V38M34 14V38M10 38H38M6 42H42", c: "M8 10H40M14 10V42M34 10V42M6 42H42" },
};

/** The letter paper's corner (1f), 14×14, drawn for the top-left and mirrored for the other three. */
export const CORNER: Record<CivKey, string> = {
  neutral: "M1 1H6",
  cn: "M1 13V1H13M4 10V4H10V8H7",
  eu: "M1 13V5A4 4 0 0 1 5 1H13M5 13V7A2 2 0 0 1 7 5H13",
  eg: "M1 13V1H13M5 9C5 6 7 5 9 5",
  gr: "M1 13V1H13M4 10V4H9V7H7",
};

/**
 * A journey node (1g, viewBox 24): 殿 / 圈 / 门 / 台阶 — the only thing that
 * changes by civilization on a line of stops. The sentence plan draws each
 * station in ITS civilization's shape (受刑 handoff 1c).
 */
export const NODE: Record<CivKey, string> = {
  neutral: "M2 2H22V22H2Z",
  cn: "M0 6H24M3 2H21M4 6V24H20V6",
  eu: "M12 1A11 11 0 1 1 11.9 1M12 6A6 6 0 1 1 11.9 6",
  eg: "M3 24V4M21 24V4M0 4H24M0 1H24",
  gr: "M0 24H24M4 24V16H20V24M8 16V8H16V16",
};

/**
 * One stop on a line (1g): `reached` = filled (done), `current` = thick
 * stroke, otherwise a thin stroke. The caller picks the stroke colour — the
 * theme's mark for anything recorded, hair2 for not reached.
 */
export function Node({
  civ,
  size,
  stroke,
  filled,
  current,
  testID,
}: {
  civ: CivKey;
  size: number;
  stroke: string;
  filled?: boolean;
  current?: boolean;
  testID?: string;
}) {
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ overflow: "visible" }}>
      <Path
        d={NODE[civ]}
        stroke={stroke}
        strokeWidth={current ? 3.2 : filled ? 2.4 : 1.6}
        fill={filled ? stroke : "none"}
        fillOpacity={filled ? 0.35 : 0}
      />
    </Svg>
  );
}

/** The civilization's illustration: full at 72 (stroke 1.1), compact at 24 (stroke 2.4); the welcome draws it at 96, 0.9. */
export function Hero({
  civ,
  stroke,
  compact,
  size,
  strokeWidth,
  testID,
}: {
  civ: CivKey;
  stroke: string;
  compact?: boolean;
  size?: number;
  strokeWidth?: number;
  testID?: string;
}) {
  return (
    <Svg
      testID={testID}
      width={size ?? (compact ? 24 : 72)}
      height={size ?? (compact ? 24 : 72)}
      viewBox="0 0 48 48"
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth ?? (compact ? 2.4 : 1.1)}
      strokeLinecap="square"
    >
      <Path d={compact ? HERO[civ].c : HERO[civ].f} />
    </Svg>
  );
}

const patternStyle = { position: "absolute", left: 0, top: 0 } as const;

/**
 * v4 `.glowtop`: the page header's light — `radial-gradient(70% 100% at 30% 0%, glow × glowA, transparent 70%)`
 * on the page ground, where v3 had a solid band. Behind everything, never carrying meaning.
 *
 * 第四十八批第三节: it counts as the seal (the web's head watermark), on two conditions — only under a page's
 * head, and never stronger than the web's head glow (`--glowA`, globals.css: dark .30, light .22). v4 printed .24
 * for light; that is over the web's, so it is .22 here too.
 */
export const GLOW_ALPHA = { dark: 0.3, light: 0.22 } as const;

export function GlowTop({ color, scheme, width, height, testID }: { color: string; scheme: "dark" | "light"; width: number; height: number; testID?: string }) {
  return (
    <Svg testID={testID} pointerEvents="none" width={width} height={height} style={patternStyle}>
      <Defs>
        <RadialGradient id="glow-top" cx={width * 0.3} cy={0} rx={width * 0.7} ry={height} gradientUnits="userSpaceOnUse">
          <Stop offset={0} stopColor={color} stopOpacity={GLOW_ALPHA[scheme]} />
          <Stop offset={0.7} stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#glow-top)" />
    </Svg>
  );
}

/**
 * v3 `CivilizationMotif context="stage"` (App.tsx; the web's `CivMotif`, JudgmentDeskStage.tsx):
 * each civilization's abstract figure stretched over the whole 「你现在在哪」 block, behind it — never carrying
 * meaning. 第四十八批第三节 A7: the figure stays, its colour is ink at the paper texture's strength
 * (`TEXTURE_ALPHA` in civHead.tsx: 6% dark / 5% light); until then it was the civilization's colour at 9%. Lines are
 * 2 wide; the hall's four nodes and 埃及's pivot are filled. The neutral skin has none.
 */
const MOTIF: Record<Exclude<CivKey, "neutral">, { lines: string[]; nodes?: { x: number; y: number; s: number }[]; pivot?: boolean }> = {
  cn: {
    lines: ["M300 0v520M255 38h90v90h-90zM270 161h60v60h-60zM242 259h116v116H242zM278 412h44v44h-44z", "M210 83h180M225 191h150M195 317h210M240 434h120"],
    nodes: [
      { x: 292, y: 75, s: 16 },
      { x: 292, y: 183, s: 16 },
      { x: 288, y: 305, s: 24 },
      { x: 292, y: 426, s: 16 },
    ],
  },
  eu: { lines: ["M110 20a190 120 0 0 0 380 0M135 92a165 105 0 0 0 330 0M163 160a137 88 0 0 0 274 0M194 224a106 68 0 0 0 212 0M225 281a75 48 0 0 0 150 0M254 332a46 30 0 0 0 92 0M300 356v164"] },
  eg: { lines: ["M300 28v464M95 260h410M130 260l-55 125h110L130 260Zm340 0-55 125h110L470 260Z", "M112 222v76m18-76v76m340-76v76m18-76v76M245 492h110"], pivot: true },
  gr: { lines: ["M276-10c85 74-68 143 18 218 56 49-10 82 6 116", "M300 324c-11 57-88 71-117 139M300 324c19 61 101 70 135 139M183 463c-7 17-9 38-7 57M435 463c9 18 12 37 11 57", "M260 45c57 48-42 93 15 142"] },
};

export const STAGE_MOTIF_OPACITY = { dark: 0.06, light: 0.05 } as const;

export function StageMotif({ civ, color, scheme, testID }: { civ: CivKey; color: string; scheme: "dark" | "light"; testID?: string }) {
  if (civ === "neutral") return null;
  const m = MOTIF[civ];
  return (
    <Svg testID={testID} pointerEvents="none" width="100%" height="100%" viewBox="0 0 600 520" preserveAspectRatio="none" style={motifStyle} opacity={STAGE_MOTIF_OPACITY[scheme]}>
      {m.lines.map((d) => (
        <Path key={d} d={d} fill="none" stroke={color} strokeWidth={2} />
      ))}
      {m.nodes?.map((n) => <Rect key={n.y} x={n.x} y={n.y} width={n.s} height={n.s} fill={color} />)}
      {m.pivot ? <Circle cx={300} cy={260} r={22} fill={color} /> : null}
    </Svg>
  );
}

const motifStyle = { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } as const;

/** The ledger crossed out: whole-screen "could not reach the ledger". */
export function LedgerUnreachable({ size, stroke }: { size: number; stroke: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={stroke} strokeWidth={1}>
      <Rect x={8} y={12} width={26} height={30} />
      <Path d="M14 12v30" />
      <Path d="M40 20l-12 12M28 20l12 12" />
    </Svg>
  );
}

export type IconName =
  | "ledger"
  | "alert"
  | "info"
  | "lock"
  | "back"
  | "arrow"
  | "chevron"
  | "chevronDown"
  | "person"
  | "copy"
  | "check"
  | "cycle"
  | "letter"
  | "plus"
  | "close"
  | "search"
  | "send"
  | "clock"
  | "circle"
  | "lamp"
  | "lampLit"
  | "more"
  | "image"
  | "tabLife"
  | "tabRebirth"
  | "tabLetters"
  | "tabCircle";

const ICONS: Record<IconName, { box: number; body: ReactNode }> = {
  ledger: { box: 16, body: [<Rect key="a" x={3} y={2.5} width={10} height={11} />, <Path key="b" d="M5.5 2.5v11M3 6.5h10" />] },
  alert: { box: 16, body: [<Path key="a" d="M8 1.5L15 14.5H1z" />, <Path key="b" d="M8 6v4M8 12h.01" />] },
  info: { box: 16, body: [<Circle key="a" cx={8} cy={8} r={6.5} />, <Path key="b" d="M8 4.5v4.5M8 11.2h.01" />] },
  lock: { box: 16, body: [<Rect key="a" x={3} y={7} width={10} height={7} />, <Path key="b" d="M5.5 7V5a2.5 2.5 0 015 0v2" />] },
  back: { box: 18, body: <Path d="M11 3L5 9l6 6" /> },
  // Android's back (chat handoff 1e): an arrow, where iOS has the chevron above.
  arrow: { box: 18, body: <Path d="M15 9H3M8 4L3 9l5 5" /> },
  chevron: { box: 16, body: <Path d="M5.5 2.5l6 5.5-6 5.5" /> },
  chevronDown: { box: 14, body: <Path d="M3 5.5L7 9.5l4-4" /> },
  person: {
    box: 18,
    body: [
      <Circle key="a" cx={9} cy={9} r={7.5} />,
      <Circle key="b" cx={9} cy={6.6} r={2.2} />,
      <Path key="c" d="M4.2 15c.8-2.4 2.6-3.6 4.8-3.6s4 1.2 4.8 3.6" />,
    ],
  },
  copy: { box: 16, body: [<Rect key="a" x={5.5} y={5.5} width={9} height={9} />, <Path key="b" d="M11 3.5H2v9" />] },
  check: { box: 16, body: <Path d="M2.5 8.5l3.5 3.5 7.5-8" /> },
  cycle: { box: 16, body: [<Path key="a" d="M13 8a5 5 0 11-1.5-3.6" />, <Path key="b" d="M13 2v3h-3" />] },
  // The chat handoff (1b / 1e): a folded letter for the tab, and the "new", "search", "send" (paper kite) and clock glyphs.
  letter: { box: 16, body: [<Rect key="a" x={2} y={3.5} width={12} height={9} />, <Path key="b" d="M2 4l6 4.5L14 4" />] },
  plus: { box: 18, body: <Path d="M9 3v12M3 9h12" /> },
  close: { box: 16, body: <Path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> },
  search: { box: 18, body: [<Circle key="a" cx={8} cy={8} r={5.5} />, <Path key="b" d="M12 12l4 4" />] },
  send: { box: 20, body: <Path d="M3 17L17 10 3 3v5.5L11 10l-8 1.5z" /> },
  clock: { box: 12, body: [<Circle key="a" cx={6} cy={6} r={4.6} />, <Path key="b" d="M6 3.4V6l1.8 1.3" />] },
  // 朋友圈 handoff: the tab (two souls), and the eternal light — unlit, and lit (the flame filled).
  circle: {
    box: 16,
    body: [
      <Circle key="a" cx={5.5} cy={5.5} r={2.3} />,
      <Circle key="b" cx={10.5} cy={5.5} r={2.3} />,
      <Path key="c" d="M1.5 13.5c.6-2.3 2-3.5 4-3.5s3.4 1.2 4 3.5M9.5 10.2c.3-.1.6-.2 1-.2 2 0 3.4 1.2 4 3.5" />,
    ],
  },
  lamp: { box: 16, body: [<Path key="a" d="M8 2.2c1.6 1.9 2.2 3.1 2.2 4.2a2.2 2.2 0 01-4.4 0c0-1.1.6-2.3 2.2-4.2z" />, <Path key="b" d="M4.5 10.5h7M5.5 10.5l.8 3.3h3.4l.8-3.3" />] },
  // 书信发图键(第十八批 Design):20 画布、1.5 描边、方角 —— 与搜索图标同规格;用 strokeWidth 1.5 画。
  image: {
    box: 20,
    body: [
      <Rect key="a" x={2.75} y={4.25} width={14.5} height={11.5} strokeLinejoin="miter" />,
      <Circle key="b" cx={7} cy={8.5} r={1.25} />,
      <Path key="c" d="M2.75 14l4.5-4 3 2.5 3-3 4 3.5" strokeLinejoin="miter" />,
    ],
  },
  // v4's capsule tab bar (V4Batch07 05 App): 24 grid, 1.5 stroke, round caps and joins — drawn with strokeWidth 1.5.
  tabLife: { box: 24, body: [<Path key="a" d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z" strokeLinecap="round" strokeLinejoin="round" />, <Circle key="b" cx={12} cy={10} r={2.3} />] },
  tabRebirth: { box: 24, body: [<Path key="a" d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" strokeLinecap="round" strokeLinejoin="round" />, <Path key="b" d="M19.5 4v4h-4" strokeLinecap="round" strokeLinejoin="round" />] },
  tabLetters: { box: 24, body: [<Rect key="a" x={3.5} y={5.5} width={17} height={13} rx={2} />, <Path key="b" d="m4 7 8 6 8-6" strokeLinecap="round" strokeLinejoin="round" />] },
  tabCircle: {
    box: 24,
    body: [
      <Circle key="a" cx={9} cy={8.5} r={3} />,
      <Path key="b" d="M3.5 19.5c.8-3.3 3-5 5.5-5s4.7 1.7 5.5 5" strokeLinecap="round" strokeLinejoin="round" />,
      <Circle key="c" cx={16.8} cy={9.3} r={2.3} />,
      <Path key="d" d="M16.5 14.4c2.2.1 3.6 1.6 4.1 4" strokeLinecap="round" strokeLinejoin="round" />,
    ],
  },
  more: { box: 18, body: [<Rect key="a" x={3.5} y={8.5} width={1} height={1} />, <Rect key="b" x={8.5} y={8.5} width={1} height={1} />, <Rect key="c" x={13.5} y={8.5} width={1} height={1} />] },
  // The one filled glyph: the lit flame takes the stroke colour (`currentColor`, set on the Svg).
  lampLit: {
    box: 16,
    body: [
      <Path key="a" d="M8 2.2c1.6 1.9 2.2 3.1 2.2 4.2a2.2 2.2 0 01-4.4 0c0-1.1.6-2.3 2.2-4.2z" fill="currentColor" />,
      <Path key="b" d="M4.5 10.5h7M5.5 10.5l.8 3.3h3.4l.8-3.3" />,
    ],
  },
};

export function Icon({ name, size, color, strokeWidth = 1.3 }: { name: IconName; size: number; color: string; strokeWidth?: number }) {
  const icon = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${icon.box} ${icon.box}`} fill="none" stroke={color} color={color} strokeWidth={strokeWidth}>
      {icon.body}
    </Svg>
  );
}
