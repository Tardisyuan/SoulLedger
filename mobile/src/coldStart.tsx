/**
 * The soul app's cold start (补足 C18): the shared animation (`coldStartView.tsx`) on the app's own canvas,
 * waiting on the soul session and skipped when the civilization's welcome is about to play (`welcomeFrom`:
 * C18 首次进入某个文明时 … 冷启动动画跳过). The native splash is that ground alone, light and dark (`app.json` →
 * expo-splash-screen, a blank image: the mark is written by JS, and HarmonyOS 4.2 drops the splash icon anyway).
 */
import { useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { LOGIN_MARK } from "@soulledger/mobile-ui/src/brandMark";
import { ColdStartView } from "@soulledger/mobile-ui/src/coldStartView";
import type { SessionState } from "./session";
import { splash } from "@soulledger/mobile-ui/src/theme";
import { welcomeFrom } from "./welcome";

export { coldStart } from "@soulledger/mobile-ui/src/coldStartView";

/**
 * The ground and the mark (Design v4 第六十一批 一): the app's canvas in each scheme (`splash-ground`), so the start
 * does not flash dark before a light app; the mark is the neutral metal (`splash-mark`): the brand gold on dark, one
 * step deeper on light -- the gold that read too faint on a light canvas (1.9:1) was the reason the ground used to be
 * the brand's dark one in both modes, and the deeper gold is the fix (4.7:1), not a dark ground. app.json's expo-splash-screen holds the same pair (coldStart.test.tsx), so the
 * native frame and this one match. No scheme yet reads as light, as the native splash does.
 */
export function ColdStart({ session }: { session: SessionState }) {
  const pair = splash[useColorScheme() === "dark" ? "dark" : "light"];
  const welcoming = session.status === "signedIn" && welcomeFrom(session.profile) !== null;
  // Signed out, the app lands on the sign-in page: the mark shrinks and moves onto that page's mark (user 2026-11-21).
  // Read from the context, not `useSafeAreaInsets`, which throws with no provider; none means no inset.
  const top = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const signedOut = session.status === "signedOut";
  // One object per value: the cold start's deciding effect depends on it, and a new one each render would re-run it.
  const land = useMemo(() => (signedOut ? { top: top + LOGIN_MARK.top, size: LOGIN_MARK.size } : undefined), [signedOut, top]);
  return <ColdStartView booting={session.status === "booting"} skip={welcoming} ground={pair.ground} mark={pair.mark} land={land} />;
}
