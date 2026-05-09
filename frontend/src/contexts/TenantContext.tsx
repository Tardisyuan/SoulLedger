"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

// ── Types ────────────────────────────────────────────────────────────

export interface TenantInfo {
  code: string;
  display_name: string;
}

export interface AuthUser {
  id: number;
  username: string;
  email: string;
  role: "ADMIN" | "JUDGE" | "GUARDIAN" | "VIEWER";
  tenant: TenantInfo | null;
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

const USER_COOKIE = "soulledger_user";
const ACCESS_COOKIE = "soulledger_access";

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

  // Hydrate from cookie on mount
  useEffect(() => {
    try {
      const match = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${USER_COOKIE}=`));
      const raw = match?.split("=").slice(1).join("=");
      if (raw) {
        const parsed = JSON.parse(decodeURIComponent(raw)) as AuthUser;
        setUserState(parsed);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const setUser = (u: AuthUser | null) => {
    setUserState(u);
    if (u) {
      document.cookie = `${USER_COOKIE}=${encodeURIComponent(JSON.stringify(u))}; path=/; max-age=${60 * 30}; SameSite=Lax`;
    } else {
      document.cookie = `${USER_COOKIE}=; Max-Age=0; path=/`;
    }
  };

  const logout = () => {
    setUser(null);
    document.cookie = `${USER_COOKIE}=; Max-Age=0; path=/`;
    document.cookie = `${ACCESS_COOKIE}=; Max-Age=0; path=/`;
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
