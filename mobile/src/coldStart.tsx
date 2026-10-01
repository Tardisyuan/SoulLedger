/**
 * The cold start (补足 C18). The native splash is the S-and-L balance mark, gold on ink,
 * in both modes (`app.json` → expo-splash-screen; the PNG is built by
 * scripts/build-app-icon.mjs). When JS is ready this draws the same picture — the same
 * PNG, the same size, the same ground — hides the native one under it, and the mark
 * recedes: it lifts 8pt, shrinks to 0.96 and fades by 480. From 480 the app underneath
 * takes touches and the ink ground fades out; it is gone at 720. A tap before then skips
 * straight to the end.
 *
 * WHEN: once per process — a cold start. Coming back from the background is not one,
 * and neither is a remount (sign out, sign in). It waits for the session to settle (a
 * signed-in soul may be due its civilization's welcome) but not for longer than
 * `SESSION_WAIT_MS`. It does NOT play:
 *   - under the OS "reduce motion" setting: the splash hides and the app is there;
 *   - when the civilization's welcome is about to play (`welcomeFrom`): the two do not
 *     stack (C18: 首次进入某个文明时 … 冷启动动画跳过).
 */
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Image, Pressable, StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from "react-native-reanimated";

import type { SessionState } from "./session";
import { motion } from "./theme";
import { welcomeFrom } from "./welcome";

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

/** app.json's expo-splash-screen: its image, imageWidth and backgroundColor (both modes). */
const MARK = require("../assets/splash-mark.png");
const BOX = 112;
const INK = "#131211";

const EASE_EXIT = Easing.bezier(0.4, 0, 1, 1);
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);

type Phase = "wait" | "play" | "done";

export function ColdStart({ session }: { session: SessionState }) {
  const [phase, setPhase] = useState<Phase>(coldStart.played ? "done" : "wait");
  const [waited, setWaited] = useState(false);
  const [interactive, setInteractive] = useState(false);

  // Decide once the session has settled (or the wait ran out).
  useEffect(() => {
    if (phase !== "wait") return;
    if (session.status === "booting" && !waited) {
      const id = setTimeout(() => setWaited(true), SESSION_WAIT_MS);
      return () => clearTimeout(id);
    }
    coldStart.played = true;
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (!alive) return;
        const welcoming = session.status === "signedIn" && welcomeFrom(session.profile) !== null;
        if (reduced || welcoming) {
          void SplashScreen.hideAsync().catch(() => {});
          setPhase("done");
        } else setPhase("play");
      });
    return () => {
      alive = false;
    };
  }, [phase, session, waited]);

  // Frame 0 is the native splash: the mark at rest, fully there.
  const lift = useSharedValue(0);
  const scale = useSharedValue(1);
  const shown = useSharedValue(1);
  const cover = useSharedValue(1);
  const markStyle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: lift.get() }, { scale: scale.get() }] }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.get() }));

  useEffect(() => {
    if (phase !== "play") return;
    const recede = { duration: motion.coldStartInteractive, easing: EASE_EXIT };
    lift.set(withTiming(-8, recede));
    scale.set(withTiming(0.96, recede));
    shown.set(withTiming(0, recede));
    cover.set(withDelay(motion.coldStartInteractive, withTiming(0, { duration: motion.coldStart - motion.coldStartInteractive, easing: EASE_ENTER })));
  }, [phase, lift, scale, shown, cover]);

  // The clock on its own, keyed on the phase alone: a re-render must never restart it.
  useEffect(() => {
    if (phase !== "play") return;
    const usable = setTimeout(() => setInteractive(true), motion.coldStartInteractive);
    const gone = setTimeout(() => setPhase("done"), motion.coldStart);
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
        style={[StyleSheet.absoluteFill, styles.centre, { backgroundColor: INK }]}
      >
        <Animated.View testID="cold-start-mark-layer" style={markStyle}>
          <Image testID="cold-start-mark" source={MARK} style={{ width: BOX, height: BOX }} resizeMode="contain" />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center" },
});
