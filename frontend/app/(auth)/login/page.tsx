"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";

export default function LoginPage() {
  const { t } = useI18n();
  const { showToast } = useToast();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/v1/auth/login/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        const msg = data.detail || "Login failed";
        setError(msg);
        showToast(msg, "error");
        return;
      }

      const tokens = await res.json();
      // Store tokens in cookie
      document.cookie = `soulledger_access=${tokens.access}; path=/; max-age=1800; SameSite=Lax`;
      document.cookie = `soulledger_refresh=${tokens.refresh}; path=/; max-age=604800; SameSite=Lax`;

      showToast("Login successful", "success");
      router.push("/souls");
    } catch {
      const msg = "Network error";
      setError(msg);
      showToast(msg, "error");
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
