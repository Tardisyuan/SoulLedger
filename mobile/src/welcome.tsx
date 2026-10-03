/**
 * The welcome (handoff "灵魂簿 App · 文明气质" 1b): a full-screen pause the
 * first time a soul enters a civilization. Two layers — the old ground below
 * (or the neutral one at first sign-in), the new ground and its illustration
 * above, fading in over 600ms ease-out — held 1200ms, then the whole overlay
 * fades out over 240ms onto the life page. A tap skips it.
 *
 * WHEN IT PLAYS is the server's record, never this device's: `/me/`'s
 * `welcomed_civilizations`, most recent welcome last. So a new device, a new
 * sign-in or a reinstall does not play it again. It plays when
 *
 *   - the current civilization has never been welcomed (first sign-in; a
 *     residence starting somewhere new), or
 *   - the soul is home again and home was not the last welcome — home was
 *     recorded before, but coming back is a change of civilization, not a
 *     return visit, so it plays once more (1b, "回归原籍").
 *
 * The record is written only once the welcome has been SEEN: when it finishes,
 * or when a tap skips it (user decision 2026-09-27). One that is cut short —
 * the app killed, the soul signed out mid-fade — writes nothing, so the next
 * launch plays it again. If the write fails it is not retried here: within this
 * process each soul × civilization plays once (`PLAYED`), and the next launch
 * decides again — one welcome too many, never one missed. Under reduce-motion
 * every duration is 0: nothing is shown and the record is written at once.
 */
import { soulApi, type Civilization, type MeProfile } from "@soulledger/core/api/soul";
import { useEffect, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import { Hero } from "./emblems";
import { useI18n } from "./i18n";
import { civKeyOf, motion, themeFor, v3, type CivKey, type ColorScheme } from "./theme";
import { Txt } from "./ui";

type Welcomable = Pick<MeProfile, "civilization" | "home_civilization" | "welcomed_civilizations">;

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

export function Welcome({ profile, scheme }: { profile: MeProfile; scheme: ColorScheme }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<{ from: CivKey; civilization: string } | null>(null);
  const [top] = useState(() => new Animated.Value(0));
  const [whole] = useState(() => new Animated.Value(1));
  const from = welcomeFrom(profile);
  const { civilization } = profile;
  const key = `${profile.soul_code}:${civilization}`;

  useEffect(() => {
    if (from === null || PLAYED.has(key)) return;
    PLAYED.add(key);
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (reduced) record(civilization);
        else if (alive) setShown({ from, civilization });
      });
    return () => {
      alive = false;
    };
  }, [key, from, civilization]);

  /** Seen: to the end, or skipped. */
  const done = (civilization: string) => {
    record(civilization);
    setShown(null);
  };

  useEffect(() => {
    if (!shown) return;
    top.setValue(0);
    whole.setValue(1);
    const run = Animated.sequence([
      Animated.timing(top, { toValue: 1, duration: motion.welcomeIn, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(motion.welcomeHold),
      Animated.timing(whole, { toValue: 0, duration: motion.welcomeOut, useNativeDriver: true }),
    ]);
    // `finished` is false when the run is stopped by an unmount: not seen, not recorded.
    run.start(({ finished }) => {
      if (!finished) return;
      record(shown.civilization);
      setShown(null);
    });
    return () => run.stop();
  }, [shown, top, whole]);

  if (!shown) return null;
  const to = themeFor(shown.civilization, scheme);
  // The underworld's name (中国地府, 杜阿特 …), not the civilization's (user decision 2026-09-27).
  const text = t("soul_app.welcome.entered", { civ: t(`soul_app.welcome.realm.${shown.civilization}`) });
  return (
    <Animated.View testID="welcome" style={[StyleSheet.absoluteFill, { opacity: whole }]}>
      <Pressable
        testID="welcome-skip"
        accessibilityRole="button"
        accessibilityLabel={text}
        accessibilityHint={t("soul_app.welcome.skip")}
        onPress={() => done(shown.civilization)}
        style={[StyleSheet.absoluteFill, { backgroundColor: v3[scheme].surface }]}
      >
        <Animated.View testID={`welcome-${shown.from}-${to.civ}`} style={[styles.top, { backgroundColor: to.s1, opacity: top }]}>
          <Hero civ={to.civ} stroke={to.plaque} size={96} strokeWidth={0.9} />
          <View style={styles.text}>
            <Txt variant="title" style={[styles.center, { color: to.ink }]}>
              {text}
            </Txt>
          </View>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center", gap: 16, paddingHorizontal: 24 },
  text: { alignSelf: "stretch" },
  center: { textAlign: "center" },
});
