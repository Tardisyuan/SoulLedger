"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { dispatchApi, soulsApi, ledgerApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, type SelectOption } from "@/src/components/ui/Field";

export default function ProposeDispatchPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
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

  // Paginated list — `results` is always present, so the old
  // `|| soulsResponse?.data` fallback was unreachable.
  const souls = soulsResponse?.data?.results ?? [];

  const { data: statsData, isLoading: tenantsLoading } = useQuery({
    queryKey: ["dispatch", "tenants"],
    queryFn: () => ledgerApi.statsOverview(),
    enabled: !!user,
  });

  const tenants = statsData?.data?.tenants || [];

  /**
   * An `<option>` can hold no child element, so the soul's lifecycle state is
   * the one place on this page where the enum stays a bare string — the
   * exception `src/__tests__/domainDisplayContract.test.tsx` records for this
   * file. Moving from a hand-written `<select>` to `<SelectField>` does not
   * change that: the label is still a string, it is just assembled here rather
   * than between the option tags.
   */
  const soulOptions: SelectOption[] = [
    { value: "", label: t("dispatch.select_soul") },
    ...souls.map((s) => ({
      value: String(s.id),
      label: `${s.name} (${resolveEnumDisplay(t, "souls.states", s.current_state).label ?? t("common.value.unrecorded")})`,
    })),
  ];

  /**
   * `tn`, not `t`. The old spelling shadowed the i18n `t` inside both the
   * filter and the map — it happened to be harmless because neither callback
   * translated anything, but a single `t("…")` added inside one of them would
   * have called a tenant record.
   */
  const tenantOptions: SelectOption[] = [
    { value: "", label: t("dispatch.select_tenant") },
    ...tenants
      .filter((tn: { tenant_code: string }) => tn.tenant_code !== user?.tenant?.code)
      .map((tn: { tenant_code: string; tenant_name: string }) => ({
        value: tn.tenant_code,
        label: `${tn.tenant_name} (${tn.tenant_code})`,
      })),
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.tenant?.code) return;

    // Backend requires numeric source_tenant/target_tenant FK ids (tenant codes
    // are read-only output fields on this endpoint), so resolve them from the
    // tenant list we already fetched via ledgerApi.statsOverview().
    const sourceTenantCode = user.tenant.code;
    const sourceTenant = tenants.find((tn) => tn.tenant_code ===sourceTenantCode);
    const targetTenant = tenants.find((tn) => tn.tenant_code ===form.target_tenant_code);
    if (!sourceTenant || !targetTenant) {
      showToast(t("dispatch.propose_error"), "error");
      return;
    }

    setLoading(true);
    try {
      await dispatchApi.propose({
        source_tenant: sourceTenant.tenant_id,
        target_tenant: targetTenant.tenant_id,
        soul: form.soul_id,
        reason: form.reason,
      });
      router.push("/dispatch");
    } catch (err) {
      showToast(t("dispatch.propose_error"), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell variant="prose" title={t("dispatch.propose")}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* While the list is in flight the control stays in place, disabled,
            holding a single "Loading…" option. The skeleton it replaces sat
            *beside* the label rather than under it, so the field's own label
            vanished for as long as the query took and the row changed height
            when it came back. */}
        <SelectField
          label={t("dispatch.target_soul")}
          required
          disabled={soulsLoading}
          value={form.soul_id}
          onChange={e => setForm({ ...form, soul_id: e.target.value })}
          options={soulsLoading ? [{ value: "", label: t("common.loading") }] : soulOptions}
        />

        <SelectField
          label={t("dispatch.target_tenant")}
          required
          disabled={tenantsLoading}
          value={form.target_tenant_code}
          onChange={e => setForm({ ...form, target_tenant_code: e.target.value })}
          options={tenantsLoading ? [{ value: "", label: t("common.loading") }] : tenantOptions}
        />

        <TextAreaField
          label={t("dispatch.reason")}
          required
          value={form.reason}
          onChange={e => setForm({ ...form, reason: e.target.value })}
          rows={4}
          placeholder={t("dispatch.reason_placeholder")}
        />

        <div className="flex gap-3">
          <RequirePermission permissions="dispatch.manage">
            <Button type="submit" variant="primary" loading={loading}>
              {loading ? t("dispatch.submitting") : t("dispatch.submit_proposal")}
            </Button>
          </RequirePermission>
          <Button type="button" variant="secondary" onClick={() => router.back()}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    </PageShell>
  );
}
