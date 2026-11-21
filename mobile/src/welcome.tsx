/**
 * The welcome (handoff "灵魂簿 App · 文明气质" 1b; redrawn by Design v4 第六十二批 §二): the moment a soul is entered
 * into a civilization, between pressing 「登录」 and the 本世 page.
 *
 * WHAT IS ON IT: the page's own ground (the canvas, the same in every civilization — no wash of civilization colour),
 * the civilization's top line drawing in from the left, its seal stamped down in the middle (96, `plaque` — the 本世 header seal's colour,
 * 1.18 → 1), and 「你已进入{冥界名}」 16 below it. The theme is the civilization's from the first frame
 * (navigation.tsx themes the signed-in tree by the profile), so nothing switches colour afterwards.
 *
 * TIMING (`WELCOME`): two pieces of motion with a still hold between them, each inside `choreographyMax` (480), so no
 * new named exception —
 *   entrance 0–360: the line 240; the seal from 40 over 200; the sentence from 200 over 160.
 *   hold     900: nothing moves. A tap ends it (or the entrance) and goes straight to the hand-off — not a cut.
 *   hand-off 320: the seal shrinks into the 本世 header's seal (`headerSeal`) on the exit curve while the sentence
 *            fades out over 160; from 80 the ground fades and the 本世 page rises 8 into place over 240. If the header
 *            seal is not on screen the seal fades out where it is over 160 instead of flying off to nowhere.
 * About 1.6s in all. Whoever waits on it (`onSettled`: the 「下次用面容登录?」 sheet) is told when the hand-off ends.
 *
 * REDUCE MOTION: a still frame — line drawn, seal stamped, the sentence — fades in over 80, holds the same 900,
 * fades out over 80, and the page fades in over 80. No scale, no rise, no drawing. A tap skips to the fade-out.
 *
 * WHEN IT PLAYS is the server's record, never this device's: `/me/`'s `welcomed_civilizations`, most recent welcome
 * last. So a new device, a new sign-in or a reinstall does not play it again. It plays when
 *
 *   - the current civilization has never been welcomed (first sign-in; a residence starting somewhere new), or
 *   - the soul is home again and home was not the last welcome — home was recorded before, but coming back is a
 *     change of civilization, not a return visit, so it plays once more (1b, "回归原籍").
 *
 * The record is written only once the welcome has been SEEN: at the end of the hand-off, or when a tap skips to it
 * (user decision 2026-09-27). One that is cut short — the app killed, the soul signed out mid-way — writes nothing,
 * so the next launch plays it again. If the write fails it is not retried here: within this process each soul ×
 * civilization plays once (`PLAYED`), and the next launch decides again — one welcome too many, never one missed.
 */
import { soulApi, type Civilization, type MeProfile } from "@soulledger/core/api/soul";
import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View, useWindowDimensions, type LayoutRectangle } from "react-native";

import { Topline } from "./civHead";
import { headerSeal, hide, rise, settleEntrance } from "./entrance";
import { useI18n } from "./i18n";
import { OutlineSeal } from "./seal";
import { civKeyOf, motion, themeFor, type CivKey, type ColorScheme } from "./theme";
import { EASE, Txt } from "./ui";

type Welcomable = Pick<MeProfile, "civilization" | "home_civilization" | "welcomed_civilizations">;

/** 第六十二批 timetable, in ms. The entrance ends at `motion.welcomeIn`, the hand-off at `motion.welcomeOut`. */
export const WELCOME = {
  line: 240,
  sealAt: 40,
  seal: 200,
  textAt: 200,
  text: motion.fade,
  hold: motion.welcomeHold,
  flight: motion.welcomeOut,
  textOut: motion.fade,
  riseAt: 80,
  rise: motion.welcomeOut - 80,
  /** Reduce motion: every fade. */
  still: motion.reduced,
  /** The seal's stamp: down from this scale (the `motion.seal` gesture of the web, no glow). */
  stampFrom: 1.18,
  sealSize: 96,
} as const;

/** The ground the welcome fades FROM, or null when it does not play. */
export function welcomeFrom(profile: Welcomable): CivKey | null {
  // An unrecognised civilization wears the neutral ground: there is nothing to enter.
  if (civKeyOf(profile.civilization) === "neutral") return null;
  const seen: string[] = profile.welcomed_civilizations ?? [];
  const last = seen[seen.length - 1];
  const from = last ? civKeyOf(last) : "neutral";
  if (!seen.includes(profile.civilization)) return from;
  if (profile.civilization === profile.home_civilization && last !== profile.civilization) return from;
  return null;
}

/**
 * Once per soul × civilization in this process, whatever the server answered —
 * module-level, so a remount (sign out and back in) does not replay it either.
 */
const PLAYED = new Set<string>();

/** Record the welcome as seen. A failure is left for the next launch to re-decide. */
const record = (civilization: string) => void soulApi.markWelcomed(civilization as Civilization).catch(() => {});

