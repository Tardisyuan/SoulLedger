"use client";

import { useId, useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { exportFileName } from "@/src/lib/exportFileName";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";

/** 超过这个行数导出按钮置灰(Design 第二十八批 W5;后端上限更高,这里是界面的先行拦截)。 */
export const EXPORT_DISABLE_ABOVE = 10_000;

/**
 * 列表页的「导出」:下载当前列表(同一范围、同一筛选)的 CSV。后端是同一个读码名
 * (`dispatch.read` / `disposition.read` / `cross_judgment.read`),所以挂在页级门之内,
 * 能看见列表的人就能导出。失败走提示条;请求期间按钮转圈、不可重复点。
 * 文件名由前端定(`download` 属性,后端的 Content-Disposition 只对直接调接口的人有效):
 * 页面标题 - 殿名 - 本地时间,见 `exportFileName`。
 */
export function ExportCsvButton({
  fetchCsv,
  page,
  hall,
  size = "md",
  count,
}: {
  fetchCsv: () => Promise<{ data: Blob }>;
  page: string;
  hall?: string;
  size?: "sm" | "md";
  /** 当前筛选下的行数(列表已有的 `count`);超过 `EXPORT_DISABLE_ABOVE` 按钮置灰。 */
  count?: number;
}) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      saveBlob((await fetchCsv()).data, exportFileName(page, hall));
    } catch {
      showToast(t("common.export_failed"), "error");
    } finally {
      setBusy(false);
    }
  };
  // 列表页给了行数(`count`)就按第二十八批 W5 的写法:「导出 CSV」,悬停提示与读屏名是「按当前筛选导出,共 n 条」,
  // 超过上限置灰、旁边写原因。没给行数的调用(分段列表、没有计数的页)保持原样「导出」。
  const counted = count !== undefined;
  const tooMany = counted && count > EXPORT_DISABLE_ABOVE;
  const scope = counted ? t("common.export_scope", { n: String(count) }) : undefined;
  const noteId = useId();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        loading={busy}
        disabled={tooMany}
        onClick={run}
        title={scope}
        aria-label={scope}
        aria-describedby={tooMany ? noteId : undefined}
      >
        {counted ? t("common.export_csv") : t("common.export")}
      </Button>
      {tooMany ? (
        <span id={noteId} className="text-sm text-[oklch(var(--color-ink-muted))]">
          {t("common.export_too_many")}
        </span>
      ) : null}
    </>
  );
}
