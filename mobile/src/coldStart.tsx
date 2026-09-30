/**
 * The cold start (补足 C18). The native splash is an empty seal frame on paper
 * (`app.json` → expo-splash-screen). When JS is ready this draws the same frame,
 * hides the native one under it, and a seal falls into the frame and presses; from
 * 480ms the app underneath takes touches, and the layer fades out and is gone at 720.
 * A tap before then skips straight to the end.
 *
 * WHEN: once per process — a cold start. Coming back from the background is not one,
 * and neither is a remount (sign out, sign in). It waits for the session to settle
 * (who is signed in decides the seal) but not for longer than `SESSION_WAIT_MS`; a
 * slow network gets the neutral seal. It does NOT play:
 *   - under the OS "reduce motion" setting: the splash hides and the app is there;
 *   - when the civilization's welcome is about to play (`welcomeFrom`): the two do not
 *     stack (C18: 首次进入某个文明时 … 冷启动动画跳过).
 *
 * SKIN: signed in, the civilization's seal and glyph; otherwise (before sign-in, or a
 * civilization the app does not know) the neutral seal — ink, three ledger lines.
 */
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { Seal } from "./seal";
import type { SessionState } from "./session";
import { motion, preLoginTheme, themeFor, type ColorScheme } from "./theme";
import { welcomeFrom } from "./welcome";

/** Module-level: a remount in the same process is not a cold start. */
export const coldStart = { played: false };

/** How long the splash may wait on a booting session before it plays neutral. */
const SESSION_WAIT_MS = 1000;

/** The native splash's colours (app.json), so the first JS frame is the same picture. */
export const SPLASH = {
  light: { bg: "#f4ede0", frame: "#655c53" },
  dark: { bg: "#100e0d", frame: "#a3968a" },
} as const;

/** 112pt, the frame at 8…56 of 64 — splash-frame.svg as app.json places it. */
const BOX = 112;
const FRAME = "M8 8H56V56H8Z";

const EASE_DROP = Easing.bezier(0.55, 0, 1, 0.45);
const EASE_ENTER = Easing.bezier(0, 0, 0.2, 1);

type Phase = "wait" | "play" | "done";

export function ColdStart({ session, scheme }: { session: SessionState; scheme: ColorScheme }) {
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

  const drop = useSharedValue(-16);
  const shown = useSharedValue(0);
  const scale = useSharedValue(1.04);
  const cover = useSharedValue(1);
  const sealStyle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: drop.get() }, { scale: scale.get() }] }));
  const coverStyle = useAnimatedStyle(() => ({ opacity: cover.get() }));

  useEffect(() => {
    if (phase !== "play") return;
    const fall = { duration: motion.stampDrop, easing: EASE_DROP };
    drop.set(withTiming(0, fall));
    shown.set(withTiming(1, fall));
    const half = motion.stampPress / 2;
    scale.set(withDelay(motion.stampDrop, withSequence(withTiming(0.98, { duration: half }), withTiming(1, { duration: half }))));
    cover.set(withDelay(motion.coldStartInteractive, withTiming(0, { duration: motion.coldStart - motion.coldStartInteractive, easing: EASE_ENTER })));
  }, [phase, drop, shown, scale, cover]);

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
  const colours = SPLASH[scheme];
  const theme = session.status === "signedIn" ? themeFor(session.profile.civilization, scheme) : preLoginTheme(scheme);
  const glyphs = session.status === "signedIn" ? session.profile.tenant.seal_glyphs : null;
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
        style={[StyleSheet.absoluteFill, styles.centre, { backgroundColor: colours.bg }]}
      >
        <Svg width={BOX} height={BOX} viewBox="0 0 64 64" style={styles.frame}>
          <Path d={FRAME} fill="none" stroke={colours.frame} strokeWidth={1} />
        </Svg>
        <Animated.View style={sealStyle}>
          {/* The civilization seals' bodies reach 5…59 of 64: at 100 they cover the frame's 84 as the neutral one does at 112. */}
          <Seal testID="cold-start-seal" civ={theme.civ} size={theme.civ === "neutral" ? BOX : 100} theme={theme} glyphs={glyphs} />
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center" },
  frame: { position: "absolute" },
});
