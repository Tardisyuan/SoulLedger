"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTenant } from "@/src/contexts/TenantContext";
import { useTheme } from "@/src/contexts/ThemeContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/src/contexts/I18nContext";
import { authApi } from "@/lib/api";
import { UserModal } from "@/src/components/UserModal";

export function NavBar() {
  const { user, logout } = useTenant();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [showUserModal, setShowUserModal] = useState(false);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    }
    logout();
    router.push("/login");
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
        {/* Left: Logo + Brand */}
        <Link
          href="/souls"
          className="flex items-center gap-2 shrink-0 group"
        >
          <span className="text-xl">💀</span>
          <span className="text-amber-500 font-bold text-sm tracking-wide group-hover:text-amber-400 transition-colors">
            SoulLedger
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />

          <div className="w-px h-5 bg-zinc-700" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="text-zinc-400 hover:text-amber-500 transition-colors p-1 rounded"
          >
            {theme === "dark" ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

          {user && <div className="w-px h-5 bg-zinc-700" />}

          {/* User greeting — clickable */}
          {user && (
            <button
              onClick={() => setShowUserModal(true)}
              className="text-zinc-300 text-sm hover:text-amber-400 transition-colors"
            >
              {t("nav.greeting", { username: user.username })}
            </button>
          )}

          {user && <div className="w-px h-5 bg-zinc-700" />}

          {/* Logout */}
          {user && (
            <button
              onClick={handleLogout}
              className="text-zinc-400 hover:text-red-400 text-sm transition-colors"
            >
              {t("auth.logout")}
            </button>
          )}
        </div>
      </nav>

      <UserModal
        open={showUserModal}
        onClose={() => setShowUserModal(false)}
      />
    </>
  );
}
