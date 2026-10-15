"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import type { CaseAttachment } from "@soulledger/core/api/judgment";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useCaseAttachments, useDeleteCaseAttachment } from "@soulledger/core/hooks/useJudgments";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { Drawer } from "@/src/components/ui/Drawer";
import { DomainText } from "@/src/components/ui/DomainValue";
import { EmptyState } from "@/src/components/ui/EmptyState";
import { ConfirmDialog } from "@/src/components/ui/Modal";
import { QueryError } from "@/src/components/ui/PageError";
import { PageSpinner } from "@/src/components/ui/Spinner";
import { ERROR_KEY, formatBytes, isFinalRefusal, isPdf, kindTile, looksAllowed, megabytes } from "./caseAttachmentRules";

/**
 * 案卷附件(Design 第二十八批 W4):案卷页(「审判评语」下面、「评议区」上面)与审批页(「理由」之下)用的
 * 是这同一个组件,读写的都是同一个案子 —— 审批页传 `workflow.judgment`。
 *
 * 限制提示写在文件行上,不弹窗。上传:每个文件一个请求,行内进度条 + 取消(`AbortController`);失败的行留着,
 * 能重试的给「重试」,服务端明确拒绝的(类型、大小、个数、合计)只给「移除」。预览是右侧抽屉,走 10 分钟的签名地址。
 * 删除要确认;能不能删由服务端的 `can_delete` 决定(上传人、结案前),这里不自己猜。
 */
type Local = {
  key: number;
  name: string;
  size: number;
  state: "uploading" | "failed";
  progress: number;
  message?: string;
  retryable?: boolean;
};

