/**
 * The cold start's animation, shared by both apps (cq-apps 2026-10-30 #5;補足 C18). The native
 * splash is the ground alone. When JS is ready this draws the same ground, hides the native one
 * under it, and writes the S-and-L mark: nine strokes, all at once, over `coldStartDraw`
 * (src/brandMark.ts). The mark holds for `coldStartHold`, then recedes: it lifts 8pt, shrinks to
 * 0.96 and fades over 480. From there the app underneath takes touches and the ground fades out
 * over the last 240. A tap before then skips straight to the end.
 *
 * LANDING (user 2026-11-21, 「开机动画结束之后 缩小并上移到logo位置」): when the caller passes `land` —
 * the soul app arriving on its sign-in page — the mark does not recede: over the same 480 it shrinks
 * to `land.size` and moves up to `land.top` (a window y), centred, which is where that page draws its
 * own mark. It stays opaque; the ground then fades over the last 240 and the mark with it, onto the
 * page's mark in the same spot — one mark, no jump. The target is measured against this layer's own
 * laid-out height, so nothing moves until that is known.
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
import { useEffect, useRef, useState } from "react";
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
import { curves, motion } from "./theme";

// The native splash goes the instant hideAsync is called. Its default exit is a 400ms fade,
// and under it this mark is already lifting: two marks, offset, fading together — seen on
// the emulator at 420 and 560dpi. The recede below is the only motion. Both keys: Android
// (expo-splash-screen 57, SplashScreenManager.kt) ignores `fade` and always animates alpha
// over `duration`; `fade` is what iOS reads.
SplashScreen.setOptions({ duration: 0, fade: false });

/** Module-level: a remount in the same process is not a cold start. */
export const coldStart = { played: false };

// From the first render of a cold start that will decide (the native splash is up) until it is done.
let showing = false;
const waiting = new Set<() => void>();

/**
 * Runs `fn` once nothing of the cold start -- the native splash or this layer -- is on screen; on the next tick if
 * none is. The app lock's cold-start face prompt waits on it (iOS Simulator 2026-11-27): asked at once, the system
 * sheet opened over the blank splash, iOS took the app to `inactive` in the middle of the cold start, and the splash
 * was still up a minute after the face was recognised. Returns a cancel.
 */
export function afterColdStart(fn: () => void): () => void {
  if (!showing) {
    const id = setTimeout(fn, 0);
    return () => clearTimeout(id);
  }
  waiting.add(fn);
  return () => void waiting.delete(fn);
}

function coldStartOver() {
  showing = false;
  const fns = [...waiting];
  waiting.clear();
  fns.forEach((fn) => fn());
}

/** How long the splash may wait on a booting session before it plays. */
const SESSION_WAIT_MS = 1000;

const BOX = 112;
const LENGTHS = STROKES.map(([d]) => pathLength(d));
const AnimatedPath = Animated.createAnimatedComponent(Path);

const EASE_EXIT = Easing.bezier(...curves.exit);
const EASE_ENTER = Easing.bezier(...curves.enter);
const EASE_WRITE = Easing.bezier(0.4, 0, 0.2, 1);
const EASE_MOVE = Easing.bezier(...curves.standard);

type Phase = "wait" | "play" | "done";

/** Where the page under the cold start draws the mark: its top edge (window y) and its width. */
export type Land = { top: number; size: number };

/** The landing transform for a mark `BOX` wide centred in a layer `height` tall, onto `land`. */
export function landing(land: Land, height: number) {
  const centre = land.top + (land.size * MARK_HEIGHT) / MARK_WIDTH / 2;
  return { translateY: centre - height / 2, scale: land.size / BOX };
}

export function ColdStartView({
  booting,
  skip = false,
  ground,
  mark,
  land,
}: {
  booting: boolean;
  skip?: boolean;
  ground: string;
  mark: string;
  /** Land the mark here instead of receding (read once, when the cold start decides to play). */
  land?: Land;
}) {
  const [phase, setPhase] = useState<Phase>(() => {
    if (coldStart.played) return "done";
    showing = true;
    return "wait";
  });
  const [waited, setWaited] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const [target, setTarget] = useState<Land | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const started = useRef(0);

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
        } else {
          setTarget(land ?? null);
          setPhase("play");
        }
      });
    return () => {
      alive = false;
    };
  }, [phase, booting, skip, waited, land]);

  // Done (here, or in a remount that finds it played): what waited on the cold start (afterColdStart) goes ahead.
  useEffect(() => {
    if (phase === "done") coldStartOver();
  }, [phase]);

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
    started.current = Date.now();
    drawn.set(withTiming(1, { duration: motion.coldStartDraw, easing: EASE_WRITE }));
  }, [phase, drawn]);

  // After the hold: recede, or land (once the layer's height is known). Timed from the start of the draw.
  useEffect(() => {
    if (phase !== "play" || (target && height === null)) return;
    const written = Math.max(0, motion.coldStartDraw + motion.coldStartHold - (Date.now() - started.current));
    if (target && height !== null) {
      const to = landing(target, height);
      const move = { duration: motion.coldStartInteractive, easing: EASE_MOVE };
      lift.set(withDelay(written, withTiming(to.translateY, move)));
      scale.set(withDelay(written, withTiming(to.scale, move)));
    } else {
      const recede = { duration: motion.coldStartInteractive, easing: EASE_EXIT };
      lift.set(withDelay(written, withTiming(-8, recede)));
      scale.set(withDelay(written, withTiming(0.96, recede)));
      shown.set(withDelay(written, withTiming(0, recede)));
    }
    cover.set(
      withDelay(written + motion.coldStartInteractive, withTiming(0, { duration: motion.coldStart - motion.coldStartInteractive, easing: EASE_ENTER })),
    );
  }, [phase, target, height, lift, scale, shown, cover]);

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
        onLayout={(e) => {
          void SplashScreen.hideAsync().catch(() => {});
          setHeight(e.nativeEvent.layout.height);
        }}
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
