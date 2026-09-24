"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { dispatchApi, soulsApi, ledgerApi } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { drfFieldErrors, drfNonFieldError } from "@soulledger/core/validations/drfErrors";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { PageShell } from "@/src/components/ui/PageShell";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, type SelectOption } from "@/src/components/ui/Field";
import { SearchSelectField } from "@/src/components/ui/SearchSelectField";
import { focusFirstInvalid } from "@/src/lib/submitErrorFocus";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { useSoul } from "@soulledger/core/hooks/useSouls";
import { getCivilizationFromTenantCode } from "@soulledger/core/config/civilizations";
import { NUMBERING_SAMPLE } from "@/src/lib/civilizationIdentity";
import { cn } from "@/lib/utils";

// `useSearchParams` needs a Suspense boundary under the App Router build.
export default function ProposeDispatchPage() {
  return (
    <Suspense fallback={null}>
      <ProposeDispatchForm />
    </Suspense>
  );
}

function ProposeDispatchForm() {
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
  /**
   * 规范 v1「发起移交」: the soul is carried in from its detail page and is not
   * editable there (`?soul=<id>`). Without the parameter the search field below
   * is the way in, as before. If the carried soul cannot be loaded the form
   * says so and falls back to the search field rather than proposing blind.
   */
  const carriedSoulId = useSearchParams().get("soul") ?? "";
  const carried = useSoul(carriedSoulId);
  const carriedSoul = carriedSoulId && !carried.isError ? carried.data : undefined;
  const [discardOpen, setDiscardOpen] = useState(false);
  // Everything downstream reads this, never `form.soul_id` directly.
  const soulId = carriedSoul ? carriedSoulId : "";
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

  // `isError` on BOTH feeders below, and neither had it. This page renders
  // neither an empty-state component nor a data grid, so neither rule in
  // `src/__tests__/errorIsNotAnEmptyState.test.ts` ever looked at it — the
  // failure was invisible to the guard written for exactly this shape.
  //
  // (Those two component names are deliberately NOT spelled with their angle
  // brackets here. That guard matches source TEXT, so writing the tag in prose
  // puts this file into the subject list it is describing itself as absent
  // from — which is what the first draft of this comment did, and both rules
  // duly failed on a page that renders neither component. Same shape as the
  // Tailwind-scans-prose note in this repo.)
  //
  // What it looked like: a failed soul search rendered `SearchSelectField`'s
  // `emptyText` ("no matches"), and a failed tenants call rendered a
  // `SelectField` holding only its placeholder. Both said "there is nothing to
  // pick" for "the request failed", on the page where the consequence is a
  // dispatch that cannot be proposed and no way to tell why.
  const { data: soulsResponse, isLoading: soulsLoading, isPlaceholderData: soulsStale, isError: soulsError } = useQuery({
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

  const { data: statsData, isLoading: tenantsLoading, isError: tenantsError } = useQuery({
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
   * The civilizations as a radio list (规范 v1「目标文明」): every tenant, the
   * source one included but disabled and marked 「来源」, so the reader sees the
   * whole set rather than "all but one". Each row carries its civilization's
   * numbering sample — identity by numbering law, not by colour (§1.8).
   */
  const sourceCode = user?.tenant?.code;
  const tenantName = (tn: { tenant_code: string; tenant_name: string }) => tn.tenant_name || tn.tenant_code;
  const sourceTenantRow = tenants.find((tn) => tn.tenant_code === sourceCode);
  const targetTenantRow = tenants.find((tn) => tn.tenant_code === form.target_tenant_code);
  const dirty = Boolean(form.reason.trim() || form.target_tenant_code || (!soulId && form.soul_id));

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

  /**
   * Focus the first control the operator has to fix, so the fix is one key
   * away rather than a scroll-and-hunt.
   *
   * Now the shared one. This used to carry
   * `order = ["soul_id", "target_tenant_code", "reason"]` — a hand-written
   * list that had to stay in step with the form's structure, with nothing to
   * report it if they drifted. `src/lib/submitErrorFocus.ts` asks the document
   * instead (`[aria-invalid="true"]`, first in DOM order), which is the same
   * answer for this form and is also the answer for every other form that
   * renders through `Field`.
   */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.tenant?.code) return;

    // Submit-time required check. `Field` turns `required` into
    // `aria-required` only — there is no native or client-side gate — so an
    // untouched select used to round-trip to the server just to be told.
    const missing: Record<string, string> = {};
    if (!(soulId || form.soul_id)) missing.soul_id = t("common.field_required");
    if (!form.target_tenant_code) missing.target_tenant_code = t("common.field_required");
    if (!form.reason.trim()) missing.reason = t("common.field_required");
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      // The attributes have to be in the document first, so this runs after
      // the render `setFieldErrors` schedules — hence a microtask, not a call.
      queueMicrotask(() => focusFirstInvalid(formRef.current));
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
        soul: soulId || form.soul_id,
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
        queueMicrotask(() => focusFirstInvalid(formRef.current));
      } else {
        showToast(drfNonFieldError(err, t("dispatch.propose_error")), "error");
      }
    } finally {
      setLoading(false);
    }
  };

  const tenantError =
    fieldErrors.target_tenant_code ?? (tenantsError ? t("dispatch.tenants_error") : undefined);

  return (
    <PageShell variant="page" title={t("dispatch.propose")} subtitle={t("dispatch.propose_subtitle")}>
      <div className="grid gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
      <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
        {carriedSoul ? (
          // Read-only, in the disabled pair (规范 v1 输入框「只读同此」).
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-[oklch(var(--color-ink))]">{t("dispatch.target_soul")}</span>
            <div
              aria-readonly="true"
              className="flex min-h-8 items-center gap-3 border border-[oklch(var(--color-line))] bg-[oklch(var(--color-disabled-surface))] px-3 text-sm text-[oklch(var(--color-ink-muted))]"
            >
              {carriedSoul.name}
              <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]" title={carriedSoul.id}>
                {carriedSoul.id.slice(0, 8)}
              </span>
            </div>
            <span className="text-xs text-[oklch(var(--color-ink-tertiary))]">{t("dispatch.soul_from_detail")}</span>
          </div>
        ) : (
        /* While the list is in flight the control stays in place, disabled,
            holding a single "Loading…" option. The skeleton it replaces sat
            *beside* the label rather than under it, so the field's own label
            vanished for as long as the query took and the row changed height
            when it came back. */
        <SearchSelectField
          id="soul_id"
          name="soul_id"
          label={t("dispatch.target_soul")}
          required
          // A field-level error, so it goes through `Field`'s existing
          // `aria-invalid` + `aria-describedby` + `role="alert"` wiring rather
          // than being a second, quieter way of saying something went wrong.
          // A server-side validation error on this field still wins: that one
          // is about what the operator typed, this one about whether the list
          // is trustworthy at all.
          error={
            fieldErrors.soul_id ??
            (soulsError
              ? t("dispatch.soul_search_error")
              : carriedSoulId && carried.isError
                ? t("dispatch.soul_from_detail_error")
                : undefined)
          }
          value={form.soul_id}
          onValueChange={(next) => {
            setFieldErrors(({ soul_id: _drop, ...rest }) => rest);
            setForm({ ...form, soul_id: next });
          }}
          options={soulOptions}
          searchText={soulSearchInput}
          onSearchTextChange={setSoulSearchInput}
          loading={soulsLoading || (Boolean(carriedSoulId) && carried.isLoading)}
          searching={soulsStale}
          placeholder={t("dispatch.soul_search_placeholder")}
          loadingText={t("common.loading")}
          // The dropdown's own copy has to change too. Leaving "no matches"
          // under an error message would be the page saying both things at
          // once, and "no matches" is the one that reads as settled.
          emptyText={soulsError ? t("dispatch.soul_search_error") : t("dispatch.soul_search_empty")}
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
        )}

        <fieldset
          aria-describedby={tenantError ? "target_tenant_code-error" : undefined}
          aria-busy={tenantsLoading || undefined}
          className="flex flex-col gap-1.5"
        >
          <legend className="mb-1.5 text-xs font-medium text-[oklch(var(--color-ink))]">
            {t("dispatch.target_tenant")}
            <span aria-hidden="true" className="ml-1 text-[oklch(var(--color-status-error))]">*</span>
          </legend>
          <div className="flex flex-col border-t border-[oklch(var(--color-block))]">
            {tenants.map((tn) => {
              const isSource = tn.tenant_code === sourceCode;
              const checked = form.target_tenant_code === tn.tenant_code;
              return (
                <label
                  key={tn.tenant_code}
                  className={cn(
                    "flex min-h-8 max-sm:min-h-11 items-center gap-3 border-b border-[oklch(var(--color-rule))] px-2 text-sm",
                    isSource
                      ? "cursor-not-allowed text-[oklch(var(--color-disabled-ink))]"
                      : "cursor-pointer text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]",
                    checked && "bg-[oklch(var(--color-surface-2))]"
                  )}
                >
                  <input
                    type="radio"
                    name="target_tenant_code"
                    value={tn.tenant_code}
                    checked={checked}
                    disabled={isSource}
                    // Not on the disabled source row: focusFirstInvalid takes the
                    // first `[aria-invalid]` in DOM order, and a disabled radio
                    // cannot take focus.
                    aria-invalid={tenantError && !isSource ? true : undefined}
                    onChange={() => {
                      setFieldErrors(({ target_tenant_code: _drop, ...rest }) => rest);
                      setForm({ ...form, target_tenant_code: tn.tenant_code });
                    }}
                    // Square box, square 6 px accent mark when chosen (规范 v1: 方角).
                    className="size-3.5 shrink-0 appearance-none border border-[oklch(var(--color-line))] checked:border-[oklch(var(--color-block))] checked:bg-[oklch(var(--color-accent))] checked:shadow-[inset_0_0_0_3px_oklch(var(--color-canvas))] disabled:border-[oklch(var(--color-disabled-ink))]"
                  />
                  {tenantName(tn)}
                  <span className={cn("ml-auto", isSource ? "text-xs" : "font-mono text-xs text-[oklch(var(--color-ink-subtle))]")}>
                    {isSource ? t("dispatch.source_label") : NUMBERING_SAMPLE[getCivilizationFromTenantCode(tn.tenant_code)] ?? ""}
                  </span>
                </label>
              );
            })}
            {tenantsLoading && (
              <span className="flex min-h-8 items-center px-2 text-sm text-[oklch(var(--color-ink-subtle))]">{t("common.loading")}</span>
            )}
          </div>
          {tenantError ? (
            <span id="target_tenant_code-error" role="alert" className="text-xs text-[oklch(var(--color-danger))]">
              <span aria-hidden="true">! </span>
              {tenantError}
            </span>
          ) : null}
        </fieldset>

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

        {/* No 「存草稿」: the dispatch API has no draft state — a record is
            PROPOSED the moment it exists (backend/apps/dispatch/models.py). */}
        <div className="flex flex-wrap gap-2 border-t border-[oklch(var(--color-block))] pt-3">
          <RequirePermission permissions="dispatch.manage">
            <Button type="submit" variant="primary" loading={loading}>
              {loading ? t("dispatch.submitting") : t("dispatch.submit_proposal")}
            </Button>
          </RequirePermission>
          <Button
            type="button"
            variant="ghost"
            onClick={() => (dirty ? setDiscardOpen(true) : router.back())}
          >
            {t("dispatch.discard")}
          </Button>
        </div>
      </form>

      {/* 审批流 — what actually happens to this record, per the state machine
          in backend/apps/dispatch/models.py: PROPOSED → the target approves
          (views.py: "Only target tenant can approve") → the target executes. */}
      <aside aria-labelledby="dispatch-flow-title">
        <h2
          id="dispatch-flow-title"
          className="border-b border-[oklch(var(--color-block))] pb-1 font-mono text-2xs tracking-widest text-[oklch(var(--color-ink-subtle))]"
        >
          {t("dispatch.flow.title")}
        </h2>
        <ol className="text-sm">
          {[
            [t("dispatch.flow.step_propose", { tenant: sourceTenantRow ? tenantName(sourceTenantRow) : sourceCode ?? "" }), t("dispatch.flow.pending_submit")],
            [t("dispatch.flow.step_approve", { tenant: targetTenantRow ? tenantName(targetTenantRow) : t("dispatch.flow.target_unchosen") }), t("dispatch.flow.not_yet")],
            [t("dispatch.flow.step_execute"), t("dispatch.flow.not_yet")],
          ].map(([step, state], i) => (
            <li key={i} className="grid grid-cols-[24px_1fr_auto] border-b border-[oklch(var(--color-rule))] py-2">
              <span className="font-mono text-[oklch(var(--color-ink-subtle))]">{i + 1}</span>
              <span className="text-[oklch(var(--color-ink))]">{step}</span>
              <span className="text-[oklch(var(--color-ink-subtle))]">{state}</span>
            </li>
          ))}
        </ol>
      </aside>
      </div>

      <ConfirmDialog
        isOpen={discardOpen}
        title={t("dispatch.discard_title")}
        message={t("dispatch.discard_message")}
        cancelText={t("dispatch.discard_keep")}
        confirmText={t("dispatch.discard_confirm")}
        onCancel={() => setDiscardOpen(false)}
        onConfirm={() => {
          setDiscardOpen(false);
          router.back();
        }}
      />
    </PageShell>
  );
}