export function CaseAttachments({ judgmentId, canWrite }: { judgmentId: string; canWrite: boolean }) {
  const { t, formatDateTime } = useI18n();
  const qc = useQueryClient();
  const q = useCaseAttachments(judgmentId);
  const del = useDeleteCaseAttachment(judgmentId);
  const input = useRef<HTMLInputElement>(null);
  const files = useRef(new Map<number, File>());
  const controllers = useRef(new Map<number, AbortController>());
  const seq = useRef(0);
  const [local, setLocal] = useState<Local[]>([]);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState<CaseAttachment | null>(null);
  const [asking, setAsking] = useState<CaseAttachment | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const titleId = useId();

  const patch = useCallback((key: number, next: Partial<Local>) => setLocal((rows) => rows.map((r) => (r.key === key ? { ...r, ...next } : r))), []);
  const drop = useCallback((key: number) => {
    files.current.delete(key);
    controllers.current.delete(key);
    setLocal((rows) => rows.filter((r) => r.key !== key));
  }, []);

  const data = q.data;
  const maxFile = data?.max_file_bytes ?? 20 * 1024 * 1024;

  const send = useCallback(
    async (key: number) => {
      const file = files.current.get(key);
      if (!file) return;
      const controller = new AbortController();
      controllers.current.set(key, controller);
      patch(key, { state: "uploading", progress: 0, message: undefined });
      const body = new FormData();
      body.append("file", file);
      try {
        await judgmentApi.uploadAttachment(judgmentId, body, { signal: controller.signal, onProgress: (f) => patch(key, { progress: f }) });
        drop(key);
        void qc.invalidateQueries({ queryKey: judgmentKeys.attachments(judgmentId) });
      } catch (e) {
        if (controller.signal.aborted) return drop(key);
        const res = (e as { response?: { data?: { code?: string } } }).response;
        const code = res?.data?.code;
        if (isFinalRefusal(code)) {
          const max = code === "too_many" ? (data?.max_count ?? 30) : Math.round(maxFile / 1048576);
          patch(key, { state: "failed", message: t(ERROR_KEY[code], { max: String(max) }), retryable: false });
        } else {
          patch(key, { state: "failed", message: t(res ? "case.attachments.failed_generic" : "case.attachments.failed_network"), retryable: true });
        }
      }
    },
    [judgmentId, qc, patch, drop, t, maxFile, data?.max_count],
  );

  const add = (picked: File[]) => {
    let count = (data?.count ?? 0) + local.filter((r) => r.state === "uploading").length;
    let used = (data?.total_bytes ?? 0) + local.filter((r) => r.state === "uploading").reduce((n, r) => n + r.size, 0);
    for (const file of picked) {
      const key = ++seq.current;
      const refuse = (message: string) => setLocal((rows) => [...rows, { key, name: file.name, size: file.size, state: "failed", progress: 0, message, retryable: false }]);
      if (!looksAllowed(file)) { refuse(t("case.attachments.failed_type")); continue; }
      if (file.size > maxFile) { refuse(t("case.attachments.too_large", { max: String(Math.round(maxFile / 1048576)) })); continue; }
      if (count + 1 > (data?.max_count ?? 30)) { refuse(t("case.attachments.too_many", { max: String(data?.max_count ?? 30) })); continue; }
      if (used + file.size > (data?.max_total_bytes ?? 100 * 1048576)) { refuse(t("case.attachments.full")); continue; }
      count += 1;
      used += file.size;
      files.current.set(key, file);
      setLocal((rows) => [...rows, { key, name: file.name, size: file.size, state: "uploading", progress: 0 }]);
      void send(key);
    }
  };

  const download = async (a: CaseAttachment) => {
    try {
      const link = await judgmentApi.attachmentLink(judgmentId, a.id);
      const el = document.createElement("a");
      el.href = `${mediaUrl(link.url)}&dl=1`;
      el.download = a.name;
      el.click();
    } catch {
      setRowError((m) => ({ ...m, [a.id]: t("case.attachments.preview_failed") }));
    }
  };

  const confirmDelete = () => {
    const a = asking;
    if (!a) return;
    del.mutate(a.id, {
      onSuccess: () => setAsking(null),
      onError: (e) => {
        const code = (e as { response?: { data?: { code?: string } } }).response?.data?.code;
        setRowError((m) => ({ ...m, [a.id]: t(code === "concluded" ? "case.attachments.delete_concluded" : "case.attachments.delete_failed") }));
        setAsking(null);
        void qc.invalidateQueries({ queryKey: judgmentKeys.attachments(judgmentId) });
      },
    });
  };

  const items = data?.items ?? [];
  return (
    <section data-testid="case-attachments" data-print-hide="" aria-labelledby={titleId} className="min-w-0 border-t border-[oklch(var(--color-line))] pt-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={titleId} className="font-title text-lg text-[oklch(var(--color-ink))]">{t("case.attachments.title")}</h2>
        {data && (
          <span data-testid="attachments-summary" className="text-sm text-[oklch(var(--color-ink-muted))]">
            {t("case.attachments.summary", { count: String(data.count), used: megabytes(data.total_bytes), max: String(Math.round(data.max_total_bytes / 1048576)) })}
          </span>
        )}
        {canWrite && (
          <span className="ml-auto">
            <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>{t("case.attachments.add")}</Button>
          </span>
        )}
      </div>
      {canWrite && (
        <>
          <input ref={input} type="file" multiple hidden data-testid="attachments-input" accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
            onChange={(e) => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <div
            role="button"
            tabIndex={0}
            data-testid="attachments-drop"
            data-over={over || undefined}
            onClick={() => input.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(Array.from(e.dataTransfer.files)); }}
            className={`flex min-h-[72px] cursor-pointer items-center justify-center border border-dashed px-3 text-center text-sm text-[oklch(var(--color-ink-muted))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--color-focus))] ${over ? "border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-2))]" : "border-[oklch(var(--color-line-strong))]"}`}
          >
            {t("case.attachments.drop")} · {t("case.attachments.limit")}
          </div>
        </>
      )}
      {q.isLoading ? (
        <PageSpinner />
      ) : q.isError ? (
        <QueryError onRetry={() => void q.refetch()} />
      ) : items.length === 0 && local.length === 0 ? (
        <EmptyState title={t("case.attachments.empty")} />
      ) : (
        <ul className="flex flex-col">
          {items.map((a) => (
            <li key={a.id} data-testid={`attachment-${a.id}`} className="flex min-h-16 flex-wrap items-center gap-3 border-t border-[oklch(var(--color-line))] py-2">
              <button type="button" onClick={() => setPreview(a)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                <Tile>{kindTile(a.content_type)}</Tile>
                <span className="flex min-w-0 flex-col">
                  <span className="break-words font-medium text-[oklch(var(--color-ink))]">{a.name}</span>
                  <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{formatBytes(a.byte_size)}</span>
                </span>
              </button>
              <span className="w-28 text-sm"><DomainText value={a.uploader_name} /></span>
              <span className="w-40 font-mono text-sm">{formatDateTime(a.created_at)}</span>
              <span className="flex justify-end gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => void download(a)}>{t("case.attachments.download")}</Button>
                {canWrite && a.can_delete && <Button type="button" variant="ghost" size="sm" onClick={() => setAsking(a)}>{t("common.delete")}</Button>}
              </span>
              {rowError[a.id] && <p role="alert" className="basis-full text-xs text-[oklch(var(--color-danger))]">{rowError[a.id]}</p>}
            </li>
          ))}
          {local.map((r) => (
            <li key={`l${r.key}`} data-testid={`upload-${r.key}`} data-state={r.state} className={`flex min-h-16 items-center gap-3 border-t border-[oklch(var(--color-line))] py-2 ${r.state === "failed" ? "text-[oklch(var(--color-danger))]" : ""}`}>
              <Tile danger={r.state === "failed"}>{r.state === "failed" ? "!" : "…"}</Tile>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={`break-words ${r.state === "failed" ? "font-semibold" : "font-medium"}`}>{r.name}</span>
                {r.state === "failed" ? (
                  <span role="alert" className="text-xs">{r.message}</span>
                ) : (
                  <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.progress * 100)} aria-label={r.name} className="block h-1 bg-[oklch(var(--color-line))]">
                    <span className="block h-1 bg-[oklch(var(--color-ink))]" style={{ width: `${Math.round(r.progress * 100)}%` }} />
                  </span>
                )}
              </span>
              {r.state === "uploading" && <span className="text-sm text-[oklch(var(--color-ink-muted))]">{t("case.attachments.uploading", { pct: String(Math.round(r.progress * 100)) })}</span>}
              <span className="flex justify-end gap-1">
                {r.state === "uploading" && <Button type="button" variant="ghost" size="sm" onClick={() => controllers.current.get(r.key)?.abort()}>{t("common.cancel")}</Button>}
                {r.state === "failed" && r.retryable && <Button type="button" variant="ghost" size="sm" onClick={() => void send(r.key)}>{t("common.retry")}</Button>}
                {r.state === "failed" && <Button type="button" variant="ghost" size="sm" onClick={() => drop(r.key)}>{t("case.attachments.remove")}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        isOpen={asking !== null}
        title={t("case.attachments.delete_title")}
        message={asking ? t("case.attachments.delete_body", { name: asking.name }) : ""}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        confirmLoading={del.isPending}
        onConfirm={confirmDelete}
        onCancel={() => setAsking(null)}
      />
      <AttachmentPreview judgmentId={judgmentId} attachment={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

function Tile({ children, danger }: { children: string; danger?: boolean }) {
  return (
    <span aria-hidden className={`flex size-12 shrink-0 items-center justify-center border font-mono text-2xs ${danger ? "border-[oklch(var(--color-danger))] font-bold" : "border-[oklch(var(--color-line))]"}`}>
      {children}
    </span>
  );
}

/** 右侧抽屉:图片直接看,PDF 交给浏览器内置的阅读器。地址 10 分钟有效,每次打开现取。 */
function AttachmentPreview({ judgmentId, attachment, onClose }: { judgmentId: string; attachment: CaseAttachment | null; onClose: () => void }) {
  const { t } = useI18n();
  const id = attachment?.id ?? "";
  const link = useQuery({
    queryKey: [...judgmentKeys.attachments(judgmentId), "link", id],
    queryFn: () => judgmentApi.attachmentLink(judgmentId, id),
    enabled: id !== "",
    gcTime: 0,
    staleTime: 0,
  });
  const src = link.data ? mediaUrl(link.data.url) : null;
  return (
    <Drawer isOpen={attachment !== null} onClose={onClose} title={attachment?.name ?? ""} error={link.isError ? t("case.attachments.preview_failed") : undefined}>
      <div data-testid="attachment-preview" className="flex h-full min-h-0 flex-col gap-3 p-4">
        {!src ? (
          link.isError ? null : <PageSpinner />
        ) : attachment && isPdf(attachment.content_type) ? (
          <iframe title={attachment.name} src={src} className="min-h-[60vh] w-full flex-1 border border-[oklch(var(--color-line))]" />
        ) : (
          <img src={src} alt={attachment?.name ?? ""} className="max-h-full max-w-full object-contain" />
        )}
        {src && (
          <a href={src} target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-2 text-[oklch(var(--color-ink-muted))]">
            {t("case.attachments.open_tab")}
          </a>
        )}
      </div>
    </Drawer>
  );
}
