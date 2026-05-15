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
    router.push("/");
  };

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-14 bg-canvas border-b border-hairline flex items-center px-4 gap-4">
        {/* Left: Logo + Brand */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          aria-label="SoulLedger Home"
        >
          <span className="text-xl">💀</span>
          <span className="text-[hsl(var(--color-accent))] font-bold text-sm tracking-wide group-hover:text-[hsl(var(--color-accent))] transition-colors">
            SoulLedger
          </span>
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right controls */}
        <div className="flex items-center gap-3">
          <LanguageSwitcher />

          <div className="w-px h-5 border-hairline" />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            title={
              theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
            }
            className="text-[hsl(var(--color-ink-subtle))] hover:text-[hsl(var(--color-accent))] transition-colors p-1 rounded"
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

          <div className="w-px h-5 border-hairline" />

          {user ? (
            <>
              {/* User greeting — clickable */}
              <button
                onClick={() => setShowUserModal(true)}
                className="text-[hsl(var(--color-ink-muted))] text-sm hover:text-[hsl(var(--color-accent))] transition-colors"
              >
                {t("nav.greeting", { username: user.username })}
              </button>

              <div className="w-px h-5 border-hairline" />

              {/* Logout */}
              <button
                onClick={handleLogout}
                className="text-ink-subtle hover:text-red-400 text-sm transition-colors"
              >
                {t("auth.logout")}
              </button>
            </>
          ) : (
            /* Login button — shown when not authenticated */
            <Link
              href="/login"
              className="bg-[hsl(var(--color-accent))] text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[hsl(var(--color-accent))] transition-colors"
            >
              {t("auth.login")}
            </Link>
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