type Shown = { from: CivKey; civilization: string; reduced: boolean };
type Box = Pick<LayoutRectangle, "x" | "y" | "width" | "height">;

/**
 * The seal's flight from where it stands (`from`, in the window) onto the header seal (`to`): centre to centre, scaled
 * to its width. null when either is unknown or the header seal is not on screen — then it fades where it stands.
 */
export function flightTo(from: Box | null, to: Box | null, screenHeight: number): { dx: number; dy: number; scale: number } | null {
  if (!from || !to || from.width <= 0 || to.width <= 0 || to.y + to.height <= 0 || to.y >= screenHeight) return null;
  return {
    dx: to.x + to.width / 2 - (from.x + from.width / 2),
    dy: to.y + to.height / 2 - (from.y + from.height / 2),
    scale: to.width / from.width,
  };
}

/** How long the header seal may take to answer where it is before the seal just fades where it stands. */
const MEASURE_WAIT = 100;

/**
 * `held`: the 「已锁定」 screen is up. The welcome waits under it and starts once it is down -- played under the lock it
 * would be recorded as seen while nobody saw it (simulator, 2026-11-21: a restored session's welcome never showed).
 */
export function Welcome({ profile, scheme, onSettled, held = false }: { profile: MeProfile; scheme: ColorScheme; onSettled?: () => void; held?: boolean }) {
  const { t } = useI18n();
  const { height: screenHeight } = useWindowDimensions();
  const [shown, setShown] = useState<Shown | null>(null);
  const [v] = useState(() => ({
    whole: new Animated.Value(0),
    ground: new Animated.Value(1),
    line: new Animated.Value(0),
    stamp: new Animated.Value(0),
    text: new Animated.Value(0),
    flight: new Animated.Value(0),
    sealGone: new Animated.Value(1),
  }));
  const [flight, setFlight] = useState<{ dx: number; dy: number; scale: number } | null>(null);
  const own = useRef<Box | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const phase = useRef<"in" | "out" | "done">("in");
  const seen = useRef(false);
  /** Seen: at the tap that skips, or at the end — once. */
  const see = useCallback((civ: string) => {
    if (seen.current) return;
    seen.current = true;
    record(civ);
  }, []);
  const from = welcomeFrom(profile);
  const { civilization } = profile;
  const key = `${profile.soul_code}:${civilization}`;

  useEffect(() => {
    if (from === null || held) return;
    // Played before in this process: nothing to show, so whoever waits on the welcome need not.
    if (PLAYED.has(key)) return onSettled?.();
    PLAYED.add(key);
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => alive && setShown({ from, civilization, reduced }));
    return () => {
      alive = false;
    };
  }, [key, from, civilization, onSettled, held]);

  /** Seen and handed over: the record, the overlay gone, the waiters told. */
  const finish = useCallback(
    (civ: string) => {
      phase.current = "done";
      see(civ);
      settleEntrance();
      setShown(null);
      onSettled?.();
    },
    [onSettled, see],
  );

  /** The hand-off (or, under reduce motion, the fade-out), from wherever the entrance or the hold is. */
  const handOff = useCallback(
    (s: Shown) => {
      if (phase.current !== "in") return;
      phase.current = "out";
      running.current?.stop();
      if (s.reduced) {
        v.whole.setValue(1);
        const out = Animated.sequence([
          Animated.timing(v.whole, { toValue: 0, duration: WELCOME.still, useNativeDriver: true }),
          rise(0, WELCOME.still, true),
        ]);
        running.current = out;
        out.start(({ finished }) => finished && finish(s.civilization));
        return;
      }
      // The entrance, if cut short, lands on its end: the hand-off starts from the full picture.
      v.line.setValue(1);
      v.stamp.setValue(1);
      v.text.setValue(1);
      const go = (to: Box | null) => {
        if (phase.current !== "out") return;
        const path = flightTo(own.current, to, screenHeight);
        const onScreen = path !== null;
        if (path) setFlight(path);
        const out = Animated.parallel([
          onScreen
            ? Animated.timing(v.flight, { toValue: 1, duration: WELCOME.flight, easing: EASE.exit, useNativeDriver: true })
            : Animated.timing(v.sealGone, { toValue: 0, duration: WELCOME.textOut, easing: EASE.exit, useNativeDriver: true }),
          Animated.timing(v.text, { toValue: 0, duration: WELCOME.textOut, easing: EASE.exit, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(WELCOME.riseAt),
            Animated.timing(v.ground, { toValue: 0, duration: WELCOME.rise, easing: EASE.enter, useNativeDriver: true }),
          ]),
          rise(WELCOME.riseAt, WELCOME.rise, false, false),
        ]);
        running.current = out;
        out.start(({ finished }) => finished && finish(s.civilization));
      };
      const target = headerSeal.current;
      if (!target || !own.current) return go(null);
      let answered = false;
      const late = setTimeout(() => {
        answered = true;
        go(null);
      }, MEASURE_WAIT);
      target.measureInWindow((x, y, width, height) => {
        if (answered) return;
        answered = true;
        clearTimeout(late);
        go({ x, y, width, height });
      });
    },
    [v, finish, screenHeight],
  );

  useEffect(() => {
    if (!shown) return;
    phase.current = "in";
    seen.current = false;
    const timing = (value: Animated.Value, duration: number, at = 0) =>
      Animated.sequence([Animated.delay(at), Animated.timing(value, { toValue: 1, duration, easing: EASE.enter, useNativeDriver: true })]);
    let entrance: Animated.CompositeAnimation;
    if (shown.reduced) {
      // A still frame: everything already in place, the whole of it fading in.
      v.line.setValue(1);
      v.stamp.setValue(1);
      v.text.setValue(1);
      v.whole.setValue(0);
      hide(true);
      entrance = Animated.sequence([timing(v.whole, WELCOME.still), Animated.delay(WELCOME.hold)]);
    } else {
      v.whole.setValue(1);
      v.ground.setValue(1);
      v.line.setValue(0);
      v.stamp.setValue(0);
      v.text.setValue(0);
      v.flight.setValue(0);
      v.sealGone.setValue(1);
      // The page waits under the ground, 8 low, for the hand-off; it is not faded (the ground covers it).
      hide(false, false);
      entrance = Animated.sequence([
        Animated.parallel([timing(v.line, WELCOME.line), timing(v.stamp, WELCOME.seal, WELCOME.sealAt), timing(v.text, WELCOME.text, WELCOME.textAt)]),
        Animated.delay(WELCOME.hold),
      ]);
    }
    running.current = entrance;
    entrance.start(({ finished }) => finished && handOff(shown));
    // Stopped by an unmount: not seen, not recorded; the page is not left hidden.
    return () => {
      running.current?.stop();
      settleEntrance();
    };
  }, [shown, v, handOff]);

  if (!shown) return null;
  const to = themeFor(shown.civilization, scheme);
  // The underworld's name (中国地府, 杜阿特 …), not the civilization's (user decision 2026-09-27).
  const text = t("soul_app.welcome.entered", { civ: t(`soul_app.welcome.realm.${shown.civilization}`) });
  // 第六十三批 三 d: the header seal's colour (`plaque`, civT), so the seal that shrinks into it does not change colour.
  const color = to.plaque;
  const sealMotion = {
    opacity: Animated.multiply(v.stamp, v.sealGone),
    transform: [
      { translateX: v.flight.interpolate({ inputRange: [0, 1], outputRange: [0, flight?.dx ?? 0] }) },
      { translateY: v.flight.interpolate({ inputRange: [0, 1], outputRange: [0, flight?.dy ?? 0] }) },
      { scale: Animated.multiply(v.stamp.interpolate({ inputRange: [0, 1], outputRange: [WELCOME.stampFrom, 1] }), v.flight.interpolate({ inputRange: [0, 1], outputRange: [1, flight?.scale ?? 1] })) },
    ],
  };
  return (
    <Animated.View testID="welcome" style={[StyleSheet.absoluteFill, { opacity: v.whole }]}>
      <Pressable
        testID="welcome-skip"
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={t("soul_app.welcome.skip")}
        onPress={() => {
          // Skipped is seen: what the soul tapped past is recorded at the tap.
          see(shown.civilization);
          handOff(shown);
        }}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View testID="welcome-ground" style={[StyleSheet.absoluteFill, { backgroundColor: to.s0, opacity: v.ground }]} />
        <Animated.View testID="welcome-line" style={[styles.line, { opacity: v.ground, transform: [{ scaleX: v.line }] }]}>
          <Topline />
        </Animated.View>
        <View testID={`welcome-${shown.from}-${to.civ}`} style={styles.stage}>
          <Animated.View
            testID="welcome-seal"
            style={sealMotion}
            onLayout={(e) => {
              own.current = e.nativeEvent.layout;
            }}
          >
            <OutlineSeal civ={to.civ} size={WELCOME.sealSize} color={color} glyphs={profile.tenant?.seal_glyphs} />
          </Animated.View>
          <Animated.View testID="welcome-text" style={[styles.text, { opacity: v.text }]}>
            <Txt variant="title" style={[styles.center, { color: to.ink }]}>
              {text}
            </Txt>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  line: { position: "absolute", top: 0, left: 0, right: 0, height: 4, transformOrigin: "left" },
  stage: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  text: { alignSelf: "stretch" },
  center: { textAlign: "center" },
});

/** The life page's own arrival on a later sign-in (no welcome): 320 — it rises 8 and fades in from 80 over 240. */
export function useArrival(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let alive = true;
    let run: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (!alive) return;
        hide(reduced);
        // Reduce motion: an 80 fade, nothing else.
        run = reduced ? rise(0, WELCOME.still, true) : rise(WELCOME.riseAt, WELCOME.rise, false);
        run.start();
      });
    return () => {
      alive = false;
      run?.stop();
      settleEntrance();
    };
  }, [on]);
}
