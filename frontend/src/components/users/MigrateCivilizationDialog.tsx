"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usersApi, type MigrateOpenWork, type User } from "@soulledger/core/api";
import { problemFieldCodes, responseCode, responseData } from "@soulledger/core/api/client";
import { useTenantNames } from "@soulledger/core/hooks/useTenants";
import { userKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { BaseModal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { SelectField, TextAreaField } from "@/src/components/ui/Field";
import { showToast } from "@/src/components/ui/Toast";
import { tenantLabel } from "@/src/lib/domainNames";
import { cn } from "@/lib/utils";
import { HALL_CIVILIZATIONS } from "@/src/components/tenants/HallLifecycleDialogs";
import { useSecondFactor } from "./SecondFactorPrompt";

/** The blocked list's rows, in Design's order (batch 54 H1), each with the list it links to. */
const BLOCKED_ROWS: { key: keyof Omit<MigrateOpenWork, "kinds">; href: string }[] = [
  { key: "claimed", href: "/judgment" },
  { key: "approvals", href: "/workflow" },
  { key: "dispatch", href: "/dispatch" },
  { key: "cross", href: "/cross-judgments" },
];

/** The account's civilization: its hall's, or a civilization ADMIN's own. */
export function civilizationOf(user: User): string | null {
  return user.tenant?.civilization ?? user.civilization ?? null;
}

/** A save the sharding guard refused (a key naming another civilization's row): Design's sentence, in full. */
export function isCrossCivilization(error: unknown): boolean {
  return Object.values(problemFieldCodes(error)).some((codes) => codes.includes("cross_civilization"));
}

/**
 * 迁移文明(SYSTEM_ADMIN,2026-11-16;Design 第五十四批 H1):是谁 → 迁到哪一家(四格,只用墨,当前那家灰而不可点)
 * → 绑殿官员再选新文明里的殿 → 原因(必填,进审计)→ 后果说明 → 「迁到{{civ}}」。手上有没办完的事时表单换成清单,
 * 打开时查一次,窗口回到前台时再查(「去看 ›」在新标签页里开),清空后自动换回表单。不用红:这不是错误。
 */
export function MigrateCivilizationDialog({ user, onClose, onDone }: {
  user: User;
  onClose: () => void;
  onDone?: (user: User) => void;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const current = civilizationOf(user);
  const hallBound = user.tenant != null;
  const [civ, setCiv] = useState("");
  const [hall, setHall] = useState("");
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const secondFactor = useSecondFactor(user.username);

  const openWork = useQuery({
    queryKey: [...userKeys.all, "migrate-open-work", user.id],
    queryFn: () => usersApi.migrateOpenWork(user.id).then((r) => r.data),
    refetchOnWindowFocus: "always",
    staleTime: 0,
  });
  const blocked = BLOCKED_ROWS.filter((row) => (openWork.data?.[row.key] ?? 0) > 0);
  const halls = useTenantNames({ enabled: hallBound });
  const hallChoices = (halls.data ?? []).filter((h) => h.civilization === civ && h.is_active !== false);

  const move = useMutation({
    mutationFn: () =>
      secondFactor.run((proof) =>
        usersApi.migrateCivilization(user.id, { civilization: civ, ...(hallBound ? { tenant: hall } : {}), reason: reason.trim() }, proof)
      ),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.all });
      const civName = t(`tenant.civilizations.${civ}`);
      const picked = hallChoices.find((h) => h.code === hall);
      showToast(
        picked
          ? t("users.migrate_civ.done", { name: user.username, civ: civName, hall: tenantLabel(t, picked, locale) })
          : t("users.migrate_civ.done_no_hall", { name: user.username, civ: civName }),
        "info"
      );
      onDone?.(res.data);
      onClose();
    },
    onError: (error) => {
      const code = responseCode(error);
      if (code === "reason_required") return focusReason();
      if (code === "account_has_open_work") {
        const work = responseData<{ open_work: MigrateOpenWork }>(error)?.open_work;
        if (work) queryClient.setQueryData([...userKeys.all, "migrate-open-work", user.id], work);
        return;
      }
      showToast(isCrossCivilization(error) ? t("errors.cross_civilization") : t("users.update_error"), "error");
    },
  });

  function focusReason() {
    setReasonError(t("users.migrate_civ.reason_required"));
    document.getElementById("migrate-civ-reason")?.focus();
  }

  const ready = Boolean(civ) && (!hallBound || Boolean(hall)) && blocked.length === 0;
  const civName = civ ? t(`tenant.civilizations.${civ}`) : "";

  return (
    <BaseModal
      isOpen
      wide
      dismissOnOutsideClick={false}
      title={t("users.migrate_civ.menu")}
      onClose={() => !move.isPending && onClose()}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={move.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            form="migrate-civ-form"
            variant="primary"
            className="max-sm:h-[52px] max-sm:flex-[1.6]"
            data-testid="migrate-civ-submit"
            disabled={!ready}
            loading={move.isPending}
          >
            {civ && blocked.length === 0 ? t("users.migrate_civ.submit", { civ: civName }) : t("users.migrate_civ.menu")}
          </Button>
        </div>
      }
    >
      <form
        id="migrate-civ-form"
        aria-label={t("users.migrate_civ.title", { name: user.username })}
        className="flex flex-col gap-4 text-sm text-[oklch(var(--color-ink))]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ready) return;
          if (!reason.trim()) return focusReason();
          move.mutate();
        }}
      >
        <p className="m-0 flex flex-wrap items-center gap-2">
          <span>{[user.first_name, user.last_name].filter(Boolean).join(" ") || user.username}</span>
          <span className="font-mono text-[oklch(var(--color-ink-muted))]">{user.username}</span>
          <span className="sr-only">{t("users.migrate_civ.from")}</span>
          <span data-testid="migrate-civ-now" className="rounded-control border border-[oklch(var(--color-line))] px-1 text-xs">
            {[current ? t(`tenant.civilizations.${current}`) : null, user.tenant ? tenantLabel(t, user.tenant, locale) : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </p>

        {blocked.length > 0 ? (
          <section aria-labelledby="migrate-civ-blocked" className="flex flex-col gap-2">
            <div>
              <h3 id="migrate-civ-blocked" className="m-0 text-md font-semibold">{t("users.migrate_civ.blocked_title")}</h3>
              <p className="m-0 text-[oklch(var(--color-ink-muted))]">{t("users.migrate_civ.blocked_body")}</p>
            </div>
            <ul className="m-0 list-none divide-y divide-[oklch(var(--color-line))] rounded-control border border-[oklch(var(--color-line))] p-0">
              {blocked.map((row) => (
                <li key={row.key} data-testid={`migrate-civ-blocked-${row.key}`} className="flex items-center justify-between px-3 py-2">
                  <span>{t(`users.migrate_civ.blocked.${row.key}`, { n: String(openWork.data?.[row.key] ?? 0) })}</span>
                  <a href={row.href} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                    {t("users.migrate_civ.blocked.open")}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <fieldset className={cn("m-0 flex flex-col gap-2 border-0 p-0", blocked.length > 0 && "opacity-40")} disabled={blocked.length > 0}>
          {blocked.length === 0 ? <legend className="mb-1">{t("users.migrate_civ.to")}</legend> : null}
          <div role="radiogroup" aria-label={t("users.migrate_civ.to")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HALL_CIVILIZATIONS.map((c) => {
              const isCurrent = c === current;
              const selected = c === civ;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={isCurrent}
                  onClick={() => {
                    setCiv(c);
                    setHall("");
                  }}
                  className={cn(
                    "h-11 rounded-control border px-2",
                    isCurrent
                      ? "border-transparent bg-[oklch(var(--color-surface-2))] text-[oklch(var(--color-faint-text))]"
                      : selected
                        ? "border-2 border-[oklch(var(--color-ink))]"
                        : "border-[oklch(var(--color-line))]"
                  )}
                >
                  {selected ? <span aria-hidden="true">● </span> : null}
                  {t(`tenant.civilizations.${c}`)}
                  {isCurrent ? <span className="text-xs"> · {t("users.migrate_civ.current")}</span> : null}
                </button>
              );
            })}
          </div>
        </fieldset>

        {blocked.length === 0 ? (
          <>
            {hallBound ? (
              <SelectField
                label={t("users.migrate_civ.hall")}
                value={hall}
                disabled={!civ}
                onChange={(e) => setHall(e.target.value)}
                options={[
                  { value: "", label: t("users.migrate_civ.hall_wait"), disabled: true },
                  ...hallChoices.map((h) => ({ value: h.code, label: tenantLabel(t, h, locale) })),
                ]}
              />
            ) : null}
            <TextAreaField
              modEnterSubmits={false}
              id="migrate-civ-reason"
              label={t("users.migrate_civ.reason")}
              description={t("users.migrate_civ.reason_hint")}
              error={reasonError || undefined}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (reasonError) setReasonError("");
              }}
              maxLength={400}
              rows={3}
              className="[&_textarea]:min-h-[72px]"
            />
            <p className="m-0 flex gap-2 rounded-control bg-[oklch(var(--color-surface-2))] px-3 py-2">
              <span aria-hidden="true">ⓘ</span>
              {t("users.migrate_civ.consequence")}
            </p>
          </>
        ) : null}
      </form>
      {secondFactor.prompt}
    </BaseModal>
  );
}
