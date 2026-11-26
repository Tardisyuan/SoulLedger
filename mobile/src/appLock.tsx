/**
 * 切回 App 时也要验证 (Design 第二十八批 S2). When the switch is on (`appLockOn`: under 设置 › 账号安全 › 面容登录, only
 * while that is on; on by default since 2026-11-15, off only when the soul turned it off) and the app comes back after at least five minutes in the background, a screen written like the
 * 面容 sign-in page -- title 「已锁定」 -- covers everything until the system recognises the face / finger. If it does
 * not, the way out is the sign-in page's own: 「输入密码」 signs out, and the sign-in page asks for the password.
 *
 * No flash of the screen underneath: the cover goes up when the app LEAVES the foreground (the OS snapshots the app
 * switcher then too), and comes down on return if the time away was short. The time is fixed at five minutes; there
 * is no option. A cold start that restores the stored session is locked too (F-ACCT-05, flow walk 2026-11-12): it
 * never passes the sign-in page -- `boot()` trades the stored refresh token straight for the home page -- so swiping
 * the app away and reopening it used to walk past the lock. A session the soul has just signed into is not locked.
 */
import { useState } from "react";

import { BrandMark } from "@soulledger/mobile-ui/src/brandMarkView";
import { appLockOn, knownBiometry } from "./deviceLogin";
import { useI18n } from "@soulledger/mobile-ui/src/i18n";
import { LockView, useAppLock } from "@soulledger/mobile-ui/src/lockView";
import { takeRestoredSession, useSession } from "./session";
import { useTheme } from "@soulledger/mobile-ui/src/ui";
import { useBiometry } from "@soulledger/mobile-ui/src/deviceCredential";

export { LOCK_AFTER_MS } from "@soulledger/mobile-ui/src/lockView";

/**
 * `coldStart`: the caller may decide it (the welcome waits on the same answer, so both read it at once); left out,
 * the lock reads it here. `onLocked` hears each change of 「已锁定」 up or down.
 */
export function AppLock({ coldStart: given, onLocked }: { coldStart?: boolean; onLocked?: (locked: boolean) => void } = {}) {
  const theme = useTheme();
  const { t } = useI18n();
  const { signOut } = useSession();
  const bio = useBiometry(knownBiometry);
  const [coldStart] = useState(() => given ?? (takeRestoredSession() && appLockOn()));
  // The reason the system shows with its check, in the app's language (review 2026-11-01).
  const { phase, failed, busy, unlock } = useAppLock({ enabled: appLockOn, coldStart, prompt: t("soul_app.biometric.prompt_unlock"), onLocked });

  if (phase === "off") return null;
  // 第五十批 C5: the page is the officer app's too (lockView.tsx); the words and the mark are this app's.
  return (
    <LockView
      locked={phase === "locked"}
      mark={<BrandMark size={66} color={theme.ink} />}
      title={t("soul_app.lock.title")}
      failed={failed ? t("soul_app.bio.failed", { bio: bio.word }) : null}
      unlockLabel={t(failed ? "soul_app.bio.retry" : "soul_app.bio.button", { bio: bio.word })}
      onUnlock={() => void unlock()}
      passwordLabel={t("soul_app.login.use_password")}
      onPassword={signOut}
      busy={busy}
    />
  );
}
