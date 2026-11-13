/**
 * 卷宗的印与功过记号(Design 第三十批 第 3 步 八.3 / 八.4),照 `seals/seal-{civ}-{theme}[-pending].svg` 与样张里的
 * `.mk` 记号画,react-native-svg(两个 App 都已装)。
 *
 * 印:地府方印(白文「第 N 殿印」,从右往左读,转 −3°)、欧洲圆形蜡封(M + 星,转 +4°)、埃及王名圈(日盘与羽,不转)、
 * 希腊陶片(ΚΡΙ / ΣΙΣ,转 −6°)。颜色:地府朱只给印(深 #E35D3F / 浅 #B8321C,与 `neg` 分开);欧洲 civT;埃及、希腊各自的
 * metal。`pending`:落印前的虚线预览(22% + 虚线框)。尺寸 96 / 72 / 40(卷宗页 / 灵魂端 / 列表)。
 * 印是物件不是文案:印文不翻译;读屏读的是调用方给的 `label`。
 *
 * 灵魂端(`mobile/src/seal.tsx`)是 v3 的描线印,归灵魂端那边改;这里只给官员端用。
 */
import { courtSlug } from "@soulledger/core/domain/courts";
import { useEffect, useRef } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, G, Path, Rect, Text as SvgText } from "react-native-svg";

import { family, themeFor, useReducedMotion, useTheme } from "./shared";

type Civ = "cn" | "eu" | "eg" | "gr";
const CIV: Record<string, Civ> = { CHINESE: "cn", EUROPEAN: "eu", EGYPTIAN: "eg", GREEK: "gr" };
export const civOf = (civilization: string | null | undefined): Civ | null => (civilization ? CIV[civilization] ?? null : null);

const CN_SEAL = { dark: "#E35D3F", light: "#B8321C" } as const;
const HAN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** `--stamp`: 240 ms, cubic-bezier(.2,.8,.2,1), from 1.18 to 1, opacity 0 → 1, once. */
export const STAMP_MS = 240;

/** 地府方印的四个字,从右往左读:右列「第 N」,左列「殿印」。认不出殿号的(非十殿)写「冥府之印」。 */
export function cnSealChars(court: string | null | undefined): [string, string, string, string] {
  const n = Number(courtSlug(court)?.match(/^court_(\d+)$/)?.[1]);
  return n >= 1 && n <= 10 ? ["第", HAN[n], "殿", "印"] : ["冥", "府", "之", "印"];
}

/**
 * The civilization's seal at `size` (96 / 72 / 40). Unknown civilization: nothing. `stamp`: plays the 240 ms drop once
 * when it mounts (none under reduce-motion).
 */
export function DossierSeal({
  civilization,
  court,
  size = 96,
  pending,
  stamp,
  label,
  testID,
  style,
}: {
  civilization: string | null | undefined;
  court?: string | null;
  size?: number;
  pending?: boolean;
  stamp?: boolean;
  label: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useTheme();
  const reduced = useReducedMotion();
  const drop = useRef(new Animated.Value(stamp ? 0 : 1)).current;
  useEffect(() => {
    if (!stamp) return;
    if (reduced) drop.setValue(1);
    else Animated.timing(drop, { toValue: 1, duration: STAMP_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [stamp, reduced, drop]);
  const civ = civOf(civilization);
  if (!civ) return null;
  const theme = themeFor(civilization, scheme);
  const ink = theme.s0; // the seal's cut lines are the page colour (#111113 dark / #F8F8F6 light)
  const colour = civ === "cn" ? CN_SEAL[scheme] : civ === "eu" ? theme.plaque : theme.metal;
  const scale = drop.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1] });
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[{ width: size, height: size, opacity: drop, transform: [{ scale }] }, style]}
    >
      <Svg width={size} height={size} viewBox="0 0 96 96">
        <G opacity={pending ? 0.22 : 0.94}>{body(civ, colour, ink, court)}</G>
        {pending ? <Rect x={4} y={4} width={88} height={88} rx={8} fill="none" stroke={theme.faint} strokeDasharray="4 4" /> : null}
      </Svg>
    </Animated.View>
  );
}

