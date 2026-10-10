"use client";

import { useRef, useState } from "react";
import {
  useExportPermissionConfig,
  useImportPermissionConfig,
} from "@soulledger/core/hooks/usePermissionMatrix";
import type { PermissionImportDocument, PermissionImportResult } from "@soulledger/core/api";
import { ActionsMenu } from "@/components/ui/data-grid/ActionsMenu";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Modal } from "@/src/components/ui/Modal";
import { saveBlob } from "@/src/lib/saveBlob";

/**
 * 「导出配置 / 导入配置…」(后端 apps/perm/export.py,两个接口都只许 ADMIN)。
 *
 * 入口在工具条最右边的「更多 ⋯」菜单里(ActionsMenu),两项:导出配置 / 导入配置…。
 * 导入**只做合并**(`overwrite=false`,由 `permApi.importConfig` 固定):界面上没有覆盖选项。
 * 导入是一个弹层里的三步(标题「导入配置 · n/3」):
 *   1 选文件(客户端校验 JSON / 大小 / 顶层结构)→ 2 摘要(后端 `dry_run` 预演:跑完整合并再回滚,
 *   什么都没写)→ 确认 → 3 结果(真导入返回的 stats;有跳过项时可下载跳过明细)。
 * 合并模式不更新任何行,「更新」恒为 0,照设计稿仍显示这一行。
 * 导出文件里没有殿(租户)标识 —— Permission / Role 两张表是全局的 —— 所以摘要第一行只写
 * 文件名与当前殿名,不做「来自别的殿」的提醒。
 */

/** 导出文件的上限。真实导出远小于此(几十 KB);更大的多半不是这份文件。 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const SECTIONS = ["permissions", "roles", "role_permissions", "field_permissions", "data_scopes"] as const;
type Section = (typeof SECTIONS)[number];
type Counts = Record<Section, number>;
type Step = 1 | 2 | 3;
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
  // `overwrite` / `dry_run` are never forwarded: the document is the file minus those keys.
  const { overwrite: _ignored, dry_run: _ignoredDry, ...document } = body;
  void _ignored;
  void _ignoredDry;
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

type Stats = PermissionImportResult["stats"];

/** 各段相加:新增 / 跳过。合并模式不更新,所以没有 updated。 */
export function totals(stats: Stats): { created: number; skipped: number } {
  return SECTIONS.reduce(
    (sum, k) => ({ created: sum.created + stats[k].created, skipped: sum.skipped + stats[k].skipped }),
    { created: 0, skipped: 0 },
  );
}

/** 跳过明细的文件内容:CSV,三列 section,key,reason(reason 是后端的代码,不翻译,方便筛)。 */
export function skippedCsv(details: Stats["skipped_details"]): string {
  const cell = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return ["section,key,reason", ...details.map((d) => [d.section, d.key, d.reason].map(cell).join(","))].join("\r\n");
}

/** 摘要与结果共用的三行定义表;数字等宽、右对齐。 */
function CountTable({ rows }: { rows: { label: string; value: number }[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-[oklch(var(--color-ink-muted))]">{r.label}</dt>
          <dd className="text-right font-mono tabular-nums text-[oklch(var(--color-ink))]">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PermissionConfigTransfer() {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const exporter = useExportPermissionConfig();
  const importer = useImportPermissionConfig();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<{ document: PermissionImportDocument; counts: Counts } | null>(null);
  const [fileError, setFileError] = useState<ConfigFileError | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // 第 2 步显示预演的 stats,第 3 步显示真导入的 stats。
  const [stats, setStats] = useState<Stats | null>(null);

  // 后端只许 ADMIN;这里同一条件,不显示一个注定 403 的入口。
  if (user?.role !== "ADMIN") return null;

  const maxLabel = `${MAX_IMPORT_BYTES / 1024 / 1024} MB`;
  const tenantCode = user.tenant?.code ?? "tenant";
  const day = new Date().toISOString().slice(0, 10);
  const hall = user.tenant?.display_name ?? tenantCode;

  const doExport = () =>
    exporter.mutate(undefined, {
      onSuccess: (blob) =>
        saveBlob(blob as BlobPart, `permissions_${tenantCode}_${day}.json`, "application/json;charset=utf-8"),
      onError: () => showToast(t("permissions.config.export_error"), "error"),
    });

  const reset = () => {
    setStep(1);
    setFileName("");
    setParsed(null);
    setFileError(null);
    setFailure(null);
    setStats(null);
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

  const run = (dryRun: boolean) => {
    if (!parsed) return;
    setFailure(null);
    importer.mutate(
      { document: parsed.document, dryRun },
      {
        onSuccess: (data) => {
          setStats(data.stats);
          setStep(dryRun ? 2 : 3);
        },
        onError: (error) => setFailure(backendReason(error) ?? t("permissions.config.reason_unknown")),
      },
    );
  };

  const downloadSkipped = () => {
    if (stats) saveBlob(`﻿${skippedCsv(stats.skipped_details)}`, `permissions_skipped_${tenantCode}_${day}.csv`);
  };

  const sum = stats ? totals(stats) : null;
  const tense = step === 3 ? "did" : "will";

  return (
    <>
      <ActionsMenu
        menuLabel={t("permissions.config.more")}
        items={[
          {
            key: "export",
            label: exporter.isPending ? t("permissions.config.exporting") : t("permissions.config.export"),
            onSelect: doExport,
            disabled: exporter.isPending,
          },
          { key: "import", label: t("permissions.config.import"), onSelect: () => setOpen(true) },
        ]}
      />

      <Modal
        isOpen={open}
        onClose={close}
        title={t("permissions.config.import_title", { step: String(step) })}
        dismissOnOutsideClick={false}
        footer={
          <div className="flex justify-end gap-2">
            {step !== 3 && (
              <Button type="button" variant="ghost" onClick={close} disabled={importer.isPending}>
                {t("common.cancel")}
              </Button>
            )}
            {step === 1 && (
              <Button type="button" variant="primary" onClick={() => run(true)} disabled={!parsed} loading={importer.isPending}>
                {importer.isPending ? t("permissions.config.checking") : t("permissions.config.next")}
              </Button>
            )}
            {step === 2 && (
              <Button type="button" variant="primary" onClick={() => run(false)} loading={importer.isPending}>
                {importer.isPending ? t("permissions.config.importing") : t("permissions.config.confirm")}
              </Button>
            )}
            {step === 3 && (
              <Button type="button" variant="primary" onClick={close}>
                {t("permissions.config.done")}
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {step === 1 && (
            <>
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
                <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={importer.isPending}>
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
            </>
          )}

          {step !== 1 && sum && (
            <>
              <p className="text-sm text-[oklch(var(--color-ink))]">
                <span className="font-mono">{fileName}</span> · {hall}
              </p>
              <CountTable
                rows={[
                  { label: t(`permissions.config.${tense}.add`), value: sum.created },
                  { label: t(`permissions.config.${tense}.update`), value: 0 },
                  { label: t(`permissions.config.${tense}.skip`), value: sum.skipped },
                ]}
              />
              {step === 3 && sum.skipped > 0 && (
                <button
                  type="button"
                  onClick={downloadSkipped}
                  className="w-fit text-sm underline text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
                >
                  {t("permissions.config.download_skipped")}
                </button>
              )}
            </>
          )}

          {failure && (
            <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t("permissions.config.import_error", { reason: failure })}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
