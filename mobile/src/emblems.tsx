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
  | "chevron"
  | "chevronDown"
  | "person"
  | "copy"
  | "check"
  | "cycle"
  | "letter"
  | "plus"
  | "search"
  | "send"
  | "clock";

const ICONS: Record<IconName, { box: number; body: ReactNode }> = {
  ledger: { box: 16, body: [<Rect key="a" x={3} y={2.5} width={10} height={11} />, <Path key="b" d="M5.5 2.5v11M3 6.5h10" />] },
  alert: { box: 16, body: [<Path key="a" d="M8 1.5L15 14.5H1z" />, <Path key="b" d="M8 6v4M8 12h.01" />] },
  info: { box: 16, body: [<Circle key="a" cx={8} cy={8} r={6.5} />, <Path key="b" d="M8 4.5v4.5M8 11.2h.01" />] },
  lock: { box: 16, body: [<Rect key="a" x={3} y={7} width={10} height={7} />, <Path key="b" d="M5.5 7V5a2.5 2.5 0 015 0v2" />] },
  back: { box: 18, body: <Path d="M11 3L5 9l6 6" /> },
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
  search: { box: 18, body: [<Circle key="a" cx={8} cy={8} r={5.5} />, <Path key="b" d="M12 12l4 4" />] },
  send: { box: 20, body: <Path d="M3 17L17 10 3 3v5.5L11 10l-8 1.5z" /> },
  clock: { box: 12, body: [<Circle key="a" cx={6} cy={6} r={4.6} />, <Path key="b" d="M6 3.4V6l1.8 1.3" />] },
};

export function Icon({ name, size, color, strokeWidth = 1.3 }: { name: IconName; size: number; color: string; strokeWidth?: number }) {
  const icon = ICONS[name];
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${icon.box} ${icon.box}`} fill="none" stroke={color} strokeWidth={strokeWidth}>
      {icon.body}
    </Svg>
  );
}
