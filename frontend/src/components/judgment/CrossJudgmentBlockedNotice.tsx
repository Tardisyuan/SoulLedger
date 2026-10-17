"use client";

import Link from "next/link";
import type { CrossTenantJudgment } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";

/** 还在进行的跨域审判:原审判结案前它必须结束或取消(`SentencePlanService.check_cross_judgment`)。 */
export const isCrossJudgmentOpen = (cross: Pick<CrossTenantJudgment, "status"> | null | undefined) =>
  cross?.status === "PROPOSED" || cross?.status === "ACTIVE";

/**
 * 「还有一场跨域审判没结束,暂时不能结案」+「去跨域审判 ›」(第四十批 W-a)。
 *
 * 两处用同一句话:审判页载入时就判断、放在结案按钮上面;提交时才被 409 `cross_judgment_open`
 * 挡下(并发)时放进盖印确认层,代替服务端的英文报错。`cross` 取不到时只写标题与链接。
 * 「已入席」数的是已经填好自己那一站的席位(顾问不填站,算已入席)。
 */
export function CrossJudgmentBlockedNotice({ crossId, cross }: { crossId: string; cross?: CrossTenantJudgment | null }) {
  const { t, formatDate } = useI18n();
  const seats = cross?.participants ?? [];
  const joined = seats.filter((p) => p.role === "ADVISOR" || p.sentence_submitted_at).length;
  return (
    <div role="alert" data-testid="cross-blocked" className="w-full border border-[oklch(var(--color-line))] px-3 py-2 text-left text-sm">
      <p className="font-medium text-[oklch(var(--color-ink))]">
        <span aria-hidden="true">◐ </span>
        {t("judgment.close_blocked_title")}
      </p>
      {cross && (
        <p className="mt-1 text-[oklch(var(--color-ink-muted))]">
          {t("judgment.close_blocked_body", {
            name: cross.title,
            date: formatDate(cross.create_time),
            joined: String(joined),
            total: String(seats.length),
          })}
        </p>
      )}
      <Link href={`/cross-judgments/${crossId}`} className="mt-1 inline-block text-[oklch(var(--color-accent-ink))] hover:underline">
        {t("judgment.close_blocked_link")}
      </Link>
    </div>
  );
}
