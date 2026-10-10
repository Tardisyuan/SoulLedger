"use client";

import { useState } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { exportFileName } from "@/src/lib/exportFileName";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";

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
}: {
  fetchCsv: () => Promise<{ data: Blob }>;
  page: string;
  hall?: string;
  size?: "sm" | "md";
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
  return (
    <Button type="button" variant="secondary" size={size} loading={busy} onClick={run}>
      {t("common.export")}
    </Button>
  );
}
