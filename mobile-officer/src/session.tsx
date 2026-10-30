/**
 * The officer's session, as a state the shell renders from.
 *
 * Login is username + password with NO hall: the server infers the hall from the account, and
 * answers 409 `hall_required` (+ the halls) only when the same password fits officers in more
 * than one -- then `signIn` is called again with that `tenantCode`. An account with two-step
 * verification answers 200 `{mfa_required, pending_token}` instead of tokens; `verifyMfa`
 * finishes it. An officer whose ROLE must use two-step verification but has not set it up is let
 * in (the same rule as the web) and `needsMfaSetup` keeps the banner on screen.
 *
 * The profile (name, role, hall, civilization -- nothing secret) is kept in the persistent store
 * so a restart can draw the identity band before the network answers; the tokens are the
 * platform's: access in memory, refresh in the secure store.
 */
import { authApi, isMfaRequired, mfaApi, type LoginResponse, type LoginUser } from "@soulledger/core/api/auth";
import { onMfaSetupRequired, onPasswordChangeRequired } from "@soulledger/core/api/client";
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, getRefreshToken, platform, setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { clearDrafts } from "./drafts";
import { clearOutbox } from "./outbox";
import { USER_KEY } from "./owner";
import { clearReadCache } from "./readCache";
import { hasRegisteredDevice, unregisterDevice } from "./push";
import { hallChoiceOf } from "./rules";
import { clearVoiceNumbers, onForeground, setUnauthorizedHandler } from "./shared";

export { USER_KEY };

export type SessionState =
  | { status: "booting" }
  | { status: "signedOut" }
  | { status: "signedIn"; user: LoginUser };

export interface Hall {
  code: string;
  display_name: string;
}

/** What `signIn` found out. `done` means the state is already signed in. */
export type SignInResult =
  | { kind: "done" }
  | { kind: "hall"; halls: Hall[] }
  | { kind: "mfa"; pendingToken: string };

export interface Session {
  state: SessionState;
  signIn: (username: string, password: string, tenantCode?: string) => Promise<SignInResult>;
  verifyMfa: (input: { pendingToken: string; code?: string; recoveryCode?: string; remember?: boolean }) => Promise<void>;
  signOut: () => void;
  /** Two-step verification was turned on or off here: keep the cached profile (and so the banner) in step. */
  setMfaEnabled: (enabled: boolean) => void;
  /** The password must be changed before anything else (first sign-in, an administrator's reset, aged out), or has just been. */
  setPasswordChangeRequired: (required: boolean) => void;
  /** The officer renamed themself (「我的 › 姓名」): keep the cached profile in step. */
  setDisplayName: (name: string) => void;
}

export const SessionContext = createContext<Session | null>(null);

function readStoredUser(): LoginUser | null {
  try {
    const raw = platform().persistent.get(USER_KEY);
    const user = raw ? (JSON.parse(raw) as LoginUser) : null;
    return user && typeof user.username === "string" ? user : null;
  } catch {
    return null;
  }
}

