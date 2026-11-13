/**
 * 卷宗 marks (Design batch 30, step 3 section 4 and 3): the per-civilization merit / demerit mark and the
 * civilization seal, drawn with react-native-svg from the handoff's own SVG. Shared: the officer app imports
 * this file the way it imports the other `mobile/src` modules.
 *
 * A mark answers only "merit or demerit?" and says it by SHAPE (outline vs filled, plus each civilization's
 * own form); it is in ink. Colour belongs to the signed number beside it, never to the mark.
 */
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";

import { family, quoteFamily } from "./fonts";
import { useI18n } from "./i18n";
import type { CivKey } from "./theme";

/** 16 grid. 地府 draws the character itself (功 outlined, 过 filled); the others their own form. */
export function MeritMark({
  civ,
  demerit,
  ink,
  ground,
  size = 16,
  testID,
}: {
  civ: CivKey;
  demerit: boolean;
  /** Mark colour: ink. */
  ink: string;
  /** What shows through a filled shape's cut-out (the page ground). */
  ground: string;
  size?: number;
  testID?: string;
}) {
  const { t, locale } = useI18n();
  const hidden = { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
  const stroke = { fill: "none", stroke: ink } as const;
  let body;
  if (civ === "eu") {
    body = demerit ? (
      <>
        <Circle cx={8} cy={8} r={7} fill={ink} />
        <SvgText x={8} y={12} textAnchor="middle" fontSize={11} fontWeight="700" fill={ground} fontFamily={quoteFamily("P")}>
          P
        </SvgText>
      </>
    ) : (
      <Path d="M8 1.5l1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" {...stroke} strokeWidth={1.3} strokeLinejoin="round" />
    );
  } else if (civ === "eg") {
    body = demerit ? (
      <Path d="M5 2.5h6M6 2.5v2C3 6 2.5 10 4.5 12.5 6 14.5 10 14.5 11.5 12.5 13.5 10 13 6 10 4.5v-2" fill={ink} stroke={ink} strokeWidth={1.2} strokeLinejoin="round" />
    ) : (
      <>
        <Path d="M9 1C5 4 4.5 9 6 15c4-4 5.5-9 3-14z" {...stroke} strokeWidth={1.3} strokeLinejoin="round" />
        <Path d="M8.2 3.5L6.3 14" stroke={ink} strokeWidth={0.9} />
      </>
    );
  } else if (civ === "gr") {
    body = demerit ? (
      <>
        <Circle cx={8} cy={8} r={7} fill={ink} />
        <Circle cx={8} cy={8} r={2.4} fill={ground} />
      </>
    ) : (
      <>
        <Circle cx={8} cy={8} r={6.3} {...stroke} strokeWidth={1.4} />
        <Circle cx={8} cy={8} r={2.4} fill={ink} />
      </>
    );
  } else {
    // 地府 (and the neutral skin, which has no mark of its own): the 功过格's two columns, the character is the mark.
    // English and egy put + / − in the same box (Design batch 36 §1.1): to a reader without Han, 功 and 过 are two blots.
    const ch = t(`caseDesk.dossier.mark.cn.${demerit ? "demerit" : "merit"}_glyph`);
    body = (
      <>
        {demerit ? <Rect x={0.5} y={0.5} width={15} height={15} rx={2} fill={ink} /> : <Rect x={1.1} y={1.1} width={13.8} height={13.8} rx={2} {...stroke} strokeWidth={1.2} />}
        <SvgText x={8} y={12} textAnchor="middle" fontSize={11} fontWeight="600" fill={demerit ? ground : ink} fontFamily={locale === "zh-Hans" ? quoteFamily(ch) : family.ui[600]}>
          {ch}
        </SvgText>
      </>
    );
  }
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 16 16" {...hidden}>
      {body}
    </Svg>
  );
}

// ── seals ───────────────────────────────────────────────────────────────

const WAX =
  "M89.2 48.0L90.6 53.6L88.2 58.8L84.8 63.2L82.1 67.7L78.7 71.6L74.8 74.8L71.7 78.9L69.1 84.5L64.8 88.4L58.6 87.7L52.8 84.8L48.0 84.6L42.8 87.1L37.2 88.3L32.1 86.4L27.5 83.5L23.2 80.4L20.0 76.0L18.4 70.7L15.7 66.7L10.4 63.6L5.6 59.3L5.7 53.6L9.2 48.0L11.3 43.2L10.9 38.1L10.9 32.6L12.8 27.7L15.3 22.9L18.2 18.2L23.0 15.4L29.1 15.3L34.1 14.5L37.9 10.4L42.4 5.5L48.0 4.6L53.3 7.8L57.9 11.0L62.7 12.5L67.5 14.2L71.9 16.9L76.6 19.4L81.9 22.0L85.0 26.7L84.3 33.0L82.9 38.6L85.0 43.1Z";
/** 方印 reads right to left: 第N殿印, N one Han numeral. */
const NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

/** The seal's fill per scheme: 地府 vermilion (only the seal wears it), 欧洲 civT, 埃及 / 希腊 their metal. */
const SEAL_FILL = {
  cn: { dark: "#E35D3F", light: "#B8321C" },
  eu: { dark: "#A883AE", light: "#885A94" },
  eg: { dark: "#D6B25E", light: "#86671E" },
  gr: { dark: "#C98B62", light: "#8F5B36" },
} as const;
const CUT = { dark: "#111113", light: "#F8F8F6" } as const;
const ROTATE = { cn: -3, eu: 4, eg: 0, gr: -6 } as const;

