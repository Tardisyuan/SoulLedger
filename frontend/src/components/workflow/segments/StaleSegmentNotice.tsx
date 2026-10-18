"use client";

import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import type { StaleSegment } from "./segmentModel";

/**
 * W-5d:确认时那一段刚被别人改过(409 `segment_changed`)。先拦下,不覆盖 ——
 * 「看现在的选择」把列表换成库里现在的样子,看过再确认。选站与加减站共用。
 */
export function StaleSegmentNotice({ stale, onView }: { stale: StaleSegment; onView: () => void }) {
  const { t, formatDateTime } = useI18n();
  return (
    <div role="alert" data-testid="segment-stale" className="flex flex-col gap-2 border border-[oklch(var(--color-ink))] px-3 py-2 text-sm">
      <p className="font-medium text-[oklch(var(--color-ink))]">{t("workflow.pick.stale_title")}</p>
      {stale.by ? (
        <p className="text-[oklch(var(--color-ink-muted))]">
          {t("workflow.pick.stale_body", { by: stale.by, time: stale.at ? formatDateTime(stale.at) : "" })}
        </p>
      ) : null}
      <Button type="button" size="sm" variant="secondary" className="self-start" onClick={onView}>
        {t("workflow.pick.stale_view")}
      </Button>
    </div>
  );
}
