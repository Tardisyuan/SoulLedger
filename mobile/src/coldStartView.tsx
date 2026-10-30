/**
 * The cold start's animation, shared by both apps (cq-apps 2026-10-30 #5;補足 C18). The native
 * splash is the ground alone. When JS is ready this draws the same ground, hides the native one
 * under it, and writes the S-and-L mark: nine strokes, all at once, over `coldStartDraw`
 * (src/brandMark.ts). The mark holds for `coldStartHold`, then recedes: it lifts 8pt, shrinks to
 * 0.96 and fades over 480. From there the app underneath takes touches and the ground fades out
 * over the last 240. A tap before then skips straight to the end.
 *
 * WHEN: once per process — a cold start (`coldStart.played`, module-level: a remount is not one).
 * It waits while `booting`, but not for longer than `SESSION_WAIT_MS`. It does NOT play under the
 * OS "reduce motion" setting, or when the caller says `skip` (the soul app: its civilization's
 * welcome is about to play — the two do not stack). Then the splash just hides.
 *
 * A leaf on purpose: the colours and the reason to skip come in as props, so the officer app can
 * import this without the soul's session or welcome (`mobile-officer/src/__tests__/sharedClosure`).
 * Each app's `coldStart.tsx` is the thin shell that supplies them.
 */
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, Path } from "react-native-svg";

import { MARK_HEIGHT, MARK_WIDTH, SHAPE, STROKES, VIEWBOX, pathLength } from "./brandMark";
import { motion } from "./theme";

// The native splash goes the instant hideAsync is called. Its default exit is a 400ms fade,
// and under it this mark is already lifting: two marks, offset, fading together — seen on
// the emulator at 420 and 560dpi. The recede below is the only motion. Both keys: Android
// (expo-splash-screen 57, SplashScreenManager.kt) ignores `fade` and always animates alpha
// over `duration`; `fade` is what iOS reads.
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

export function ColdStartView({ booting, skip = false, ground, mark }: { booting: boolean; skip?: boolean; ground: string; mark: string }) {
  const [phase, setPhase] = useState<Phase>(coldStart.played ? "done" : "wait");
  const [waited, setWaited] = useState(false);
  const [interactive, setInteractive] = useState(false);

  // Decide once the session has settled (or the wait ran out).
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
        if (reduced || skip) {
          void SplashScreen.hideAsync().catch(() => {});
          setPhase("done");
        } else setPhase("play");
      });
    return () => {
      alive = false;
    };
  }, [phase, booting, skip, waited]);

  // Frame 0 is the native splash: the ground, no mark yet.
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
    cover.set(
      withDelay(written + motion.coldStartInteractive, withTiming(0, { duration: motion.coldStart - motion.coldStartInteractive, easing: EASE_ENTER })),
    );
  }, [phase, drawn, lift, scale, shown, cover]);

  // The clock on its own, keyed on the phase alone: a re-render must never restart it.
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
        // The first frame is the native splash's picture: only now may that one go.
        onLayout={() => void SplashScreen.hideAsync().catch(() => {})}
        style={[StyleSheet.absoluteFill, styles.centre, { backgroundColor: ground }]}
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
                <Stroke key={d} d={d} width={width} length={LENGTHS[i]} drawn={drawn} color={mark} />
              ))}
            </G>
          </Svg>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

/** One stroke of the mark: a dash as long as the stroke, offset back to nothing as `drawn` goes 0 → 1. */
function Stroke({ d, width, length, drawn, color }: { d: string; width: number; length: number; drawn: SharedValue<number>; color: string }) {
  const props = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - drawn.get()) }));
  return (
    <AnimatedPath
      testID="cold-start-stroke"
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinejoin="round"
      strokeDasharray={[length, length]}
      animatedProps={props}
    />
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center" },
});
