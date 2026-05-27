"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from "react";

// ── Types ────────────────────────────────────────────────────────────

export interface TenantInfo {
  id: number;
  code: string;
  display_name: string;
}

// Permissions stored separately in memory only (not localStorage) for security
export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
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
        // Restore basic user info, but permissions must be refetched from server
        setUserState({ ...envelope.user, permissions: [] });
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
        tenantCode: user?.tenant?.code ?? null,
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
