"use client";

import { useRef, useState } from "react";
import {
  useExportPermissionConfig,
  useImportPermissionConfig,
} from "@soulledger/core/hooks/usePermissionMatrix";
import type { PermissionImportDocument, PermissionImportResult } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { saveBlob } from "@/src/lib/saveBlob";

/**
 * 「导出配置 / 导入配置」(后端 apps/perm/export.py,两个接口都只许 ADMIN)。
 *
 * 导入**只做合并**(`overwrite=false`,由 `permApi.importConfig` 固定):界面上没有覆盖选项。
 * 流程:选文件 → 客户端校验(JSON / 大小 / 顶层结构)→ 条目数摘要 → 确认 → 调接口 → 显示后端回的 stats。
 * 后端的 stats 只数「新增」,不区分更新 / 跳过,所以这里也只写「新增」。
 */

/** 导出文件的上限。真实导出远小于此(几十 KB);更大的多半不是这份文件。 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const SECTIONS = ["permissions", "roles", "role_permissions", "field_permissions", "data_scopes"] as const;
type Section = (typeof SECTIONS)[number];
type Counts = Record<Section, number>;
export type ConfigFileError = "not_json" | "too_large" | "bad_structure" | "empty";

/** 纯函数:文本 → 文档与各段条目数,或一个错误码。 */
export function parsePermissionConfig(
  text: string,
  size: number,
): { document: PermissionImportDocument; counts: Counts } | { error: ConfigFileError } {
  if (size > MAX_IMPORT_BYTES) return { error: "too_large" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "not_json" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { error: "bad_structure" };
  const body = parsed as Record<string, unknown>;
  const present = SECTIONS.filter((k) => k in body);
  if (present.length === 0 || present.some((k) => !Array.isArray(body[k]))) return { error: "bad_structure" };
  const counts = Object.fromEntries(
    SECTIONS.map((k) => [k, Array.isArray(body[k]) ? (body[k] as unknown[]).length : 0]),
  ) as Counts;
  if (SECTIONS.every((k) => counts[k] === 0)) return { error: "empty" };
  // `overwrite` is never forwarded: the document is the file minus that key.
  const { overwrite: _ignored, ...document } = body;
  void _ignored;
  return { document: document as PermissionImportDocument, counts };
}

/** 后端的 400 有两种形状:`{error: "..."}` 或序列化器的 `{field: [msgs]}`。 */
export function backendReason(error: unknown): string | null {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const flat = Object.entries(data as Record<string, unknown>).map(([k, v]) =>
      k === "error" || k === "detail" ? String(v) : `${k}: ${JSON.stringify(v)}`,
    );
    return flat.length ? flat.join("; ") : null;
  }
  return null;
}

export function PermissionConfigTransfer() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const exporter = useExportPermissionConfig();
  const importer = useImportPermissionConfig();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{ document: PermissionImportDocument; counts: Counts } | null>(null);
  const [fileError, setFileError] = useState<ConfigFileError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<PermissionImportResult | null>(null);

  // 后端只许 ADMIN;这里同一条件,不显示一个注定 403 的按钮。
  if (user?.role !== "ADMIN") return null;

  const maxLabel = `${MAX_IMPORT_BYTES / 1024 / 1024} MB`;

  const doExport = () =>
    exporter.mutate(undefined, {
      onSuccess: (blob) => {
        const tenant = user.tenant?.code ?? "tenant";
        const day = new Date().toISOString().slice(0, 10);
        saveBlob(blob as BlobPart, `permissions_${tenant}_${day}.json`, "application/json;charset=utf-8");
      },
      onError: () => showToast(t("permissions.config.export_error"), "error"),
    });

  const reset = () => {
    setFileName("");
    setParsed(null);
    setFileError(null);
    setFailure(null);
    setResult(null);
    if (input.current) input.current.value = "";
  };
  const close = () => {
    if (importer.isPending) return;
    reset();
    setOpen(false);
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    // 超限的文件不读进内存。
    const outcome = parsePermissionConfig(file.size > MAX_IMPORT_BYTES ? "" : await file.text(), file.size);
    if ("error" in outcome) setFileError(outcome.error);
    else setParsed(outcome);
  };

  const confirm = () => {
    if (!parsed) return;
    setFailure(null);
    importer.mutate(parsed.document, {
      onSuccess: (data) => setResult(data),
      onError: (error) => setFailure(backendReason(error) ?? t("permissions.config.reason_unknown")),
    });
  };

  const c = parsed?.counts;
  const stats = result?.stats;

  return (
    <>
      <Button type="button" variant="secondary" onClick={doExport} loading={exporter.isPending}>
        {exporter.isPending ? t("permissions.config.exporting") : t("permissions.config.export")}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {t("permissions.config.import")}
      </Button>

      <Modal
        isOpen={open}
        onClose={close}
        title={t("permissions.config.import_title")}
        dismissOnOutsideClick={false}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close} disabled={importer.isPending}>
              {t("common.close")}
            </Button>
            {!result && (
              <Button type="button" variant="primary" onClick={confirm} disabled={!parsed} loading={importer.isPending}>
                {importer.isPending ? t("permissions.config.importing") : t("permissions.config.confirm")}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.config.merge_note")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              aria-label={t("permissions.config.choose_file")}
              className="sr-only"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={importer.isPending || !!result}>
              {t("permissions.config.choose_file")}
            </Button>
            {fileName && <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{fileName}</span>}
          </div>
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("permissions.config.file_hint", { max: maxLabel })}</p>

          {fileError && (
            <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t(`permissions.config.errors.${fileError}`, { max: maxLabel })}
            </p>
          )}

          {c && !result && (
            <p role="status" className="text-sm text-[oklch(var(--color-ink))]">
              {t("permissions.config.summary", {
                permissions: String(c.permissions),
                roles: String(c.roles),
                role_permissions: String(c.role_permissions),
                field_permissions: String(c.field_permissions),
                data_scopes: String(c.data_scopes),
              })}
            </p>
          )}

          {failure && (
            <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t("permissions.config.import_error", { reason: failure })}
            </p>
          )}

          {stats && (
            <p role="status" className="text-sm text-[oklch(var(--color-ink))]">
              <span aria-hidden="true">✓ </span>
              {t("permissions.config.result", {
                permissions: String(stats.permissions),
                roles: String(stats.roles),
                role_permissions: String(stats.role_permissions),
                field_permissions: String(stats.field_permissions),
                data_scopes: String(stats.data_scopes),
              })}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
