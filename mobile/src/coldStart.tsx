/**
 * The soul app's cold start (补足 C18): the shared animation (`coldStartView.tsx`) on the app's own canvas,
 * waiting on the soul session and skipped when the civilization's welcome is about to play (`welcomeFrom`:
 * C18 首次进入某个文明时 … 冷启动动画跳过). The native splash is that ground alone, light and dark (`app.json` →
 * expo-splash-screen, a blank image: the mark is written by JS, and HarmonyOS 4.2 drops the splash icon anyway).
 */
import { useColorScheme } from "react-native";

import { ColdStartView } from "./coldStartView";
import type { SessionState } from "./session";
import { splash } from "./theme";
import { welcomeFrom } from "./welcome";

export { coldStart } from "./coldStartView";

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
  return <ColdStartView booting={session.status === "booting"} skip={welcoming} ground={pair.ground} mark={pair.mark} />;
}
