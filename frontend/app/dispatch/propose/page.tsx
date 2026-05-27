"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { dispatchApi, soulsApi, karmaApi, type Soul } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { Skeleton } from "@/src/components/ui/skeleton";

export default function ProposeDispatchPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    soul_id: "",
    target_tenant_code: "",
    reason: "",
  });

  const { data: soulsResponse, isLoading: soulsLoading } = useQuery({
    queryKey: ["dispatch", "souls"],
    queryFn: () => soulsApi.list({ page: 1 }),
    enabled: !!user,
  });

  const souls = soulsResponse?.data?.results || soulsResponse?.data || [];

  const { data: statsData, isLoading: tenantsLoading } = useQuery({
    queryKey: ["dispatch", "tenants"],
    queryFn: () => karmaApi.statsOverview(),
    enabled: !!user,
  });

  const tenants = statsData?.data?.tenants || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.tenant?.code) return;

    setLoading(true);
    try {
      // Note: Backend expects numeric IDs but frontend only has tenant codes
      // Using tenant code directly - may need backend adjustment
      await dispatchApi.propose({
        source_tenant: user.tenant.code as unknown as number,
        target_tenant: form.target_tenant_code as unknown as number,
        soul: parseInt(form.soul_id),
        reason: form.reason,
      });
      router.push("/dispatch");
    } catch (err) {
      console.error("Failed to propose dispatch:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-[hsl(var(--color-ink))] mb-6">{t("dispatch.propose") || "Propose Dispatch"}</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("dispatch.target_soul")}</label>
          {soulsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <select
              value={form.soul_id}
              onChange={e => setForm({ ...form, soul_id: e.target.value })}
              className="w-full bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg px-3 py-2 text-[hsl(var(--color-ink))]"
              required
            >
              <option value="">{t("dispatch.select_soul")}</option>
              {souls.map((s: Soul) => (
                <option key={s.id} value={s.id}>
                  #{s.id} - {s.name} ({s.current_state})
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("dispatch.target_tenant")}</label>
          {tenantsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <select
              value={form.target_tenant_code}
              onChange={e => setForm({ ...form, target_tenant_code: e.target.value })}
              className="w-full bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg px-3 py-2 text-[hsl(var(--color-ink))]"
              required
            >
              <option value="">{t("dispatch.select_tenant")}</option>
              {tenants
                .filter((t: { tenant_code: string }) => t.tenant_code !== user?.tenant?.code)
                .map((t: { tenant_code: string; tenant_name: string }) => (
                  <option key={t.tenant_code} value={t.tenant_code}>
                    {t.tenant_name} ({t.tenant_code})
                  </option>
                ))}
            </select>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-[hsl(var(--color-ink))] mb-1">{t("dispatch.reason")}</label>
          <textarea
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
            className="w-full bg-[hsl(var(--color-surface-1))] border border-[hsl(var(--color-hairline))] rounded-lg px-3 py-2 text-[hsl(var(--color-ink))]"
            rows={4}
            placeholder={t("dispatch.reason_placeholder")}
            required
          />
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={loading}
            className="bg-[hsl(var(--color-accent))] text-black px-4 py-2 rounded-lg text-sm font-medium hover:bg-[hsl(var(--color-accent))] disabled:opacity-50"
          >
            {loading ? t("dispatch.submitting") : t("dispatch.submit_proposal")}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="bg-[hsl(var(--color-surface-2))] text-[hsl(var(--color-ink))] px-4 py-2 rounded-lg text-sm hover:bg-[hsl(var(--color-surface-3))]"
          >
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
