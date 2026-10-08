/**
 * The cold start: the soul app's animation (mobile/src/coldStart.tsx) in the officer's colours --
 * INK strokes on a PAPER ground, where the soul app writes gold on its dark brand ground. The mark
 * is the same nine strokes (`STROKES`, shared), drawn all at once over `coldStartDraw`, held for
 * `coldStartHold`, then receding (lift 8, scale 0.96, fade) before the ground fades.
 *
 * It is a copy, not an import, on purpose: the soul app's version reads the soul session and the
 * civilization welcome (`welcomeFrom`), which would pull the soul's accounts into this bundle.
 * The timings come from the same `motion` table; if the soul app's animation changes, change this.
 *
 * Once per process. Not under the OS "reduce motion" setting: the splash hides and the app is there.
 * A tap skips to the end.
 */
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet } from "react-native";
import Animated, { Easing, type SharedValue, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path } from "react-native-svg";

import { OFFICER_BRAND } from "./brand";
import { MARK_HEIGHT, MARK_WIDTH, SHAPE, STROKES, VIEWBOX, motion, pathLength } from "./shared";

// The native splash goes the instant hideAsync is called; the recede below is the only motion.
SplashScreen.setOptions({ duration: 0, fade: false });

/** Module-level: a remount in the same process is not a cold start. */
export const coldStart = { played: false };

/** How long the splash may wait on a booting session before it plays. */
const SESSION_WAIT_MS = 1000;

const BOX = 112;
const LENGTHS = STROKES.map(([d]) => pathLength(d));
const AnimatedPath = Animated.createAnimatedComponent(Path);
const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);
const EASE_WRITE = Easing.bezier(0.4, 0, 0.2, 1);

type Phase = "wait" | "play" | "done";

export function ColdStart({ booting }: { booting: boolean }) {
  const [phase, setPhase] = useState<Phase>(coldStart.played ? "done" : "wait");
  const [waited, setWaited] = useState(false);
  const [interactive, setInteractive] = useState(false);

  useEffect(() => {
    if (phase !== "wait") return;
    if (booting && !waited) {
      const id = setTimeout(() => setWaited(true), SESSION_WAIT_MS);
      return () => clearTimeout(id);
    }
    coldStart.played = true;
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (!alive) return;
        if (reduced) {
          void SplashScreen.hideAsync().catch(() => {});
          setPhase("done");
        } else setPhase("play");
      });
    return () => {
      alive = false;
    };
  }, [phase, booting, waited]);

  const drawn = useSharedValue(0);
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  const shown = useSharedValue(1);
  const cover = useSharedValue(1);
  const markStyle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: lift.get() }, { scale: scale.get() }] }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.get() }));

  useEffect(() => {
    if (phase !== "play") return;
    const written = motion.coldStartDraw + motion.coldStartHold;
    const recede = { duration: motion.coldStartInteractive, easing: EASE_EXIT };
    drawn.set(withTiming(1, { duration: motion.coldStartDraw, easing: EASE_WRITE }));
    lift.set(withDelay(written, withTiming(-8, recede)));
    scale.set(withDelay(written, withTiming(0.96, recede)));
    shown.set(withDelay(written, withTiming(0, recede)));
    cover.set(withDelay(written + motion.coldStartInteractive, withTiming(0, { duration: motion.coldStart - motion.coldStartInteractive, easing: EASE_ENTER })));
  }, [phase, drawn, lift, scale, shown, cover]);

  useEffect(() => {
    if (phase !== "play") return;
    const written = motion.coldStartDraw + motion.coldStartHold;
    const usable = setTimeout(() => setInteractive(true), written + motion.coldStartInteractive);
    const gone = setTimeout(() => setPhase("done"), written + motion.coldStart);
    return () => {
      clearTimeout(usable);
      clearTimeout(gone);
    };
  }, [phase]);

  if (phase !== "play") return null;
  return (
    <Animated.View
      testID="cold-start"
      pointerEvents={interactive ? "none" : "auto"}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, coverStyle]}
    >
      <Pressable
        testID="cold-start-skip"
        onPress={() => setPhase("done")}
        onLayout={() => void SplashScreen.hideAsync().catch(() => {})}
        style={[StyleSheet.absoluteFill, styles.centre, { backgroundColor: OFFICER_BRAND.ground }]}
      >
        <Animated.View testID="cold-start-mark-layer" style={markStyle}>
          <Svg testID="cold-start-mark" width={BOX} height={(BOX * MARK_HEIGHT) / MARK_WIDTH} viewBox={VIEWBOX}>
            <Defs>
              <ClipPath id="cold-start-shape">
                {SHAPE.map((d) => (
                  <Path key={d} d={d} clipRule="evenodd" />
                ))}
              </ClipPath>
            </Defs>
            <G clipPath="url(#cold-start-shape)">
              {STROKES.map(([d, width], i) => (
                <Stroke key={d} d={d} width={width} length={LENGTHS[i]} drawn={drawn} />
              ))}
            </G>
          </Svg>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function Stroke({ d, width, length, drawn }: { d: string; width: number; length: number; drawn: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.get()) }));
  return (
    <AnimatedPath
      testID="cold-start-stroke"
      d={d}
      fill="none"
      stroke={OFFICER_BRAND.mark}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeDasharray={[length, length]}
      animatedProps={props}
    />
  );
}

const styles = StyleSheet.create({ centre: { alignItems: "center", justifyContent: "center" } });
