"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { permApi } from "@soulledger/core/api";
import type { UserRole } from "@soulledger/core/api";
import {
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  platform,
} from "@soulledger/core/platform";

// ── Types ────────────────────────────────────────────────────────────

export interface TenantInfo {
  /**
   * Optional: the login response's `user.tenant` is built by
   * UserWithTenantSerializer.get_tenant (backend/apps/authentication/
   * serializers.py:53) and carries only `code` and `display_name`. Nothing
   * reads the id off an AuthUser; the /users/ payload, which does include it,
   * is a different type (lib/api/users.ts).
   */
  id?: number;
  code: string;
  display_name: string;
}

// Permissions stored separately in memory only (not localStorage) for security
export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  /**
   * The shared `UserRole`, not a fourth spelling of it.
   *
   * This line used to inline `"ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER"` — a
   * third copy of the role list in the frontend, and like the other two it was
   * missing MODERATOR. It was found by widening `UserRole` in
   * `@soulledger/core/api` to the five members the backend actually has: `tsc`
   * then refused `LoginUser` and the profile payload here, which is the copy
   * announcing itself.
   */
  role: UserRole;
  tenant: TenantInfo | null;
  permissions: string[];
}

// Safe subset persisted to localStorage (no permissions)
type CachedUser = Omit<AuthUser, "permissions"> & { permissions?: never };

interface CachedUserEnvelope {
  user: CachedUser;
  storedAt: number;
}

const USER_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface TenantContextValue {
  user: AuthUser | null;
  tenantCode: string | null;
  /**
   * The only role boolean left, and the only one that ever had a reader.
   *
   * `isJudge` / `isGuardian` / `isViewer` sat beside it from the start with
   * **zero** consumers anywhere in `app/`, `src/`, `components/`, `lib/` or
   * `e2e/` — measured over every git-tracked source file with comments
   * stripped first, because the comments in this repo name the symbols they
   * discuss and defeat a plain grep. The only mentions were in
   * `usePermissions.test.ts`, which builds its own context object and would
   * have kept passing if the provider had never set them.
   *
   * Three booleans nobody reads are not free: each one is a public promise
   * that `role` can be asked about here, which is the invitation that put a
   * second `role === "ADMIN"` in `src/hooks/usePermissions.ts`.
   *
   * `isAdmin` is gone from here too. Its one production reader,
   * `src/components/menus/MenuFormModal.tsx:55`, was asking an authorization
   * question, and `usePermissions` already answers it — `hasPermission`
   * short-circuits on the same rule, so that module has to know it regardless.
   * There is now exactly one derivation of "admin" in the app instead of two.
   * Do not add a role boolean back here: ask `usePermissions`.
   */
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const USER_KEY = "soulledger_user";

// ── Context ──────────────────────────────────────────────────────────

const TenantContext = createContext<TenantContextValue>({
  user: null,
  tenantCode: null,
  setUser: () => {},
  logout: () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const tenantCode = user?.tenant?.code ?? null;

  // Hydrate from localStorage on mount (client-only)
  // Permissions are NOT loaded from localStorage for security - they must be fetched from server
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) {
        const envelope = JSON.parse(raw) as CachedUserEnvelope;
        // Expire stale cache
        if (Date.now() - envelope.storedAt > USER_TTL_MS) {
          localStorage.removeItem(USER_KEY);
          return;
        }
        // Restore basic user info immediately so the UI isn't blocked on the
        // network, then refetch permissions from the server. We deliberately
        // do NOT cache permissions ourselves (in localStorage or otherwise)
        // and re-fetch on every rehydration instead: a cached list would go
        // stale the moment an admin changes this user's role in another tab,
        // and a stale "yes" is worse than a momentary "no". If the fetch
        // fails, permissions stay empty rather than guessed.
        setUserState({ ...envelope.user, permissions: [] });
        permApi
          .myRolePermissions()
          .then(({ data }) => {
            setUserState((prev) =>
              prev
                ? {
                    ...prev,
                    permissions: data?.permissions ?? [],
                    // The role comes back in the same response and used to be
                    // **dropped on the floor** — only `data.permissions` was
                    // read. `role` therefore stayed whatever the localStorage
                    // envelope said, and that envelope has a 24-hour TTL with
                    // nothing else correcting it.
                    //
                    // That matters more than a stale label, because
                    // `usePermissions.hasPermission` opens with
                    // `if (user?.role === "ADMIN") return true`. An ADMIN
                    // demoted to VIEWER kept sailing through **every**
                    // `<RequirePermission>` in the app for up to 24 hours,
                    // across reloads. The backend answers 403, so nothing is
                    // leaked — what the user gets is a screenful of 403s
                    // instead of a UI that simply does not offer the feature.
                    //
                    // `?? prev.role`: on the one hand a server that omits the
                    // field must not blank the role; on the other, when it
                    // does send one, the server's answer wins.
                    role: (data?.role as AuthUser["role"]) ?? prev.role,
                  }
                : prev
            );
          })
          .catch(() => {
            // Leave permissions empty — gates stay closed, not guessed open.
          });
      }
    } catch {
      // ignore
    }
  }, []);

  const setUser = useCallback((u: AuthUser | null) => {
    setUserState(u);
    if (u) {
      // Store only safe user fields to localStorage, NOT permissions
      const { permissions: _ignored, ...safeUser } = u;
      const envelope: CachedUserEnvelope = { user: safeUser, storedAt: Date.now() };
      localStorage.setItem(USER_KEY, JSON.stringify(envelope));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  }, []);

  /**
   * Through the platform ports, and each store by name.
   *
   * This used to clear `localStorage` and three cookies by hand — and the
   * access token is in none of those. It lives in the **session** store
   * (`sessionStorage` on web, see `lib/platform/web.ts`), which is exactly
   * where `api/client.ts`'s request interceptor reads it from. So "logout"
   * left the old Bearer on every request the next screen made, for the rest
   * of the token's 30 minutes, in the same tab (FL-02). The cookie it did
   * clear, `soulledger_access`, is the legacy 24-hour one that
   * `rotateRefreshToken` stopped writing — worth removing, but not the token.
   *
   * The same knowledge — which facility each token lives in — was held here
   * and in the login page as a second and third copy of what the adapter
   * knows (FL-10). Both now call the ports; `accessTokenNeverBecomesACookie`
   * pins that no code in the frontend trees spells the token names at all.
   */
  const logout = useCallback(() => {
    setUser(null);
    const host = platform();
    host.session.remove(ACCESS_TOKEN_KEY);
    // The legacy cookie copy and the `soulledger_user` cookie from before the
    // cache moved to localStorage. `persistent.remove` clears both facilities.
    host.persistent.remove(ACCESS_TOKEN_KEY);
    host.persistent.remove(USER_KEY);
    host.secure.remove(REFRESH_TOKEN_KEY);
  }, [setUser]);

  const value = useMemo(
    () => ({
      user,
      tenantCode,
      setUser,
      logout,
    }),
    // `tenantCode` is derived from `user` and cannot move without it; it is
    // listed because it is read here, not because it adds a trigger.
    [user, tenantCode, setUser, logout]
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export const useTenant = () => useContext(TenantContext);
