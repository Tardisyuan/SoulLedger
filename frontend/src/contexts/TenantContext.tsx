"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { permApi } from "@soulledger/core/api";
import type { UserRole } from "@soulledger/core/api";
import { CIVILIZATION_SHORT_CODE_SET } from "@soulledger/core/config/civilizations";

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
  isAdmin: boolean;
  isJudge: boolean;
  isGuardian: boolean;
  isViewer: boolean;
  setUser: (user: AuthUser | null) => void;
  logout: () => void;
}

// ── Constants ────────────────────────────────────────────────────────

const USER_KEY = "soulledger_user";

// ── Context ──────────────────────────────────────────────────────────

const TenantContext = createContext<TenantContextValue>({
  user: null,
  tenantCode: null,
  isAdmin: false,
  isJudge: false,
  isGuardian: false,
  isViewer: false,
  setUser: () => {},
  logout: () => {},
});

export function TenantProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const tenantCode = user?.tenant?.code ?? null;

  // Surface-first civilization identity (globals.css §4.9 / Stage 5 §2):
  // stamp [data-civ] on <html> so the [data-civ="cn"|"eu"|"eg"|"gr"] rules
  // there can point --civ-hue at this tenant's hue and retint surface-1..4.
  // Tenant codes are CN_DIYU / EU_HEAVEN_HELL / EG_DUAT / GR_HADES (backend
  // TENANT_CIVILIZATION, apps/souls/models.py) — the prefix before the first
  // underscore is exactly the [data-civ] suffix. An unmapped or absent
  // tenant clears the attribute, which leaves --civ-hue at its neutral
  // :root/.light fallback rather than guessing a civilization.
  //
  // `gr` was missing from this list until Stage 9, and THIS omission — not
  // any missing token — is why every Greek screen rendered on the neutral
  // 240° fallback: the attribute was deleted, so no [data-civ] rule matched
  // and --civ-hue never left :root. Adding a fifth civilization means adding
  // it here as well as in globals.css; a whitelist that silently falls
  // through to `delete` cannot report its own gap, so
  // src/__tests__/TenantContext.test.tsx asserts one stamped attribute per
  // member of CIVILIZATION_CODES.
  //
  // The allowlist used to be the literal or-chain `civ === "cn" || civ ===
  // "eu" || …`, which is the shape that was missing `gr`. It now tests
  // membership of CIVILIZATION_SHORT_CODE_SET, derived in config/civilizations
  // from the same CIVILIZATION_CODES map a fifth civilization has to be added
  // to anyway — so the gap this comment describes can no longer be opened by
  // forgetting a clause here. Adding the [data-civ] rule to globals.css is
  // still a hand edit, and still the thing the colour contract test holds.
  useEffect(() => {
    const civ = tenantCode?.split("_")[0]?.toLowerCase();
    if (civ && CIVILIZATION_SHORT_CODE_SET.has(civ)) {
      document.documentElement.dataset.civ = civ;
    } else {
      delete document.documentElement.dataset.civ;
    }
  }, [tenantCode]);

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

  const logout = useCallback(() => {
    setUser(null);
    localStorage.removeItem(USER_KEY);
    document.cookie = `${USER_KEY}=; Max-Age=0; path=/`;
    document.cookie = `soulledger_access=; Max-Age=0; path=/`;
    document.cookie = `soulledger_refresh=; Max-Age=0; path=/`;
  }, [setUser]);

  return (
    <TenantContext.Provider
      value={{
        user,
        tenantCode,
        isAdmin: user?.role === "ADMIN",
        isJudge: user?.role === "JUDGE",
        isGuardian: user?.role === "GUARDIAN",
        isViewer: user?.role === "VIEWER",
        setUser,
        logout,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}

export const useTenant = () => useContext(TenantContext);
