"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/src/contexts/I18nContext";
import { authApi, User } from "@/lib/api";

export function NavBar() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const token = document.cookie.includes("soulledger_access");
    if (token) {
      authApi.profile()
        .then((res) => setUser(res.data))
        .catch(() => {
          // Not logged in
          setUser(null);
        });
    }
  }, []);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors
    }
    document.cookie = "soulledger_access=; Max-Age=0; path=/";
    document.cookie = "soulledger_refresh=; Max-Age=0; path=/";
    setUser(null);
    router.push("/login");
  };

  return (
    <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          {/* Logo */}
          <Link href={user ? "/souls" : "/"} className="text-amber-500 font-bold text-lg hover:text-amber-400">
            {t("nav.title")}
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-6">
            {user && (
              <>
                <Link href="/souls" className="text-zinc-300 hover:text-white text-sm">
                  {t("nav.souls")}
                </Link>
                <Link href="/realms" className="text-zinc-300 hover:text-white text-sm">
                  {t("nav.realms")}
                </Link>
                <Link href="/actors" className="text-zinc-300 hover:text-white text-sm">
                  {t("nav.actors")}
                </Link>
              </>
            )}

            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-zinc-500">
                  {user.username} <span className="text-amber-600">({user.role})</span>
                </span>
                <button
                  onClick={handleLogout}
                  className="text-xs text-zinc-400 hover:text-red-400 border border-zinc-700 rounded px-2 py-1 transition-colors"
                >
                  {t("auth.logout") || "登出"}
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="text-sm bg-amber-700 hover:bg-amber-600 text-white rounded px-3 py-1.5 transition-colors"
              >
                {t("auth.login") || "登录"}
              </Link>
            )}
          </div>

          {/* Mobile toggle */}
          <button
            className="md:hidden text-zinc-400"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden py-3 space-y-2 border-t border-zinc-800">
            {user && (
              <>
                <Link href="/souls" className="block text-zinc-300 hover:text-white text-sm py-1">
                  {t("nav.souls")}
                </Link>
                <Link href="/realms" className="block text-zinc-300 hover:text-white text-sm py-1">
                  {t("nav.realms")}
                </Link>
                <Link href="/actors" className="block text-zinc-300 hover:text-white text-sm py-1">
                  {t("nav.actors")}
                </Link>
                <button
                  onClick={handleLogout}
                  className="block text-zinc-400 hover:text-red-400 text-sm py-1"
                >
                  {t("auth.logout") || "登出"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
