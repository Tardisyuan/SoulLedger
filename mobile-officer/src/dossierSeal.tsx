/**
 * 卷宗的印与功过记号(Design 第三十批 第 3 步 八.3 / 八.4)在官员端的用法。图形本身与灵魂端共用
 * (`mobile/src/dossierMarks.tsx`,经 shared.ts);这里只把审判的 `civilization` / `court` 换成它要的参数,
 * 并加上落印动效 `--stamp`:240 ms,从 1.18 倍落到 1 倍,透明度 0 → 1,只播一次;减少动效时直接出现。
 */
import { courtSlug } from "@soulledger/core/domain/courts";
import { useEffect, useState } from "react";
import { Animated, Easing, View, type StyleProp, type ViewStyle } from "react-native";

import { MeritMark, SealArt, civKeyOf, useReducedMotion, useTheme } from "./shared";

export const STAMP_MS = 240;

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
    if (reduced) drop.setValue(1);
    else Animated.timing(drop, { toValue: 1, duration: STAMP_MS, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: true }).start();
  }, [stamp, reduced, drop]);
  const civ = civOf(civilization);
  if (!civ) return null;
  const scale = drop.interpolate({ inputRange: [0, 1], outputRange: [1.18, 1] });
  return (
    <Animated.View style={[{ width: size, height: size, opacity: drop, transform: [{ scale }] }, style]}>
      <SealArt testID={testID} civ={civ} scheme={scheme} size={size} pending={pending} court={courtNumber(court)} label={label} />
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
