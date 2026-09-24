"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, type CrossTenantJudgment } from "@soulledger/core/api";
import type { SeatableActor } from "@soulledger/core/api/dispatch";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";

/** The name in the reader's language, falling back to the primary name. */
function actorName(a: SeatableActor, locale: string): string {
  const byLocale = locale === "en" ? a.name_en : locale === "egy" ? a.name_egy : a.name_zh;
  return byLocale || a.name;
}

const ROLES = ["CO_JUDGE", "CHAIRMAN", "ADVISOR"] as const;

function errorText(error: unknown): string | null {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  const first = data?.error ?? Object.values(data ?? {})[0];
  const text = Array.isArray(first) ? first[0] : first;
  return typeof text === "string" ? text : null;
}

/**
 * 发起方请文明入席(`participate/`,BD-06:只有发起方、只在 PROPOSED)。
 *
 * * 席位按**租户代码**指定:非 ADMIN 查不到别的租户的数字 id(`/tenants/` 只给自己那一行)。
 *   可选的是另外三个文明中还没入席的。
 * * N3=(a):联合审判官 / 主持带一站,站号自动取下一个(2、3……;要换顺序用各站区的上下移);
 *   顾问不带站。没挂审判的联审(存量会议)不带站号 —— 服务端对它拒收 `node_order`。
 * * 席位上的神祇(可选,2026-09-20 用户决定):从**被邀文明**里可担任**这种席位**的神祇选
 *   (`seatable-actors/`,只给发起方;D13:联合审判官 / 主持只有判官,顾问任一在任神祇)。
 *   换文明或换角色都重新取列表、清空已选。服务端入席时再校验一次。
 */
export function CrossJudgmentSeatForm({ judgment }: { judgment: CrossTenantJudgment }) {
  const { t, locale } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [tenantCode, setTenantCode] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("CO_JUDGE");
  const [actorId, setActorId] = useState("");

  const mine = user?.tenant?.code ?? null;
  const seatedCodes = new Set(judgment.participants.map((p) => p.participant_tenant_code));
  const available = Object.keys(TENANT_CODE_TO_CIVILIZATION).filter(
    (code) => code !== judgment.initiating_tenant_code && !seatedCodes.has(code)
  );
  const carriesStop = !!judgment.judgment && role !== "ADVISOR";
  const nextOrder =
    Math.max(1, ...judgment.participants.map((p) => p.node_order ?? 0).filter((n) => n > 0)) + 1;

  const isInitiator =
    judgment.status === "PROPOSED" &&
    mine !== null &&
    mine === judgment.initiating_tenant_code &&
    hasPermission("cross_judgment.create");
  const actors = useQuery({
    queryKey: ["cross-judgments", "seatable-actors", judgment.id, tenantCode, role],
    queryFn: () => crossTenantJudgmentsApi.seatableActors(judgment.id, tenantCode, role).then((r) => r.data),
    enabled: isInitiator && !!tenantCode,
  });

  const seat = useMutation({
    mutationFn: () =>
      crossTenantJudgmentsApi.participate(judgment.id, {
        participant_tenant_code: tenantCode,
        role,
        ...(actorId ? { participant_actor: actorId } : {}),
        ...(carriesStop ? { node_order: nextOrder } : {}),
      }),
    onSuccess: () => {
      setTenantCode("");
      setActorId("");
      showToast(t("sentence_plan.cross.seated"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
    },
    onError: (error) => showToast(errorText(error) ?? t("sentence_plan.cross.seat_error"), "error"),
  });

  if (!isInitiator || available.length === 0) {
    return null;
  }

  return (
    <form
      className="mb-6 space-y-3 bg-[oklch(var(--color-surface-2))] p-4"
      aria-label={t("sentence_plan.cross.seat_title")}
      onSubmit={(e) => {
        e.preventDefault();
        if (tenantCode) seat.mutate();
      }}
    >
      <h2 className="text-md text-[oklch(var(--color-ink))]">{t("sentence_plan.cross.seat_title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("sentence_plan.cross.seat_tenant")}
          value={tenantCode}
          onChange={(e) => {
            setTenantCode(e.target.value);
            setActorId("");
          }}
          options={[
            { value: "", label: t("sentence_plan.cross.seat_tenant_placeholder") },
            ...available.map((code) => ({
              value: code,
              label: resolveEnumDisplay(t, "tenant.civilizations", TENANT_CODE_TO_CIVILIZATION[code]).label ?? code,
            })),
          ]}
        />
        <SelectField
          label={t("sentence_plan.cross.seat_role")}
          value={role}
          onChange={(e) => {
            setRole(e.target.value as (typeof ROLES)[number]);
            setActorId("");
          }}
          options={ROLES.map((r) => ({
            value: r,
            label: resolveEnumDisplay(t, "crossJudgments.participant_roles", r).label ?? r,
          }))}
        />
      </div>
      {tenantCode &&
        actors.data &&
        (actors.data.length === 0 ? (
          <p className="text-xs text-[oklch(var(--color-ink-subtle))]">{t("sentence_plan.cross.seat_actor_empty")}</p>
        ) : (
          <SelectField
            label={t("sentence_plan.cross.seat_actor")}
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            options={[
              { value: "", label: t("sentence_plan.cross.seat_actor_none") },
              ...actors.data.map((a) => ({
                value: a.id,
                // 顾问席混着几种神祇:名字后面带上它的角色。
                label:
                  role === "ADVISOR"
                    ? `${actorName(a, locale)} · ${resolveEnumDisplay(t, "actors.roles", a.role).label ?? a.role}`
                    : actorName(a, locale),
              })),
            ]}
            description={t(
              role === "ADVISOR"
                ? "sentence_plan.cross.seat_actor_hint_advisor"
                : "sentence_plan.cross.seat_actor_hint_judging"
            )}
          />
        ))}
      {judgment.judgment && (
        <p className="text-xs text-[oklch(var(--color-ink-subtle))]" data-testid="seat-stop">
          {carriesStop
            ? t("sentence_plan.cross.seat_order", { order: String(nextOrder) })
            : t("sentence_plan.cross.seat_advisor_hint")}
        </p>
      )}
      <Button type="submit" size="sm" loading={seat.isPending} disabled={!tenantCode}>
        {t("sentence_plan.cross.seat_submit")}
      </Button>
    </form>
  );
}
