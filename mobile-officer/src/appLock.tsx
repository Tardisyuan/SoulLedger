/**
 * 切回 App 时要验证 (2026-11-15 便捷度研究 O7; the soul app's `mobile/src/appLock.tsx`, ported). On exactly while
 * 指纹登录 is on (`officerDevice.appLockOn`): fingerprint sign-in lifts the "idle 24 h → password" rule, so whoever
 * picks up an unlocked officer phone must not walk past the officer either. After five minutes in the background, and
 * on a cold start that resumed the stored session, a cover asks for the fingerprint before anything shows. If it does
 * not pass, 「输入密码」 signs out the way the server would (unsent replies and drafts stay for the same officer).
 *
 * The cover goes up when the app LEAVES the foreground (the OS snapshots the app switcher then), so nothing flashes.
 * Decisions still ask `deviceCheck` on their own; this lock is in addition.
 */
import { useState } from "react";

import { OFFICER_BRAND } from "./brand";
import { useBio } from "./bioLogin";
import { DossierSeal, civOf } from "./dossierSeal";
import { officerDevice } from "./deviceLogin";
import { hallLabel } from "./rules";
import { takeRestoredSession, useSession } from "./session";
import { BrandMark, LockView, useAppLock, useI18n } from "./shared";

export { LOCK_AFTER_MS } from "./shared";

export function AppLock() {
  const { t } = useI18n();
  const { state, signOut } = useSession();
  const bio = useBio(false);
  const [coldStart] = useState(() => takeRestoredSession() && officerDevice.appLockOn());
  const { phase, failed, busy, unlock } = useAppLock({ enabled: officerDevice.appLockOn, coldStart, prompt: t("officer_app.bio_login.prompt_unlock") });

  if (phase === "off") return null;
  const user = state.status === "signedIn" ? state.user : null;
  // 第五十批 C5: the soul app's lock page (lockView.tsx) with a seal at 64 -- one of the four places a civilization's
  // colour goes. 第五十二批 E2: the civilization's seal, not a hall's (地府's reads 「地府之印」): drawing 「第一殿」 for a
  // hall the page does not know would name the wrong hall. A civilization that is not known: the brand mark.
  const seal = <DossierSeal testID="app-lock-seal" civilization={user?.tenant?.civilization} civLevel size={64} label={t("officer_app.seal.a11y")} />;
  const name = user ? user.display_name || user.username : "";
  const hall = user ? hallLabel(t, user.tenant) : undefined;
  return (
    <LockView
      locked={phase === "locked"}
      mark={civOf(user?.tenant?.civilization) ? seal : <BrandMark size={66} color={OFFICER_BRAND.mark} />}
      title={t("officer_app.bio_login.lock_title")}
      // The name alone when the hall is not known: no dangling 「 · 」.
      who={!user ? undefined : hall ? t("officer_app.bio_login.lock_who", { name, hall }) : name}
      failed={failed ? t("officer_app.bio_login.failed", { bio: bio.word }) : null}
      unlockLabel={t("officer_app.bio_login.unlock", { bio: bio.word })}
      onUnlock={() => void unlock()}
      passwordLabel={t("officer_app.bio_login.use_password")}
      onPassword={() => signOut({ keepUnsent: true })}
      busy={busy}
    />
  );
}
