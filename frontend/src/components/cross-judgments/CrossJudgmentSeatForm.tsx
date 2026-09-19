"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crossTenantJudgmentsApi, type CrossTenantJudgment } from "@soulledger/core/api";
import { TENANT_CODE_TO_CIVILIZATION } from "@soulledger/core/config/civilizations";
import { resolveEnumDisplay } from "@/src/lib/domainDisplay";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Button } from "@/src/components/ui/Button";
import { SelectField } from "@/src/components/ui/Field";

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
 * * 席位上的判官(`participant_actor`)不在这里选:它是可选的,而可选的神祇只属发起方租户(视图按请求方
 *   租户过滤),填了反而误导。见报告「待拍板」。
 */
export function CrossJudgmentSeatForm({ judgment }: { judgment: CrossTenantJudgment }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { user } = useTenant();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();
  const [tenantCode, setTenantCode] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("CO_JUDGE");

  const mine = user?.tenant?.code ?? null;
  const seatedCodes = new Set(judgment.participants.map((p) => p.participant_tenant_code));
  const available = Object.keys(TENANT_CODE_TO_CIVILIZATION).filter(
    (code) => code !== judgment.initiating_tenant_code && !seatedCodes.has(code)
  );
  const carriesStop = !!judgment.judgment && role !== "ADVISOR";
  const nextOrder =
    Math.max(1, ...judgment.participants.map((p) => p.node_order ?? 0).filter((n) => n > 0)) + 1;

  const seat = useMutation({
    mutationFn: () =>
      crossTenantJudgmentsApi.participate(judgment.id, {
        participant_tenant_code: tenantCode,
        role,
        ...(carriesStop ? { node_order: nextOrder } : {}),
      }),
    onSuccess: () => {
      setTenantCode("");
      showToast(t("sentence_plan.cross.seated"), "success");
      queryClient.invalidateQueries({ queryKey: ["cross-judgments"] });
    },
    onError: (error) => showToast(errorText(error) ?? t("sentence_plan.cross.seat_error"), "error"),
  });

  if (
    judgment.status !== "PROPOSED" ||
    mine === null ||
    mine !== judgment.initiating_tenant_code ||
    !hasPermission("cross_judgment.create") ||
    available.length === 0
  ) {
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
      <h2 className="text-06 text-[oklch(var(--color-ink))]">{t("sentence_plan.cross.seat_title")}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label={t("sentence_plan.cross.seat_tenant")}
          value={tenantCode}
          onChange={(e) => setTenantCode(e.target.value)}
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
          onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
          options={ROLES.map((r) => ({
            value: r,
            label: resolveEnumDisplay(t, "crossJudgments.participant_roles", r).label ?? r,
          }))}
        />
      </div>
      {judgment.judgment && (
        <p className="text-02 text-[oklch(var(--color-ink-subtle))]" data-testid="seat-stop">
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
