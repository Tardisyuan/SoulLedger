"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authApi } from "@/lib/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";

export default function LoginPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { setUser } = useTenant();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await authApi.login(form.username, form.password);

      const tokens = res.data;
      document.cookie = `soulledger_access=${tokens.access}; path=/; max-age=1800; SameSite=Lax`;
      document.cookie = `soulledger_refresh=${tokens.refresh}; path=/; max-age=604800; SameSite=Lax`;

      // Populate TenantContext so downstream components have tenant/user info
      if (tokens.user) {
        setUser(tokens.user);
        document.cookie = `soulledger_user=${encodeURIComponent(JSON.stringify(tokens.user))}; path=/; max-age=${60 * 30}; SameSite=Lax`;
      }

      showToast(t("auth.login_success"), "success");
      router.push("/souls");
    } catch (err: unknown) {
      const raw = (err as { response?: { data?: { detail?: string } } })
        ?.response?.data?.detail || "Login failed";

      // Map backend error messages to i18n keys
      const msgKey: Record<string, string> = {
        "No active account found with the given credentials": "auth.error_invalid_credentials",
        "Invalid token": "auth.error_invalid_token",
        "Token has expired": "auth.error_token_expired",
      };

      const i18nKey = msgKey[raw] ?? "auth.error_login_failed";
      showToast(t(i18nKey) || raw, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-zinc-900 to-zinc-950">
      <div className="w-full max-w-md px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">{t("nav.title")}</h1>
          <p className="text-zinc-400">{t("home.hero_subtitle")}</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 shadow-2xl"
        >
          <h2 className="text-xl font-semibold text-white mb-6 text-center">
            {t("auth.login") || "登录"}
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                {t("auth.username") || "用户名"}
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-600 transition-colors"
                placeholder="admin"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                {t("auth.password") || "密码"}
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-600 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-6 bg-amber-700 hover:bg-amber-600 disabled:bg-zinc-700 text-white font-medium py-2.5 rounded-lg transition-colors"
          >
            {loading ? (t("auth.logging_in") || "登录中...") : (t("auth.login") || "登录")}
          </button>
        </form>

        <p className="text-center text-zinc-500 text-sm mt-6">
          <Link href="/" className="text-amber-600 hover:text-amber-500">
            {t("nav.home")}
          </Link>
        </p>
      </div>
    </div>
  );
}
