"use client";

import {
  createContext,
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

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  email: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  tenant: TenantInfo | null;
  permissions: string[];
}

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
  useEffect(() => {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (raw) {
        setUserState(JSON.parse(raw) as AuthUser);
      }
    } catch {
      // ignore
    }
  }, []);

  const setUser = (u: AuthUser | null) => {
    setUserState(u);
    if (u) {
      localStorage.setItem(USER_KEY, JSON.stringify(u));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem(USER_KEY);
    document.cookie = `${USER_KEY}=; Max-Age=0; path=/`;
    document.cookie = `soulledger_access=; Max-Age=0; path=/`;
    document.cookie = `soulledger_refresh=; Max-Age=0; path=/`;
  };

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
