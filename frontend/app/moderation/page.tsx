"use client";

import { useEffect, useState } from "react";
import {
  useHandledContent,
  useModeratedContent,
  useModerationReports,
  useSensitiveWords,
  useSocialMutes,
} from "@soulledger/core/hooks/useSocialModeration";
import { useI18n } from "@/src/contexts/I18nContext";
import { tenantLabel } from "@/src/lib/domainNames";
import { usePlaque } from "@/src/components/plaque/Plaque";
import { useHall } from "@/src/components/plaque/useHall";
import { useTenant } from "@/src/contexts/TenantContext";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { PageShell } from "@/src/components/ui/PageShell";
import { ReportsReview } from "@/src/components/moderation/ReportsReview";
import { SensitiveWordsSection } from "@/src/components/moderation/SensitiveWordsSection";
import { MutesSection } from "@/src/components/moderation/MutesSection";
import { HandledSection } from "@/src/components/moderation/HandledSection";
import { Segmented } from "@/src/components/ui/Segmented";

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
const isSegment = (v: string | null): v is Segment => SEGMENTS.includes(v as Segment);

/**
 * 分段在地址栏里(`?segment=`,review-2026-11-01 Web 7):刷新、返回、分享链接都回到同一段。
 * 「举报」是默认段,不写进地址。用 `history.replaceState` 而不是 router:换段不是一次导航,
 * 不该进历史记录;Next 的 App Router 会把它同步进自己的状态。挂载后读一次(与审计页的 `?trace=` 同理,
 * 不需要 Suspense 边界)。
 */
function useSegmentInUrl(): [Segment, (next: Segment) => void] {
  const [current, setCurrent] = useState<Segment>("reports");
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("segment");
    if (isSegment(fromUrl)) setCurrent(fromUrl);
  }, []);
  const change = (next: Segment) => {
    setCurrent(next);
    const url = new URL(window.location.href);
    if (next === "reports") url.searchParams.delete("segment");
    else url.searchParams.set("segment", next);
    window.history.replaceState(window.history.state, "", url);
  };
  return [current, change];
}

function sumCounts(...counts: (number | undefined)[]): number | undefined {
  return counts.some((c) => c === undefined) ? undefined : counts.reduce<number>((a, c) => a + (c ?? 0), 0);
}

function ModerationPageContent() {
  const { t, locale } = useI18n();
  usePlaque({ hall: useHall(t("plaque.office.rules")) });
  const { user } = useTenant();
  const [segment, setSegment] = useSegmentInUrl();

  // The switch's counts. Same query keys as the sections' first page, so these
  // are the requests the sections would make anyway, not extra ones.
  const counts: Record<Segment, number | undefined> = {
    // Reports plus word-list holds (PENDING): the queue ReportsReview shows holds both (F-SOC-04).
    reports: sumCounts(
      useModerationReports({}).data?.count,
      useModeratedContent("posts", {}).data?.count,
      useModeratedContent("comments", {}).data?.count,
    ),
    words: useSensitiveWords().data?.count,
    mutes: useSocialMutes({ status: "ACTIVE" }).data?.count, // 禁言中,与分区的默认筛选同一个 key
    handled: useHandledContent({}).data?.count,
  };

  const scope = tenantLabel(t, user?.tenant, locale) || t("social_moderation.scope_all");

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
        <Segmented
          label={t("social_moderation.tabs.label")}
          value={segment}
          onChange={(v) => setSegment(v as Segment)}
          className="max-w-full flex-wrap"
          options={SEGMENTS.map((value) => ({
            value,
            label: (
              <span className="inline-flex items-center gap-2">
                {t(`social_moderation.tabs.${value}`)}
                {counts[value] !== undefined && (
                  <>
                    <span aria-hidden="true" className="font-mono text-2xs">
                      {counts[value]}
                    </span>
                    {/* 计数对读屏也要在(review-2026-11-01 Web 7):此前整个数字 aria-hidden。 */}
                    <span className="sr-only">{t("social_moderation.tab_count_sr", { n: String(counts[value]) })}</span>
                  </>
                )}
              </span>
            ),
          }))}
        />
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
