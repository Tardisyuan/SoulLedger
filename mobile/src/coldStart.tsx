/**
 * The soul app's cold start (补足 C18): the shared animation (`coldStartView.tsx`) in gold on the
 * brand ground, waiting on the soul session and skipped when the civilization's welcome is about
 * to play (`welcomeFrom`: C18 首次进入某个文明时 … 冷启动动画跳过). The native splash is the ground
 * alone in both modes (`app.json` → expo-splash-screen, a blank image: HarmonyOS 4.2 drops the
 * splash icon anyway).
 */
import { useContext, useMemo } from "react";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";

import { LOGIN_MARK } from "./brandMark";
import { ColdStartView } from "./coldStartView";
import type { SessionState } from "./session";
import { brand } from "./theme";
import { welcomeFrom } from "./welcome";

export { coldStart } from "./coldStartView";

/**
 * The ground: `brand.ground`, v3's dark canvas, in both modes (app.json's expo-splash-screen
 * backgroundColor says the same) — the gold mark is too faint on v3's light canvas. v2 had its
 * warm ink #131211. The gold is `brand.mark`, the mark's own (assets/brand/soulledger-mark.svg,
 * user's pick 2026-10-01; v3 第三批 品牌色令牌); v3's one UI gold (`semantic.lamp`) is the lamp's alone.
 */
const GROUND = brand.ground;
const GOLD = brand.mark;

export function ColdStart({ session }: { session: SessionState }) {
  const welcoming = session.status === "signedIn" && welcomeFrom(session.profile) !== null;
  // Signed out, the app lands on the sign-in page: the mark shrinks and moves onto that page's mark (user 2026-11-21).
  // Read from the context, not `useSafeAreaInsets`, which throws with no provider; none means no inset.
  const top = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const signedOut = session.status === "signedOut";
  // One object per value: the cold start's deciding effect depends on it, and a new one each render would re-run it.
  const land = useMemo(() => (signedOut ? { top: top + LOGIN_MARK.top, size: LOGIN_MARK.size } : undefined), [signedOut, top]);
  return <ColdStartView booting={session.status === "booting"} skip={welcoming} ground={GROUND} mark={GOLD} land={land} />;
}