function body(civ: Civ, c: string, ink: string, court: string | null | undefined) {
  if (civ === "cn") {
    const [a, b, d, e] = cnSealChars(court);
    const ch = (x: number, y: number, s: string) => (
      <SvgText x={x} y={y} textAnchor="middle" fontSize={26} fontWeight="700" fill={ink} fontFamily={family.title}>
        {s}
      </SvgText>
    );
    return (
      <G transform="rotate(-3 48 48)">
        <Rect x={10} y={10} width={76} height={76} rx={5} fill={c} />
        <Rect x={16} y={16} width={64} height={64} rx={2} fill="none" stroke={ink} strokeWidth={1.6} strokeOpacity={0.9} />
        {ch(64, 46, a)}
        {ch(64, 76, b)}
        {ch(34, 46, d)}
        {ch(34, 76, e)}
        <Circle cx={24} cy={57} r={1.4} fill={c} />
        <Circle cx={71} cy={24} r={1.1} fill={c} />
        <Circle cx={48} cy={71} r={1} fill={c} />
      </G>
    );
  }
  if (civ === "eu") {
    return (
      <G transform="rotate(4 48 48)">
        <Path
          d="M89.2 48.0L90.6 53.6L88.2 58.8L84.8 63.2L82.1 67.7L78.7 71.6L74.8 74.8L71.7 78.9L69.1 84.5L64.8 88.4L58.6 87.7L52.8 84.8L48.0 84.6L42.8 87.1L37.2 88.3L32.1 86.4L27.5 83.5L23.2 80.4L20.0 76.0L18.4 70.7L15.7 66.7L10.4 63.6L5.6 59.3L5.7 53.6L9.2 48.0L11.3 43.2L10.9 38.1L10.9 32.6L12.8 27.7L15.3 22.9L18.2 18.2L23.0 15.4L29.1 15.3L34.1 14.5L37.9 10.4L42.4 5.5L48.0 4.6L53.3 7.8L57.9 11.0L62.7 12.5L67.5 14.2L71.9 16.9L76.6 19.4L81.9 22.0L85.0 26.7L84.3 33.0L82.9 38.6L85.0 43.1Z"
          fill={c}
        />
        <Circle cx={48} cy={48} r={27} fill="none" stroke={ink} strokeOpacity={0.55} strokeWidth={2} />
        <Circle cx={48} cy={48} r={23} fill="none" stroke={ink} strokeOpacity={0.3} strokeWidth={1} />
        <SvgText x={48} y={58} textAnchor="middle" fontSize={30} fontWeight="700" fill={ink} fillOpacity={0.8} fontFamily={family.title}>
          M
        </SvgText>
        <Path d="M48 26l1.6 3.4 3.4 1.6-3.4 1.6L48 36l-1.6-3.4-3.4-1.6 3.4-1.6z" fill={ink} fillOpacity={0.7} />
        <Path d="M30 80q-2 8 2 12M64 82q3 6 0 10" stroke={c} strokeWidth={5} strokeLinecap="round" fill="none" />
      </G>
    );
  }
  if (civ === "eg") {
    return (
      <G>
        <Rect x={24} y={6} width={48} height={76} rx={24} fill={c} fillOpacity={0.1} stroke={c} strokeWidth={4} />
        <Rect x={24} y={6} width={48} height={76} rx={24} fill="none" stroke={ink} strokeWidth={1} strokeDasharray="2 3" strokeOpacity={0.7} />
        <Path d="M22 88H74" stroke={c} strokeWidth={4} strokeLinecap="round" />
        <Path d="M40 82v6M56 82v6" stroke={c} strokeWidth={3} />
        <Circle cx={48} cy={22} r={7} fill={c} />
        <Path d="M48 34c-7 10-6 22 0 34 6-12 7-24 0-34z" fill="none" stroke={c} strokeWidth={2} />
        <Path d="M48 36V70" stroke={c} strokeWidth={1.2} />
      </G>
    );
  }
  const greek = (y: number, s: string) => (
    <SvgText x={48} y={y} textAnchor="middle" fontSize={20} fontWeight="600" letterSpacing={2} fill={ink} fillOpacity={0.85} fontFamily={family.title}>
      {s}
    </SvgText>
  );
  return (
    <G transform="rotate(-6 48 48)">
      <Path d="M14 30L30 10 62 8 84 22 88 52 72 82 40 88 16 72 8 48Z" fill={c} />
      <Path d="M30 10L36 16M84 22l-6 4M16 72l6-4" stroke={ink} strokeOpacity={0.35} strokeWidth={1.2} />
      {greek(44, "ΚΡΙ")}
      {greek(68, "ΣΙΣ")}
    </G>
  );
}

