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
  onSoulPasswordChangeRequired,
  soulApi,
  soulErrorCode,
  soulErrorMessage,
  soulErrorStatus,
  storeSoulTokens,
  type MeProfile,
  type SoulErrorMessage,
} from "@soulledger/core/api/soul";
import { getRefreshToken } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { clearOutbox } from "./chat";
import { setUnauthorizedHandler } from "./platform";
import { hasRegisteredDevice, unregisterDevice } from "./push";

export type SessionState =
  | { status: "booting" }
  | { status: "unreachable"; error: SoulErrorMessage }
  | { status: "signedOut"; notice?: SoulErrorMessage }
  | { status: "mustChangePassword"; expiresAt: string | null }
  | { status: "signedIn"; profile: MeProfile };

export interface Session {
  state: SessionState;
  signIn: (soulCode: string, password: string) => Promise<void>;
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
  return { status: "signedOut", notice: soulErrorMessage(error) };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() =>
    getRefreshToken() ? { status: "booting" } : { status: "signedOut" }
  );

  /** Where every successful authentication lands: ask the server who we are. */
  const enter = useCallback(() => soulApi.me().then(signedIn, stateAfterFailedMe).then(setState), []);

  const retryBoot = useCallback(() => {
    setState({ status: "booting" });
    void enter();
  }, [enter]);

  useEffect(() => {
    // An expired session ends like a sign-out: the unsent letters leave the device too.
    setUnauthorizedHandler(() => {
      clearOutbox();
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
    if (getRefreshToken()) soulApi.me().then(signedIn, stateAfterFailedMe).then(setState);
  }, []);

  const signIn = useCallback(
    async (soulCode: string, password: string) => {
      const response = await soulApi.login(soulCode, password);
      storeSoulTokens(response);
      if (response.account.must_change_password) {
        setState({ status: "mustChangePassword", expiresAt: response.account.initial_password_expires_at ?? null });
        return;
      }
      await enter();
    },
    [enter]
  );

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      storeSoulTokens(await soulApi.changePassword(oldPassword, newPassword));
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
    setState({ status: "signedOut" });
    const end = () => {
      if (getRefreshToken() === refresh) clearSoulTokens();
      if (refresh) soulApi.logout(refresh).catch(() => {});
    };
    if (hasRegisteredDevice()) void unregisterDevice().finally(end);
    else end();
  }, []);

  const refreshProfile = useCallback(async () => {
    const profile = await soulApi.me();
    setState({ status: "signedIn", profile });
  }, []);

  const value = useMemo<Session>(
    () => ({ state, signIn, changePassword, signOut, refreshProfile, retryBoot }),
    [state, signIn, changePassword, signOut, refreshProfile, retryBoot]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
