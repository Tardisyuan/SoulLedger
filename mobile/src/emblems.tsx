/**
 * The four civilization emblems, the neutral mark, and the handful of line
 * icons the screens use — all transcribed from the design handoff's SVG
 * (viewBox 48 for emblems, 16/18 for icons). One `stroke`: a caller passes the
 * mark colour and nothing else about colour.
 *
 * Each emblem has two drawings: `full` (login mark, watermark) and `compact`
 * (inline 15px, tab 24px, divider), where the handoff drops strokes that would
 * turn to mud at small sizes.
 */
import type { ReactNode } from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import type { CivKey } from "./theme";

type Drawing = { rect?: boolean; paths: string[] };

const BRUSH = "M37.5 5.5l4.5 4.5-15.5 15.5-5.5 1.5 1.5-5.5z";

/** The ledger with a judge's brush — the app's own mark, and 中国地府's. */
const LEDGER: Record<"full" | "compact", Drawing> = {
  full: { rect: true, paths: ["M14 12v30M8 20.5h26M8 29h26", BRUSH] },
  compact: { rect: true, paths: ["M14 12v30M8 20.5h26", BRUSH] },
};

export const EMBLEMS: Record<CivKey, Record<"full" | "compact", Drawing>> = {
  neutral: LEDGER,
  cn: LEDGER,
  eu: {
    full: {
      paths: [
        "M6 42a18 18 0 0136 0M9 42a15 15 0 0130 0M12 42a12 12 0 0124 0M15 42a9 9 0 0118 0M18 42a6 6 0 0112 0M21 42a3 3 0 016 0",
        "M24 4v38",
      ],
    },
    compact: { paths: ["M8 42a16 16 0 0132 0M15 42a9 9 0 0118 0M21 42a3 3 0 016 0"] },
  },
  eg: {
    full: { paths: ["M24 6v30M12 42h24M14 14h20", "M10 14a4 4 0 008 0M30 14a4 4 0 008 0", "M31 8c3-4 7-3 7-3s-.5 5-4 7"] },
    compact: { paths: ["M24 8v28M12 40h24M14 16h20", "M11 16a3.5 3.5 0 007 0M27 16a3.5 3.5 0 007 0"] },
  },
  gr: {
    full: { paths: ["M24 44V26M24 26L9 6M24 26l15-20", "M3 36c6 3 12-3 18 0s12 3 18 0M3 41c6 3 12-3 18 0s12 3 18 0"] },
    compact: { paths: ["M24 42V24M24 24L11 8M24 24l13-16", "M6 38c6 3 12-3 18 0s12 3 18 0"] },
  },
};

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
  variant?: "full" | "compact";
  strokeWidth?: number;
  testID?: string;
}) {
  const drawing = EMBLEMS[civ][variant];
  // The handoff's weights: ~0.75 at watermark size, 1 at 66px, 1.6–2 inline.
  const width = strokeWidth ?? (size >= 120 ? 0.75 : size >= 40 ? 1 : 1.8);
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={stroke} strokeWidth={width}>
      {drawing.rect ? <Rect x={8} y={12} width={26} height={30} /> : null}
      {drawing.paths.map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

// ── civilization flavour (handoff "灵魂簿 App · 文明气质", 1c–1h) ─────────────
// Copied path for path from the handoff's data block. Line art only, one stroke
// (the civilization's mark); the neutral theme uses only circles and rules.

/**
 * The title bar's band (1c): one 12×6 unit, baseline at y 5.5 (the Greek key adds
 * a top line at 0.5), the motif inside x ∈ [1, 11] so units meet without seams.
 * `d` is the full unit; `dc` is what a unit keeps when compact drops its motif.
 */
export const BAND: Record<CivKey, { d: string; dc: string }> = {
  neutral: { d: "M0 5.5H12", dc: "M0 5.5H12" },
  cn: { d: "M0 5.5H12M2 5.5V1H9V4H5V2.5H7", dc: "M0 5.5H12" },
  eu: { d: "M0 5.5H12M1 5.5V3.5A2.5 2.5 0 0 1 6 3.5V5.5M6 3.5A2.5 2.5 0 0 1 11 3.5V5.5", dc: "M0 5.5H12" },
  eg: { d: "M0 5.5H12M6 5.5C6 3.5 4 2.5 3 1C5 1.5 6 2.5 6 3.5C6 2.5 7 1.5 9 1C8 2.5 6 3.5 6 5.5", dc: "M0 5.5H12" },
  gr: { d: "M0 0.5H12M0 5.5H12M2 5.5V2H8V4H5", dc: "M0 0.5H12M0 5.5H12" },
};

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
  | "more";

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