/**
 * 功过记号(八.4):16px、墨色,只答「是功还是过」,靠形状分 —— 地府「功」描框 /「过」实底;欧洲四角星(德)/ 圆底 P(罪);
 * 埃及羽(描线)/ 心形罐(实底);希腊白票(描线圆 + 实心中点)/ 黑票(实底圆中间一个孔)。颜色只上数字(调用方)。
 * 认不出文明的不画(调用方写字)。`label` 给读屏(功 / 过、德 / 罪 …,语言包里的那两个字)。
 */
export function DeedMark({ civilization, demerit, label, testID }: { civilization: string | null | undefined; demerit: boolean; label: string; testID?: string }) {
  const theme = useTheme();
  const civ = civOf(civilization);
  if (!civ) return null;
  const ink = theme.ink;
  const ground = theme.s0;
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: 16, height: 16 }}>
      <Svg width={16} height={16} viewBox="0 0 16 16">
        {civ === "cn" ? (
          <>
            <Rect x={0.6} y={0.6} width={14.8} height={14.8} rx={2} fill={demerit ? ink : "none"} stroke={demerit ? "none" : ink} strokeWidth={1.2} />
            <SvgText x={8} y={12} textAnchor="middle" fontSize={11} fontWeight="600" fill={demerit ? ground : ink} fontFamily={family.title}>
              {demerit ? "过" : "功"}
            </SvgText>
          </>
        ) : civ === "eu" ? (
          demerit ? (
            <>
              <Circle cx={8} cy={8} r={7} fill={ink} />
              <SvgText x={8} y={12} textAnchor="middle" fontSize={11} fontWeight="700" fill={ground} fontFamily={family.title}>
                P
              </SvgText>
            </>
          ) : (
            <Path d="M8 1.5l1.7 4.8L14.5 8l-4.8 1.7L8 14.5l-1.7-4.8L1.5 8l4.8-1.7z" fill="none" stroke={ink} strokeWidth={1.3} strokeLinejoin="round" />
          )
        ) : civ === "eg" ? (
          demerit ? (
            <Path d="M5 2.5h6M6 2.5v2C3 6 2.5 10 4.5 12.5 6 14.5 10 14.5 11.5 12.5 13.5 10 13 6 10 4.5v-2" fill={ink} stroke={ink} strokeWidth={1.2} strokeLinejoin="round" />
          ) : (
            <>
              <Path d="M9 1C5 4 4.5 9 6 15c4-4 5.5-9 3-14z" fill="none" stroke={ink} strokeWidth={1.3} strokeLinejoin="round" />
              <Path d="M8.2 3.5L6.3 14" stroke={ink} strokeWidth={0.9} />
            </>
          )
        ) : demerit ? (
          <>
            <Circle cx={8} cy={8} r={7} fill={ink} />
            <Circle cx={8} cy={8} r={2.4} fill={ground} />
          </>
        ) : (
          <>
            <Circle cx={8} cy={8} r={6.3} fill="none" stroke={ink} strokeWidth={1.4} />
            <Circle cx={8} cy={8} r={2.4} fill={ink} />
          </>
        )}
      </Svg>
    </View>
  );
}
