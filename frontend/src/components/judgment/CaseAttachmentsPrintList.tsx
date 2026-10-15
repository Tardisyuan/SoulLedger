"use client";

import { useCaseAttachments } from "@soulledger/core/hooks/useJudgments";
import { useI18n } from "@/src/contexts/I18nContext";
import { DomainText } from "@/src/components/ui/DomainValue";
import { formatBytes } from "./caseAttachmentRules";

/**
 * 打印卷宗时正文后面的「附件清单」一页(名称、大小、上传人、时间),不嵌入原件;页脚写「附件原件见系统」
 * (`PrintFrame` 的 `note`,由页面在有附件时传)。屏幕上不显示:`hidden print:block`,换页靠 `break-before-page`。
 * 没有附件就什么都不画 —— 空的一页比没有更糟。
 */
export function CaseAttachmentsPrintList({ judgmentId, enabled }: { judgmentId: string; enabled: boolean }) {
  const { t, formatDateTime } = useI18n();
  const items = useCaseAttachments(judgmentId, { enabled }).data?.items ?? [];
  if (!enabled || items.length === 0) return null;
  return (
    <section data-testid="attachments-print-list" className="hidden break-before-page print:block">
      <h2 className="mb-3 text-lg">{t("case.attachments.print_title")}</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left">
            <th className="py-1 pr-3">{t("case.attachments.col_name")}</th>
            <th className="py-1 pr-3">{t("case.attachments.col_size")}</th>
            <th className="py-1 pr-3">{t("case.attachments.col_uploader")}</th>
            <th className="py-1">{t("case.attachments.col_time")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-t border-[oklch(var(--color-line))]">
              <td className="py-1 pr-3 break-words">{a.name}</td>
              <td className="py-1 pr-3 font-mono">{formatBytes(a.byte_size)}</td>
              <td className="py-1 pr-3"><DomainText value={a.uploader_name} /></td>
              <td className="py-1 font-mono">{formatDateTime(a.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
