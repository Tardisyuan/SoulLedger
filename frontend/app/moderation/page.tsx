"use client";

import { useState } from "react";
import {
  useHandledContent,
  useModerationReports,
  useSensitiveWords,
  useSocialMutes,
} from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { ReportsReview } from "@/src/components/moderation/ReportsReview";
import { SensitiveWordsSection } from "@/src/components/moderation/SensitiveWordsSection";
import { MutesSection } from "@/src/components/moderation/MutesSection";
import { HandledSection } from "@/src/components/moderation/HandledSection";
import { cn } from "@/lib/utils";

/*
 * 官员审核后台 /moderation:四区共用一个页头 —— 文明范围加分段切换
 * (举报 · 敏感词 · 禁言 · 已处理),版式见 C 组 08 与 E 组 08b / 08c / 08d。
 *
 * 每个端点都要 `social.moderate`(backend/apps/social/moderation_views.py),页面整体
 * 包在同一个码名里 —— 没有「只能看不能处置」的状态,所以没有 canManage 分支。
 *
 * 文明范围不是一个可选的筛选:后端按请求的租户 `scope_to_tenant`,词表、禁言、
 * 举报都按文明隔离。所以页头只**说出**当前是哪一份,不给一个换不了的下拉。
 */

type Segment = "reports" | "words" | "mutes" | "handled";
const SEGMENTS: Segment[] = ["reports", "words", "mutes", "handled"];

function ModerationPageContent() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [segment, setSegment] = useState<Segment>("reports");

  // The switch's counts. Same query keys as the sections' first page, so these
  // are the requests the sections would make anyway, not extra ones.
  const counts: Record<Segment, number | undefined> = {
    reports: useModerationReports({}).data?.count,
    words: useSensitiveWords().data?.count,
    mutes: useSocialMutes().data?.count,
    handled: useHandledContent({}).data?.count,
  };

  const scope = user?.tenant?.display_name ?? t("social_moderation.scope_all");

  return (
    <PageShell
      variant="full"
      title={t("social_moderation.title")}
      actions={
        <span className="flex items-center gap-2 text-sm" aria-label={t("social_moderation.scope_label")}>
          <span className="font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{t("social_moderation.scope_label")}</span>
          <span className="border border-[oklch(var(--color-line))] px-2 py-0.5 text-[oklch(var(--color-ink))]">
            <span aria-hidden="true">■ </span>
            {scope}
          </span>
        </span>
      }
      tabs={
        <div role="group" aria-label={t("social_moderation.tabs.label")} className="flex flex-wrap border border-[oklch(var(--color-block))] w-fit">
          {SEGMENTS.map((value) => {
            const on = segment === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => setSegment(value)}
                className={cn(
                  "flex min-h-8 items-center gap-1.5 px-3 text-sm max-sm:min-h-11",
                  on
                    ? "bg-[oklch(var(--color-ink))] text-[oklch(var(--color-canvas))]"
                    : "text-[oklch(var(--color-ink-muted))] hover:bg-[oklch(var(--color-surface-2))]"
                )}
              >
                {t(`social_moderation.tabs.${value}`)}
                {counts[value] !== undefined && (
                  <span aria-hidden="true" className="font-mono text-2xs opacity-80">
                    {counts[value]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      }
    >
      {segment === "reports" && <ReportsReview />}
      {segment === "words" && <SensitiveWordsSection />}
      {segment === "mutes" && <MutesSection />}
      {segment === "handled" && <HandledSection />}
    </PageShell>
  );
}

export default function ModerationPage() {
  return (
    <RequirePermission permissions="social.moderate" fallback={<PermissionDenied />}>
      <ModerationPageContent />
    </RequirePermission>
  );
}