/** Two-step verification is mandatory for this role and not yet on: the standing banner. */
export function needsMfaSetup(user: Pick<LoginUser, "mfa_required" | "mfa_enabled">): boolean {
  return !!user.mfa_required && !user.mfa_enabled;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(() => {
    const user = getRefreshToken() ? readStoredUser() : null;
    if (user) return { status: "signedIn", user };
    // No session to resume (the refresh token is gone or unreadable): nothing of whoever was here may stay
    // for the next officer -- the same clearing as a sign-out (RBAC review A7). Idempotent, so a second
    // initializer run (StrictMode) is harmless.
    platform().persistent.remove(USER_KEY);
    clearVoiceNumbers();
    clearDrafts();
    clearOutbox();
    clearReadCache();
    return { status: "signedOut" };
  });

  const land = useCallback((response: LoginResponse) => {
    setAccessToken(response.access);
    setRefreshToken(response.refresh);
    platform().persistent.set(USER_KEY, JSON.stringify(response.user));
    setState({ status: "signedIn", user: response.user });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      platform().persistent.remove(USER_KEY);
      clearVoiceNumbers();
      clearDrafts();
      clearOutbox();
      clearReadCache();
      setState({ status: "signedOut" });
    });
    return () => setUnauthorizedHandler(() => {});
  }, []);

  // The profile is asked about at start and again whenever the app comes back to the foreground: role,
  // two-step state and the permission list can all change while the app sleeps (an administrator's
  // grant), and the button gates read `user.permissions` (RBAC review M1). A refused refresh ends the
  // session (the handler above); a network failure keeps the cached identity and lets each tab say
  // what it could not load.
  const refreshProfile = useCallback(() => {
    authApi.profile().then(
      ({ data: profile }) =>
        setState((prev) => {
          if (prev.status !== "signedIn") return prev;
          const user = {
            ...prev.user,
            mfa_enabled: profile.mfa_enabled,
            mfa_required: profile.mfa_required,
            display_name: profile.display_name,
            role: profile.role,
            password_change_required: profile.password_change_required ?? prev.user.password_change_required,
            mfa_setup_required: profile.mfa_setup_required ?? prev.user.mfa_setup_required,
            permissions: Array.isArray(profile.permissions) ? profile.permissions : prev.user.permissions,
          };
          // Nothing changed: the same state object, so the shell and its tabs do not redraw (opt-apps2 R1).
          const stored = JSON.stringify(user);
          if (stored === JSON.stringify(prev.user)) return prev;
          platform().persistent.set(USER_KEY, stored);
          return { status: "signedIn", user };
        }),
      () => {}
    );
  }, []);

  useEffect(() => {
    if (state.status === "signedIn") refreshProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a stored session, once per process
  }, []);

  const signedIn = state.status === "signedIn";
  useEffect(() => {
    if (!signedIn) return;
    return onForeground(refreshProfile);
  }, [signedIn, refreshProfile]);

  const signIn = useCallback(
    async (username: string, password: string, tenantCode?: string): Promise<SignInResult> => {
      try {
        const { data } = await authApi.officerLogin({ username, password, ...(tenantCode ? { tenant_code: tenantCode } : {}) });
        if (isMfaRequired(data)) return { kind: "mfa", pendingToken: data.pending_token };
        land(data);
        return { kind: "done" };
      } catch (error) {
        const choice = hallChoiceOf(error);
        if (choice && !tenantCode) return { kind: "hall", halls: choice.halls };
        throw error;
      }
    },
    [land]
  );

  const verifyMfa = useCallback(
    async ({ pendingToken, code, recoveryCode, remember }: { pendingToken: string; code?: string; recoveryCode?: string; remember?: boolean }) => {
      const { data } = await mfaApi.verify({
        pending_token: pendingToken,
        ...(code ? { code } : {}),
        ...(recoveryCode ? { recovery_code: recoveryCode } : {}),
        ...(remember ? { remember_device: true } : {}),
      });
      land(data);
    },
    [land]
  );

  /**
   * The push token is unregistered FIRST (that endpoint is authenticated), then the refresh token is
   * revoked server-side; the screen returns to login at once.
   */
  const signOut = useCallback(() => {
    const refresh = getRefreshToken();
    setState({ status: "signedOut" });
    platform().persistent.remove(USER_KEY);
    clearVoiceNumbers();
    clearDrafts();
    clearOutbox();
    clearReadCache();
    // `authApi.logout` reads the stored refresh token, so the tokens go only after it has been sent
    // -- and only if no quick sign-in in between has replaced them.
    const end = () => {
      const clear = () => {
        if (getRefreshToken() === refresh) {
          platform().session.remove(ACCESS_TOKEN_KEY);
          platform().secure.remove(REFRESH_TOKEN_KEY);
        }
      };
      if (refresh) void authApi.logout().catch(() => {}).finally(clear);
      else clear();
    };
    if (hasRegisteredDevice()) void unregisterDevice().finally(end);
    else end();
  }, []);

  const setMfaEnabled = useCallback((enabled: boolean) => {
    setState((prev) => {
      if (prev.status !== "signedIn") return prev;
      // Turning it on lifts the server's hold (`mfa_setup_required`); turning it off does not set it — the next 403 does.
      const user = { ...prev.user, mfa_enabled: enabled, mfa_setup_required: enabled ? false : prev.user.mfa_setup_required };
      platform().persistent.set(USER_KEY, JSON.stringify(user));
      return { status: "signedIn", user };
    });
  }, []);

  const setPasswordChangeRequired = useCallback((required: boolean) => {
    setState((prev) => {
      if (prev.status !== "signedIn" || !!prev.user.password_change_required === required) return prev;
      const user = { ...prev.user, password_change_required: required };
      platform().persistent.set(USER_KEY, JSON.stringify(user));
      return { status: "signedIn", user };
    });
  }, []);

  const setDisplayName = useCallback((name: string) => {
    setState((prev) => {
      if (prev.status !== "signedIn") return prev;
      const user = { ...prev.user, display_name: name };
      platform().persistent.set(USER_KEY, JSON.stringify(user));
      return { status: "signedIn", user };
    });
  }, []);

  // A 403 `password_change_required` from any request (the password aged out while the app was open).
  useEffect(() => {
    onPasswordChangeRequired(() => setPasswordChangeRequired(true));
    return () => onPasswordChangeRequired(null);
  }, [setPasswordChangeRequired]);

  // A 403 `mfa_setup_required`: the role requires two-step verification and it is off (e.g. a hall setting changed
  // while the app was open). The shell then shows only the setup screen.
  useEffect(() => {
    onMfaSetupRequired(() =>
      setState((prev) => {
        if (prev.status !== "signedIn" || prev.user.mfa_setup_required) return prev;
        const user = { ...prev.user, mfa_setup_required: true };
        platform().persistent.set(USER_KEY, JSON.stringify(user));
        return { status: "signedIn", user };
      })
    );
    return () => onMfaSetupRequired(null);
  }, []);

  const value = useMemo<Session>(
    () => ({ state, signIn, verifyMfa, signOut, setMfaEnabled, setPasswordChangeRequired, setDisplayName }),
    [state, signIn, verifyMfa, signOut, setMfaEnabled, setPasswordChangeRequired, setDisplayName]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}

/** Whether the signed-in officer holds `code` (the server re-checks; this only hides what would be a 403). */
export function useCan(code: string): boolean {
  const { state } = useSession();
  return state.status === "signedIn" && !!state.user.permissions?.includes(code);
}
