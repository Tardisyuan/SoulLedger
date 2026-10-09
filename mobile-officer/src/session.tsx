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
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY, getRefreshToken, platform, setAccessToken, setRefreshToken } from "@soulledger/core/platform";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { hasRegisteredDevice, unregisterDevice } from "./push";
import { hallChoiceOf } from "./rules";
import { setUnauthorizedHandler } from "./shared";

export const USER_KEY = "officer_user";

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
    return user ? { status: "signedIn", user } : { status: "signedOut" };
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
      setState({ status: "signedOut" });
    });
    return () => setUnauthorizedHandler(() => {});
  }, []);

  // A stored session is asked about once: a refused refresh ends it (the handler above); a network
  // failure keeps the cached identity and lets each tab say what it could not load.
  useEffect(() => {
    if (state.status !== "signedIn") return;
    authApi.profile().then(
      ({ data: profile }) =>
        setState((prev) => {
          if (prev.status !== "signedIn") return prev;
          const user = { ...prev.user, mfa_enabled: profile.mfa_enabled, mfa_required: profile.mfa_required, display_name: profile.display_name, role: profile.role };
          platform().persistent.set(USER_KEY, JSON.stringify(user));
          return { status: "signedIn", user };
        }),
      () => {}
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per process
  }, []);

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

  const value = useMemo<Session>(() => ({ state, signIn, verifyMfa, signOut }), [state, signIn, verifyMfa, signOut]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession outside SessionProvider");
  return value;
}
