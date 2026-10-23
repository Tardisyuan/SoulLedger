/**
 * The soul's session, as a state the navigator renders from.
 *
 * The server is the only authority on "must this soul change its password":
 * the login response says so, and afterwards any `/me/` call answers 403
 * `password_change_required` (core's soul client turns that into
 * `onSoulPasswordChangeRequired`). Nothing about it is persisted here, so a
 * restart asks the server again instead of trusting a flag on the device.
 */
import {
  clearSoulTokens,
  isMfaRequired,
  onSoulPasswordChangeRequired,
  soulApi,
  soulErrorCode,
  soulErrorMessage,
  soulErrorStatus,
  storeSoulTokens,
  type MeProfile,
  type SoulErrorMessage,
  type SoulLoginOutcome,
  type SoulLoginResponse,
} from "@soulledger/core/api/soul";
import { getRefreshToken, platform } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { LOCALE_COOKIE, isLocale } from "@soulledger/core/config/locale";

import { clearOutbox } from "./chat";
import { bioEnabled, readCredential, rememberAccount, spendAutoPrompt } from "./deviceLogin";
import { useI18n } from "./i18n";
import { deviceTokenFor, forgetDevice, rememberDevice } from "./mfa";
import { setUnauthorizedHandler } from "./platform";
import { PUSH_TOKEN_KEY, hasRegisteredDevice, unregisterDevice } from "./push";
import { clearVoiceNumbers } from "./voiceCache";


/**
 * A sign-out the server never heard (offline): its refresh token is kept and the logout is sent again at the next
 * start. The server ends this device's session on logout (2026-10-23), which is what stops the lock-screen pushes;
 * until then the phone kept getting the previous soul's notifications. Only a lost request is kept: an answer of any
 * kind (the token already dead included) is final. ponytail: one retry per start, no backoff.
 */
export const PENDING_LOGOUT_KEY = "soulledger.pendingLogout";

function keepPendingLogout(error: unknown, refresh: string): void {
  if (!(error as { response?: unknown })?.response) platform().secure.set(PENDING_LOGOUT_KEY, refresh);
}

export function retryPendingLogout(): void {
  const refresh = platform().secure.get(PENDING_LOGOUT_KEY);
  if (!refresh) return;
  soulApi.logout(refresh).then(
    () => platform().secure.remove(PENDING_LOGOUT_KEY),
    (e: unknown) => {
      if ((e as { response?: unknown })?.response) platform().secure.remove(PENDING_LOGOUT_KEY);
    }
  );
}

export type SessionState =
  | { status: "booting" }
  | { status: "unreachable"; error: SoulErrorMessage }
  | { status: "signedOut"; notice?: SoulErrorMessage }
  | { status: "mustChangePassword"; expiresAt: string | null }
  | { status: "signedIn"; profile: MeProfile };

/**
 * Sign-in step 1 passed and this soul has two-step verification on: the password is right, no token has been
 * issued. `pendingToken` opens exactly one door (the second step, five minutes) and lives in the login
 * screen's state only -- not in the session, a store, a navigation param or a log. `hall` is what the
 * 「手机和恢复码都没有了」 page names, taken from step 1's answer so no anonymous endpoint has to tell it.
 */
export interface MfaChallenge {
  pendingToken: string;
  soulCode: string;
  hall: { displayName: string; hallNames: Record<string, string> };
}

export interface Session {
  state: SessionState;
  /** `null`: signed in (or must change the password). A challenge: the second step is next. */
  signIn: (soulCode: string, password: string) => Promise<MfaChallenge | null>;
  /** 面容 / 指纹: the credential read from the secure store in place of a password. Same answer as `signIn`; throws the axios error. */
  deviceSignIn: (soulCode: string, credential: string) => Promise<MfaChallenge | null>;
  /**
   * The password typed at this sign-in or password change, held in memory only so 「下次用面容登录？」 can use it.
   * Never stored; `dropPassword` ends it (the question was answered, or the soul signed out).
   */
  heldPassword: () => string | null;
  dropPassword: () => void;
  /** Step 2. Throws the axios error: the screen reads it with `soulMfaFailure`. */
  verifyMfa: (
    challenge: MfaChallenge,
    proof: { code: string } | { recoveryCode: string },
    remember: boolean
  ) => Promise<void>;
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
  retryBoot: () => void;
}

