/**
 * 卷宗的印与功过记号(Design 第三十批 第 3 步 八.3 / 八.4)在官员端的用法。图形本身与灵魂端共用
 * (`packages/mobile-ui/src/dossierMarks.tsx`,经 shared.ts);这里只把审判的 `civilization` / `court` 换成它要的参数,
 * 并加上落印动效:全站同一下 `SEAL_MOTION`(@soulledger/core/config/motion,第五十三批 G1)—— 200 ms,从 1.18 倍落到 1 倍,
 * 透明度 0 → 1,只播一次,没有光晕;减少动效时不缩放,120 ms 淡入。
 */
import { SEAL_MOTION } from "@soulledger/core/config/motion";
import { courtSlug } from "@soulledger/core/domain/courts";
import { useEffect, useState } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";

import { MeritMark, SealArt, civKeyOf, useReducedMotion, useTheme } from "./shared";

/** The seal's easing as React Native takes it (one place; the hold-to-seal drawer lands with it too). */
export const sealEasing = Easing.bezier(...SEAL_MOTION.easing);

/** 十殿的殿号(1–10);别的殿(城隍、枉死城 …)没有号,方印按第一殿画。 */
export function courtNumber(court: string | null | undefined): number {
  const n = Number(courtSlug(court)?.match(/^court_(\d+)$/)?.[1]);
  return n >= 1 && n <= 10 ? n : 1;
}

export const civOf = (civilization: string | null | undefined) => {
  const civ = civKeyOf(civilization);
  return civ === "neutral" ? null : civ;
};

export function DossierSeal({
  civilization,
  court,
  civLevel,
  size = 96,
  pending,
  stamp,
  label,
  testID,
  style,
}: {
  civilization: string | null | undefined;
  court?: string | null;
  /** The civilization's own seal, no hall on it (地府: 「地府之印」; the others carry no hall anyway). 第五十二批 E2. */
  civLevel?: boolean;
  size?: number;
  pending?: boolean;
  /** Plays the drop once when it mounts. */
  stamp?: boolean;
  label: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { scheme } = useTheme();
  const reduced = useReducedMotion();
  const [drop] = useState(() => new Animated.Value(stamp ? 0 : 1));
  useEffect(() => {
    if (!stamp) return;
    const duration = reduced ? SEAL_MOTION.reduced.durationMs : SEAL_MOTION.durationMs;
    Animated.timing(drop, { toValue: 1, duration, easing: sealEasing, useNativeDriver: true }).start();
  }, [stamp, reduced, drop]);
  const civ = civOf(civilization);
  if (!civ) return null;
  const from = reduced ? SEAL_MOTION.reduced.scaleFrom : SEAL_MOTION.scaleFrom;
  const scale = drop.interpolate({ inputRange: [0, 1], outputRange: [from, SEAL_MOTION.scaleTo] });
  return (
    <Animated.View style={[{ width: size, height: size, opacity: drop, transform: [{ scale }] }, style]}>
      <SealArt testID={testID} civ={civ} scheme={scheme} size={size} pending={pending} court={civLevel ? 0 : courtNumber(court)} label={label} />
    </Animated.View>
  );
}

/** 功过记号,16px、墨色;认不出文明的不画(调用方写字)。`label` 给读屏(功 / 过、德 / 罪 …)。 */
export function DeedMark({ civilization, demerit, label, testID }: { civilization: string | null | undefined; demerit: boolean; label: string; testID?: string }) {
  const theme = useTheme();
  const civ = civOf(civilization);
  if (!civ) return null;
  return (
    <View testID={testID} accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: 16, height: 16 }}>
      <MeritMark civ={civ} demerit={demerit} ink={theme.ink} ground={theme.s0} />
    </View>
  );
}
