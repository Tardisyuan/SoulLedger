"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { dispatchApi, soulsApi, ledgerApi } from "@/lib/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { drfFieldErrors, drfNonFieldError } from "@soulledger/core/validations/drfErrors";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField, type SelectOption } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";

export default function ProposeDispatchPage() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  /**
   * Per-field errors. This form had three `required` controls and passed no
   * `error` to any of them, so every rejection — a blank reason, a
   * cross-tenant refusal, a DRF field error — arrived as the same generic
   * toast ("发起调度失败") with nothing saying which control the server
   * refused. `Field` has carried the whole apparatus (aria-invalid,
   * role="alert", describedby chaining) the entire time; nobody passed it
   * anything.
   */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState({
    soul_id: "",
    target_tenant_code: "",
    reason: "",
  });

  /**
   * SERVER-SIDE SEARCH, NOT ONE PAGE.
   *
   * This was `soulsApi.list({ page: 1 })` feeding a plain `<select>`, and DRF's
   * PAGE_SIZE is 20 — so a tenant's twenty-first soul could not be nominated
   * for a dispatch at all. There was no pagination, no search and no count, so
   * a truncated list looked exactly like a complete one. Same root cause as
   * `cfe9f99`, in the shape that scan missed because it only looked at tables.
   *
   * `search` goes to the server because the client is the one thing that does
   * NOT hold the whole collection; filtering here would narrow the twenty rows
   * it happens to have and present that as the answer.
   */
  const [soulSearchInput, setSoulSearchInput] = useState("");
  const [soulSearch, setSoulSearch] = useState("");

  // 300ms, the same debounce app/souls/page.tsx uses for its own search box.
  useEffect(() => {
    const timer = setTimeout(() => setSoulSearch(soulSearchInput), 300);
    return () => clearTimeout(timer);
  }, [soulSearchInput]);

  const { data: soulsResponse, isLoading: soulsLoading } = useQuery({
    // `soulSearch` is IN the key. Without it every query would read the first
    // search's cached page and the box would look broken rather than slow.
    queryKey: ["dispatch", "souls", soulSearch],
    queryFn: () => soulsApi.list({ page: 1, search: soulSearch || undefined }),
    enabled: !!user,
    // Keeps the previous page on screen while the next search resolves, so the
    // list does not blank between keystrokes.
    placeholderData: (previous) => previous,
  });

  // Paginated list — `results` is always present, so the old
  // `|| soulsResponse?.data` fallback was unreachable.
  const souls = soulsResponse?.data?.results ?? [];
  const soulCount = soulsResponse?.data?.count ?? souls.length;

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
  const soulOptions: SelectOption[] = souls.map((s) => ({
    value: String(s.id),
    label: `${s.name} (${resolveEnumDisplay(t, "souls.states", s.current_state).label ?? t("common.value.unrecorded")})`,
  }));

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

  /**
   * Server field name → the control that holds it. The form keys and the API
   * keys differ (`soul_id` vs `soul`, `target_tenant_code` vs `target_tenant`),
   * so a DRF error keyed by the API name has to be translated back or it lands
   * on nothing.
   */
  const FIELD_OF: Record<string, string> = {
    soul: "soul_id",
    target_tenant: "target_tenant_code",
    source_tenant: "target_tenant_code",
    reason: "reason",
  };

  /** Focus the first control the operator has to fix, so the fix is one key
   *  away rather than a scroll-and-hunt. */
  const focusFirstInvalid = (keys: string[]) => {
    const order = ["soul_id", "target_tenant_code", "reason"];
    const first = order.find((k) => keys.includes(k));
    if (!first) return;
    const el = formRef.current?.querySelector<HTMLElement>(`[name="${first}"], #${first}`);
    el?.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.tenant?.code) return;

    // Submit-time required check. `Field` turns `required` into
    // `aria-required` only — there is no native or client-side gate — so an
    // untouched select used to round-trip to the server just to be told.
    const missing: Record<string, string> = {};
    if (!form.soul_id) missing.soul_id = t("common.field_required");
    if (!form.target_tenant_code) missing.target_tenant_code = t("common.field_required");
    if (!form.reason.trim()) missing.reason = t("common.field_required");
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      focusFirstInvalid(Object.keys(missing));
      return;
    }
    setFieldErrors({});

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
      // Field-keyed rejections go under the controls; object-level ones stay a
      // toast, because the server did not name a control for them.
      const byField = drfFieldErrors(err);
      const mapped = Object.fromEntries(
        Object.entries(byField)
          .filter(([apiField]) => FIELD_OF[apiField])
          .map(([apiField, message]) => [FIELD_OF[apiField], message])
      );
      setFieldErrors(mapped);
      if (Object.keys(mapped).length > 0) {
        focusFirstInvalid(Object.keys(mapped));
      } else {
        showToast(drfNonFieldError(err, t("dispatch.propose_error")), "error");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageShell variant="prose" title={t("dispatch.propose")}>
      <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
        {/* While the list is in flight the control stays in place, disabled,
            holding a single "Loading…" option. The skeleton it replaces sat
            *beside* the label rather than under it, so the field's own label
            vanished for as long as the query took and the row changed height
            when it came back. */}
        <SearchSelectField
          id="soul_id"
          name="soul_id"
          label={t("dispatch.target_soul")}
          required
          error={fieldErrors.soul_id}
          value={form.soul_id}
          onValueChange={(next) => {
            setFieldErrors(({ soul_id: _drop, ...rest }) => rest);
            setForm({ ...form, soul_id: next });
          }}
          options={soulOptions}
          searchText={soulSearchInput}
          onSearchTextChange={setSoulSearchInput}
          loading={soulsLoading}
          placeholder={t("dispatch.soul_search_placeholder")}
          loadingText={t("common.loading")}
          emptyText={t("dispatch.soul_search_empty")}
          // Only when the server says it is holding more than it sent. Shown
          // unconditionally it would read as "there is more" on a list that is
          // already complete.
          moreText={
            soulCount > souls.length
              ? t("dispatch.soul_search_more", {
                  shown: String(souls.length),
                  count: String(soulCount),
                })
              : undefined
          }
        />

        <SelectField
          id="target_tenant_code"
          name="target_tenant_code"
          label={t("dispatch.target_tenant")}
          required
          disabled={tenantsLoading}
          error={fieldErrors.target_tenant_code}
          value={form.target_tenant_code}
          onChange={e => {
            setFieldErrors(({ target_tenant_code: _drop, ...rest }) => rest);
            setForm({ ...form, target_tenant_code: e.target.value });
          }}
          options={tenantsLoading ? [{ value: "", label: t("common.loading") }] : tenantOptions}
        />

        <TextAreaField
          id="reason"
          name="reason"
          label={t("dispatch.reason")}
          required
          error={fieldErrors.reason}
          value={form.reason}
          onChange={e => {
            setFieldErrors(({ reason: _drop, ...rest }) => rest);
            setForm({ ...form, reason: e.target.value });
          }}
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