export const SessionContext = createContext<Session | null>(null);

const signedIn = (profile: MeProfile): SessionState => ({ status: "signedIn", profile });

/** What a failed `GET /me/` means for the session. */
export function stateAfterFailedMe(error: unknown): SessionState {
  const status = soulErrorStatus(error);
  if (soulErrorCode(error) === "password_change_required") return { status: "mustChangePassword", expiresAt: null };
  if (status === null) return { status: "unreachable", error: soulErrorMessage(error) };
  // 401: the soul client has already cleared the tokens and called onUnauthorized.
  if (status === 401) return { status: "signedOut" };
  // e.g. 403 initial_password_expired: this session can go nowhere; say why.
  clearSoulTokens();
  clearOutbox();
  clearVoiceNumbers();
  return { status: "signedOut", notice: soulErrorMessage(error) };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() =>
    getRefreshToken() ? { status: "booting" } : { status: "signedOut" }
  );
  const { setLocale } = useI18n();
  const password = useRef<string | null>(null);

  /**
   * The account's language is the one the settings screen promises to follow:
   * once we know who we are, adopt it — on a device that has no language of its
   * own yet (one stored here was picked by the soul and is written to the account
   * by `syncPushLocale`). Best effort: a failed read, or a locale this App lacks,
   * keeps the device's.
   */
  const adoptAccountLocale = useCallback(() => {
    if (isLocale(platform().persistent.get(LOCALE_COOKIE))) return;
    soulApi.notificationSettings().then(
      ({ locale }) => {
        if (isLocale(locale)) setLocale(locale);
      },
      () => {}
    );
  }, [setLocale]);

  const land = useCallback(
    (profile: MeProfile) => {
      setState(signedIn(profile));
      // The sign-in page of the next cold start is this account's (name included, so a rename shows).
      rememberAccount(profile.soul_code, profile.name);
      spendAutoPrompt();
      adoptAccountLocale();
    },
    [adoptAccountLocale]
  );

  /** Where every successful authentication lands: ask the server who we are. */
  const enter = useCallback(
    () => soulApi.me().then((p) => land(p), (e) => setState(stateAfterFailedMe(e))),
    [land]
  );

  const retryBoot = useCallback(() => {
    setState({ status: "booting" });
    void enter();
  }, [enter]);

  useEffect(() => {
    // An expired session ends like a sign-out: the unsent letters leave the device too.
    setUnauthorizedHandler(() => {
      clearOutbox();
      clearVoiceNumbers();
      setState({ status: "signedOut" });
    });
    const off = onSoulPasswordChangeRequired(() =>
      setState((prev) => (prev.status === "mustChangePassword" ? prev : { status: "mustChangePassword", expiresAt: null }))
    );
    return () => {
      off();
      setUnauthorizedHandler(() => {});
    };
  }, []);

  // A stored refresh token from a previous run: ask the server whether it still holds.
  useEffect(() => {
    retryPendingLogout();
    if (getRefreshToken()) void enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot runs once
  }, []);

  /** Both ways in (the password alone, or the password and the second step) end here. */
  const finishSignIn = useCallback(
    async (response: SoulLoginResponse) => {
      storeSoulTokens(response);
      if (response.account.must_change_password) {
        setState({ status: "mustChangePassword", expiresAt: response.account.initial_password_expires_at ?? null });
        return;
      }
      await enter();
    },
    [enter]
  );

  /** The answer to a password or a device-credential sign-in, which have one shape. */
  const afterFirstStep = useCallback(
    async (response: SoulLoginOutcome, sent: string | undefined, soulCode: string): Promise<MfaChallenge | null> => {
      if (isMfaRequired(response)) {
        // The server did not honour the remembered phone (expired, voided, another account's): forget it.
        if (sent) forgetDevice(soulCode);
        const home = response.home_tenant;
        return {
          pendingToken: response.pending_token,
          soulCode: response.soul_code,
          hall: { displayName: home.display_name, hallNames: home.hall_names },
        };
      }
      await finishSignIn(response);
      return null;
    },
    [finishSignIn]
  );

  const signIn = useCallback(
    async (soulCode: string, typed: string): Promise<MfaChallenge | null> => {
      const sent = deviceTokenFor(soulCode);
      const response = await soulApi.login(soulCode, typed, sent);
      // Held before the profile lands: the question on the home page reads it as the page appears.
      password.current = typed;
      try {
        return await afterFirstStep(response, sent, soulCode);
      } catch (e) {
        password.current = null;
        throw e;
      }
    },
    [afterFirstStep]
  );

  const deviceSignIn = useCallback<Session["deviceSignIn"]>(
    async (soulCode, credential) => {
      const sent = deviceTokenFor(soulCode);
      return afterFirstStep(await soulApi.deviceLogin({ soul_code: soulCode, credential, device_token: sent }), sent, soulCode);
    },
    [afterFirstStep]
  );

  const verifyMfa = useCallback<Session["verifyMfa"]>(
    async (challenge, proof, remember) => {
      const response = await soulApi.mfaVerify({
        pending_token: challenge.pendingToken,
        ...("code" in proof ? { code: proof.code } : { recovery_code: proof.recoveryCode }),
        remember_device: remember,
      });
      if (remember && response.device_token) rememberDevice(challenge.soulCode, response.device_token);
      await finishSignIn(response);
    },
    [finishSignIn]
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      // 面容 / 指纹 on this phone survives its own password change (第二十批 §5): the credential goes along and the
      // server keeps it. That costs one system verification; if the soul declines it the request goes without,
      // and the credential lapses -- the sign-in page then says so.
      const credential = bioEnabled() ? await readCredential() : null;
      // The other devices are signed out (and their push registrations stopped); this phone keeps its own push
      // token and swaps to the new token pair the server hands back.
      storeSoulTokens(
        await soulApi.changePassword(
          oldPassword,
          newPassword,
          platform().persistent.get(PUSH_TOKEN_KEY) ?? undefined,
          credential?.status === "ok" ? credential.credential : undefined
        )
      );
      password.current = newPassword;
      await enter();
    },
    [enter]
  );

  /**
   * The push token is unregistered FIRST: that endpoint is authenticated, so it
   * must run before the tokens are cleared and the session revoked. The screen
   * returns to login at once; the clean-up follows, and clears only the tokens
   * it started with (a quick sign-in in between keeps its own).
   */
  const signOut = useCallback(() => {
    const refresh = getRefreshToken();
    clearOutbox();
    clearVoiceNumbers();
    password.current = null;
    setState({ status: "signedOut" });
    const end = () => {
      if (getRefreshToken() === refresh) clearSoulTokens();
      if (refresh) soulApi.logout(refresh).catch((e: unknown) => keepPendingLogout(e, refresh));
    };
    if (hasRegisteredDevice()) void unregisterDevice().finally(end);
    else end();
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await soulApi.me();
    setState({ status: "signedIn", profile });
  }, []);

  const value = useMemo<Session>(
    () => ({
      state,
      signIn,
      deviceSignIn,
      heldPassword: () => password.current,
      dropPassword: () => void (password.current = null),
      verifyMfa,
      changePassword,
      signOut,
      refreshProfile,
      retryBoot,
    }),
    [state, signIn, deviceSignIn, verifyMfa, changePassword, signOut, refreshProfile, retryBoot]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
