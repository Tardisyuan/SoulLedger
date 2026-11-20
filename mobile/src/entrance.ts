/**
 * How the 本世 page arrives after sign-in (Design v4 第六十二批 §二), shared by the page and whoever brings it in.
 *
 * `lifeEntrance` is what the page wears (life.tsx's root): its opacity and an 8pt rise, both settled at 1. The
 * welcome (welcome.tsx) and a later sign-in (`arrive`) drive it; everything else leaves it at 1. Module-level on
 * purpose: the page and the overlay that brings it in are in different subtrees.
 *
 * `headerSeal` is the 本世 header's seal (life.tsx registers it while the band is full): the welcome's seal shrinks
 * into it at the hand-off.
 */
import { Animated, type View } from "react-native";

import { EASE } from "./ui";

export const lifeEntrance = { opacity: new Animated.Value(1), rise: new Animated.Value(1) };

export const entranceStyle = {
  opacity: lifeEntrance.opacity,
  transform: [{ translateY: lifeEntrance.rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
};

export const headerSeal: { current: View | null } = { current: null };

/** Settle the page: no entrance left half-run when a sequence is stopped. */
export function settleEntrance() {
  lifeEntrance.opacity.setValue(1);
  lifeEntrance.rise.setValue(1);
}

/**
 * The page rising in: from `at`, over `duration`, 8pt up and faded in on the enter curve. `still` (reduce motion):
 * opacity only. Returns the animation, unstarted; the caller hides the page first (`hide`).
 */
export function rise(at: number, duration: number, still: boolean, fade = true): Animated.CompositeAnimation {
  const to = (v: Animated.Value) => Animated.timing(v, { toValue: 1, duration, easing: EASE.enter, useNativeDriver: true });
  const parts = [...(fade ? [to(lifeEntrance.opacity)] : []), ...(still ? [] : [to(lifeEntrance.rise)])];
  return Animated.sequence([Animated.delay(at), Animated.parallel(parts)]);
}

export function hide(still: boolean, fade = true) {
  if (fade) lifeEntrance.opacity.setValue(0);
  if (!still) lifeEntrance.rise.setValue(0);
}