/**
 * 实印, or with `pending` the dashed preview before it is set (22% and a dashed frame); viewBox 96, drawn at
 * `size` (灵魂端 72, 列表 40). `court` is the 1–10 of 地府's 「第N殿印」. A seal is an object: its characters are
 * never translated; `label` is the language pack's spoken name for it.
 */
export function DossierSeal({
  civ,
  scheme,
  size = 72,
  pending = false,
  court = 1,
  label,
  testID,
}: {
  civ: CivKey;
  scheme: "dark" | "light";
  size?: number;
  pending?: boolean;
  court?: number;
  label?: string;
  testID?: string;
}) {
  if (civ === "neutral") return null;
  const fill = SEAL_FILL[civ][scheme];
  const cut = CUT[scheme];
  const n = NUM[Math.min(Math.max(court, 1), 10) - 1];
  const serif = quoteFamily("印");
  const latin = quoteFamily("M");
  const a11y = label
    ? { accessible: true, accessibilityRole: "image" as const, accessibilityLabel: label }
    : { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const };
  const han = (x: number, y: number, c: string) => (
    <SvgText key={`${x}${y}`} x={x} y={y} textAnchor="middle" fontSize={26} fontWeight="700" fill={cut} fontFamily={serif}>
      {c}
    </SvgText>
  );
  let body;
  if (civ === "cn") {
    body = (
      <>
        <Rect x={10} y={10} width={76} height={76} rx={5} fill={fill} />
        <Rect x={16} y={16} width={64} height={64} rx={2} fill="none" stroke={cut} strokeWidth={1.6} strokeOpacity={0.9} />
        {han(64, 46, "第")}
        {han(64, 76, n)}
        {han(34, 46, "殿")}
        {han(34, 76, "印")}
        <G fill={fill}>
          <Circle cx={24} cy={57} r={1.4} />
          <Circle cx={71} cy={24} r={1.1} />
          <Circle cx={48} cy={71} r={1} />
        </G>
      </>
    );
  } else if (civ === "eu") {
    body = (
      <>
        <Path d={WAX} fill={fill} />
        <Circle cx={48} cy={48} r={27} fill="none" stroke={cut} strokeOpacity={0.55} strokeWidth={2} />
        <Circle cx={48} cy={48} r={23} fill="none" stroke={cut} strokeOpacity={0.3} strokeWidth={1} />
        <SvgText x={48} y={58} textAnchor="middle" fontSize={30} fontWeight="700" fill={cut} fillOpacity={0.8} fontFamily={latin}>
          M
        </SvgText>
        <Path d="M48 26l1.6 3.4 3.4 1.6-3.4 1.6L48 36l-1.6-3.4-3.4-1.6 3.4-1.6z" fill={cut} fillOpacity={0.7} />
        <Path d="M30 80q-2 8 2 12M64 82q3 6 0 10" stroke={fill} strokeWidth={5} strokeLinecap="round" fill="none" />
      </>
    );
  } else if (civ === "eg") {
    body = (
      <>
        <Rect x={24} y={6} width={48} height={76} rx={24} fill={fill} fillOpacity={0.1} stroke={fill} strokeWidth={4} />
        <Rect x={24} y={6} width={48} height={76} rx={24} fill="none" stroke={cut} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.7} />
        <Path d="M22 88H74" stroke={fill} strokeWidth={4} strokeLinecap="round" />
        <Path d="M40 82v6M56 82v6" stroke={fill} strokeWidth={3} />
        <Circle cx={48} cy={22} r={7} fill={fill} />
        <Path d="M48 34c-7 10-6 22 0 34 6-12 7-24 0-34z" fill="none" stroke={fill} strokeWidth={2} />
        <Path d="M48 36V70" stroke={fill} strokeWidth={1.2} />
      </>
    );
  } else {
    const greek = (y: number, c: string) => (
      <SvgText key={c} x={48} y={y} textAnchor="middle" fontSize={20} fontWeight="600" letterSpacing={2} fill={cut} fillOpacity={0.85} fontFamily={latin}>
        {c}
      </SvgText>
    );
    body = (
      <>
        <Path d="M14 30L30 10 62 8 84 22 88 52 72 82 40 88 16 72 8 48Z" fill={fill} />
        <Path d="M30 10L36 16M84 22l-6 4M16 72l6-4" stroke={cut} strokeOpacity={0.35} strokeWidth={1.2} />
        {greek(44, "ΚΡΙ")}
        {greek(68, "ΣΙΣ")}
      </>
    );
  }
  return (
    <Svg testID={testID} width={size} height={size} viewBox="0 0 96 96" {...a11y}>
      <G rotation={ROTATE[civ]} origin="48, 48" opacity={pending ? 0.22 : 0.94}>
        {body}
      </G>
      {pending ? <Rect x={4} y={4} width={88} height={88} rx={8} fill="none" stroke={scheme === "dark" ? "#8E9197" : "#686B70"} strokeDasharray="4 4" /> : null}
    </Svg>
  );
}
