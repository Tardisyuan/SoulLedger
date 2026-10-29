"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { organizationsApi } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { OrgTreeSelect } from "@/src/components/organizations/OrgTreeSelect";

/**
 * 灵魂 / 审判的「所属机构」(数据范围 B3a):显示机构名;`canChange`(灵魂 soul.update、审判 judgment.assign)时
 * 可改 —— 单选本殿机构树,保存即 PATCH `owner_org`。范围外的机构服务端答 400,这里把那句话原样提示出来。
 */
export function OwnerOrgField({
  orgId,
  orgName,
  tenantId,
  canChange,
  onSave,
}: {
  orgId: number | null | undefined;
  orgName: string | null | undefined;
  tenantId: number | null | undefined;
  canChange: boolean;
  onSave: (orgId: number) => Promise<unknown>;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<number | null>(orgId ?? null);
  const [busy, setBusy] = useState(false);
  const orgs = useQuery({ queryKey: ["organizations"], queryFn: () => organizationsApi.all(), enabled: editing });

  const save = async () => {
    if (picked == null || busy) return;
    setBusy(true);
    try {
      await onSave(picked);
      setEditing(false);
      showToast(t("org.owner_saved"), "success");
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      showToast(t(status === 400 ? "org.owner_out_of_scope" : "org.owner_failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 text-sm" data-testid="owner-org">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("org.owner_label")}</span>
        <span>{orgName || "—"}</span>
        {canChange && !editing && (
          <Button size="sm" variant="ghost" onClick={() => { setPicked(orgId ?? null); setEditing(true); }}>
            {t("org.owner_change")}
          </Button>
        )}
      </div>
      {editing && (
        <>
          <OrgTreeSelect
            mode="single"
            label={t("org.owner_label")}
            organizations={(orgs.data ?? []).filter((o) => tenantId == null || o.tenant === tenantId)}
            value={picked}
            onChange={setPicked}
          />
          <div className="flex gap-2">
            <Button size="sm" variant="primary" loading={busy} disabled={picked == null || picked === orgId} onClick={save}>
              {t("common.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
