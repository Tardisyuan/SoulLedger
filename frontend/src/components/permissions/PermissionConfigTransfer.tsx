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
import { TextField } from "@/src/components/ui/Field";
import { saveBlob } from "@/src/lib/saveBlob";

/**
 * 「导出配置 / 导入配置…」(后端 apps/perm/export.py,两个接口都只许 ADMIN)。
 *
 * 入口在工具条最右边的「更多 ⋯」菜单里(ActionsMenu),两项:导出配置 / 导入配置…。
 * 导入是一个弹层里的三步(标题「导入配置 · n/3」):
 *   1 选文件(客户端校验 JSON / 大小 / 顶层结构)→ 2 摘要(后端 `dry_run` 预演:跑完整合并再回滚,
 *   什么都没写;「上一步」回第 1 步,文件名还在)→ 确认 → 3 结果(真导入返回的 stats;有跳过项时可
 *   下载跳过明细)。
 * 第 2 步表格下面是单选「合并(默认)/ 覆盖」。**默认合并,`overwrite` 只在用户选了覆盖、并输入确认词「覆盖」
 * 之后才传 true**;切换方式就带着 `overwrite` 重新预演一次,表里的数都是后端算的。
 * 合并只有「将新增 / 将跳过」两行;选了覆盖才多出「将更新」与「将删除 N」(danger 色)。
 * 「将删除 N」是**覆盖之后不再存在的条目数**(现有 − 文件里会重建的),不是先删掉的总数;
 * 后端 `removed.total` 给出。危险提示、确认词输入框(输入「覆盖」才能点;确认词取 mode.overwrite 的当前语言文案,all_halls 紧贴其上)、danger 按钮在其下。
 * 删除名单里有调用者自己的权限(`removes_own_permissions`)时覆盖被禁止,按钮不可点并说明原因。
 * 导出文件里没有殿(租户)标识 —— Permission / Role 两张表是全局的 —— 所以摘要第一行只写
 * 文件名与当前殿名,不做「来自别的殿」的提醒;但覆盖影响所有殿,危险提示里要说。
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

/** 摘要与结果共用的定义表;数字等宽、右对齐。`danger` 行用错误色,字前带 ✕,不只靠颜色。 */
function CountTable({ rows }: { rows: { label: string; value: number; danger?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents" data-row-danger={r.danger || undefined}>
          <dt className={r.danger ? "text-[oklch(var(--color-status-error))]" : "text-[oklch(var(--color-ink-muted))]"}>
            {r.danger && <span aria-hidden="true">✕ </span>}
            {r.label}
          </dt>
          <dd
            className={`text-right font-mono tabular-nums ${r.danger ? "text-[oklch(var(--color-status-error))]" : "text-[oklch(var(--color-ink))]"}`}
          >
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Mode = "merge" | "overwrite";

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
  // 摘要对应的导入方式(= 预演时传的 overwrite)与覆盖要输入的殿名。
  const [mode, setMode] = useState<Mode>("merge");
  const [typed, setTyped] = useState("");
  // 服务器是否接受覆盖(PERM_IMPORT_OVERWRITE_ENABLED),取自预演响应的 `overwrite_enabled`。
  // 只有恰为 true 才显示「合并 / 覆盖」与其后的全部覆盖界面;缺失或 false 与纯合并模式一样,不显示一个禁用的选项。
  const [canOverwrite, setCanOverwrite] = useState(false);

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
    setMode("merge");
    setTyped("");
    setCanOverwrite(false);
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

  /** 开关在预演之后被关掉时后端答 403 `overwrite_disabled`:显示文案,并退回合并。 */
  const fail = (error: unknown) => {
    const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
    if (code === "overwrite_disabled") {
      setCanOverwrite(false);
      setMode("merge");
      setTyped("");
      setFailure(t("permissions.config.errors.overwrite_disabled"));
      return;
    }
    setFailure(backendReason(error) ?? t("permissions.config.reason_unknown"));
  };

  /** 预演某种方式:成功才切过去(表里的数是后端按这种方式算的),失败留在原来的方式上。 */
  const preview = (next: Mode) => {
    if (!parsed) return;
    setFailure(null);
    importer.mutate(
      { document: parsed.document, dryRun: true, overwrite: next === "overwrite" },
      {
        onSuccess: (data) => {
          const enabled = data.overwrite_enabled === true;
          setCanOverwrite(enabled);
          setStats(data.stats);
          setMode(enabled ? next : "merge");
          setTyped("");
          setStep(2);
        },
        onError: (error) => fail(error),
      },
    );
  };

  /** 真导入。`overwrite` 只在走完确认(覆盖方式 + 殿名 + 不含自己的权限)之后才是 true。 */
  const confirmImport = () => {
    if (!parsed || (overwriting && !overwriteAllowed)) return;
    setFailure(null);
    importer.mutate(
      { document: parsed.document, dryRun: false, overwrite: overwriting },
      {
        onSuccess: (data) => {
          setStats(data.stats);
          setStep(3);
        },
        onError: (error) => fail(error),
      },
    );
  };

  const back = () => {
    setFailure(null);
    setStats(null);
    setMode("merge");
    setTyped("");
    setStep(1);
  };

  const downloadSkipped = () => {
    if (stats) saveBlob(`﻿${skippedCsv(stats.skipped_details)}`, `permissions_skipped_${tenantCode}_${day}.csv`);
  };

  const sum = stats ? totals(stats) : null;
  const tense = step === 3 ? "did" : "will";
  const overwriting = canOverwrite && mode === "overwrite";
  const removed = stats?.removed.total ?? 0;
  const blockedOwn = overwriting && stats?.removes_own_permissions === true;
  // 确认词就是「覆盖」选项本身的当前语言文案(permissions.config.mode.overwrite),不另写一份常量;en 不分大小写。
  const confirmWord = t("permissions.config.mode.overwrite").trim();
  const wordMatches = confirmWord.length > 0 && typed.trim().toLowerCase() === confirmWord.toLowerCase();
  const overwriteAllowed = overwriting && !blockedOwn && wordMatches;

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
              <Button type="button" variant="primary" onClick={() => preview("merge")} disabled={!parsed} loading={importer.isPending}>
                {importer.isPending ? t("permissions.config.checking") : t("permissions.config.next")}
              </Button>
            )}
            {step === 2 && (
              <Button type="button" variant="secondary" onClick={back} disabled={importer.isPending}>
                {t("permissions.config.back")}
              </Button>
            )}
            {step === 2 && !overwriting && (
              <Button type="button" variant="primary" onClick={confirmImport} loading={importer.isPending}>
                {importer.isPending ? t("permissions.config.importing") : t("permissions.config.confirm")}
              </Button>
            )}
            {step === 2 && overwriting && (
              <Button
                type="button"
                variant="danger"
                data-testid="overwrite-action"
                /* 与 NameConfirmDialog 同一档:殿名对上的那一刻瞬时启用,不渐变。 */
                className="duration-instant"
                onClick={confirmImport}
                loading={importer.isPending}
                disabled={!overwriteAllowed}
              >
                <span aria-hidden="true">✕</span>
                {importer.isPending ? t("permissions.config.importing") : t("permissions.config.overwrite.action")}
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
                  // 合并不更新任何行,这一行只在覆盖时出现(Design 第十六批)。
                  ...(overwriting ? [{ label: t(`permissions.config.${tense}.update`), value: stats?.updated ?? 0 }] : []),
                  { label: t(`permissions.config.${tense}.skip`), value: sum.skipped },
                  ...(overwriting ? [{ label: t(`permissions.config.${tense}.remove`), value: removed, danger: true }] : []),
                ]}
              />
              {step === 2 && (
                <>
                  {canOverwrite && (
                    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 p-0" disabled={importer.isPending}>
                      <legend className="sr-only">{t("permissions.config.mode.label")}</legend>
                      <span aria-hidden="true" className="text-xs text-[oklch(var(--color-ink-muted))]">
                        {t("permissions.config.mode.label")}
                      </span>
                      {(["merge", "overwrite"] as const).map((m) => (
                        <label key={m} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-[oklch(var(--color-ink))]">
                          <input
                            type="radio"
                            name="import-mode"
                            value={m}
                            checked={mode === m}
                            onChange={() => preview(m)}
                          />
                          {t(`permissions.config.mode.${m}`)}
                        </label>
                      ))}
                    </fieldset>
                  )}
                  {overwriting && (
                    <div className="flex flex-col gap-3" data-testid="overwrite-warning">
                      <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
                        <span aria-hidden="true">✕ </span>
                        {t(blockedOwn ? "permissions.config.overwrite.warning_own" : "permissions.config.overwrite.warning", {
                          n: String(removed),
                        })}
                      </p>
                      <p className="text-sm text-[oklch(var(--color-status-error))]">
                        {t("permissions.config.overwrite.all_halls", { hall })}
                      </p>
                      {blockedOwn ? (
                        <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
                          {t("permissions.config.overwrite.blocked_own")}
                        </p>
                      ) : (
                        <TextField
                          label={t("permissions.config.overwrite.confirm_hint")}
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          disabled={importer.isPending}
                        />
                      )}
                    </div>
                  )}
                </>
              )}
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
