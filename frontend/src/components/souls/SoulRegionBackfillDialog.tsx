"use client";

import { useRef, useState, type ReactNode } from "react";
import { useSoulRegionUpdateCommit, useSoulRegionUpdatePreview } from "@soulledger/core/hooks/useSouls";
import {
  SOUL_IMPORT_FILE_CODES,
  soulImportFileErrorOf,
  type SoulImportFileError,
  type SoulRegionUpdatePreview,
  type SoulRegionUpdateRow,
} from "@soulledger/core/api";
import { originRegionLabel } from "@soulledger/core/domain/originRegion";
import { useI18n } from "@/src/contexts/I18nContext";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { IdentifierChip, MissingValue } from "@/src/components/ui/DomainValue";
import { Modal } from "@/src/components/ui/Modal";

/**
 * 「补录出身地域」(Design 第四十六批 W-1..W-5):按 CSV 批量改已有灵魂的 `origin_region`
 * (后端 apps/souls/region_update.py,`soul.update`)。自己的弹层,不是导入弹层的页签。
 *
 * 三步:选文件 → 预览(`…/region-update/preview/`,不写库)→ 完成(`…/commit/`)。和导入不同,
 * **有问题的行不拦确认,只跳过**;没有能更新的行时确认按钮灰掉,原因写在计数下面,不弹错。
 * 文件级错误复用 `souls.import.file_codes.*`,只多一条「两种标识列都有」。
 */

/** 模板只写 soul_id(Design):导出文件第一列就是它。前置 BOM,Excel 才按 UTF-8 打开。 */
export const REGION_BACKFILL_TEMPLATE = "﻿soul_id,origin_region\n";

const SKIPPED = new Set(["missing_identifier", "not_found", "duplicate_in_file", "invalid_origin_region"]);

type T = (key: string, params?: Record<string, string>) => string;

/** 行状态 → 结果一格的文案。缺标识的行与找不到同说(Design 只给了五种)。 */
export function regionRowResult(t: T, row: SoulRegionUpdateRow): string {
  switch (row.status) {
    case "ok":
      return t("souls.region_backfill.status.update");
    case "unchanged":
      return t("souls.region_backfill.status.same");
    case "invalid_origin_region":
      return t("souls.region_backfill.status.bad_value");
    case "duplicate_in_file":
      return t("souls.region_backfill.status.duplicate", { row: String(row.duplicate_of ?? "") });
    default:
      return t("souls.region_backfill.status.not_found");
  }
}

/** 文件级 400 → 文案。后端在导入的码之外只多两条:`missing_id_column` / `mixed_id_columns`。缺标识列借导入的「缺少必填列」,列名写成「soul_id / soul_code」(二选一)。 */
export function regionFileErrorText(t: T, e: SoulImportFileError): string {
  const columns = (e.columns ?? []).join(e.code === "missing_id_column" ? " / " : ", ");
  if (e.code === "missing_id_column") return t("souls.import.file_codes.missing_columns", { columns });
  if (e.code === "mixed_id_columns") return t("souls.region_backfill.file_codes.mixed_id_columns");
  const known: readonly string[] = SOUL_IMPORT_FILE_CODES;
  return t(`souls.import.file_codes.${known.includes(e.code) ? e.code : "unknown"}`, {
    columns,
    max: String(e.max_rows ?? ""),
  });
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** 跳过的行:和模板同样两列(标识列照文件里用的那一种),另加一列原因;改好能直接再传(后端忽略多余列)。 */
export function skippedRowsCsv(t: T, rows: readonly SoulRegionUpdateRow[]): string {
  const idColumn = Object.keys(rows[0]?.values ?? {}).find((k) => k !== "origin_region") ?? "soul_id";
  const lines = rows.map((r) =>
    [r.values[idColumn] ?? "", r.values["origin_region"] ?? "", regionRowResult(t, r)].map(csvCell).join(","),
  );
  return `﻿${idColumn},origin_region,reason\n${lines.map((l) => `${l}\n`).join("")}`;
}

export function SoulRegionBackfillDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const previewMutation = useSoulRegionUpdatePreview();
  const commitMutation = useSoulRegionUpdateCommit();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SoulRegionUpdatePreview | null>(null);
  const [fileError, setFileError] = useState<SoulImportFileError | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [commitFailed, setCommitFailed] = useState(false);
  const [done, setDone] = useState<{ updated: number; unchanged: number; skipped: SoulRegionUpdateRow[] } | null>(
    null,
  );

  const reset = () => {
    setFile(null);
    setPreview(null);
    setFileError(null);
    setOnlyProblems(false);
    setCommitFailed(false);
    setDone(null);
    if (input.current) input.current.value = "";
  };
  const close = () => {
    if (commitMutation.isPending) return;
    reset();
    onClose();
  };
  const formOf = (f: File) => {
    const form = new FormData();
    form.append("file", f);
    return form;
  };

  const choose = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setFileError(null);
    setOnlyProblems(false);
    setCommitFailed(false);
    previewMutation.mutate(formOf(f), {
      onSuccess: setPreview,
      onError: (error) => setFileError(soulImportFileErrorOf(error) ?? { code: "unknown" }),
    });
  };

  const commit = () => {
    if (!file || !preview || preview.changed_count === 0) return;
    setCommitFailed(false);
    commitMutation.mutate(formOf(file), {
      onSuccess: (r) => setDone({ updated: r.updated, unchanged: r.unchanged, skipped: r.rows }),
      onError: () => setCommitFailed(true), // 一个事务:没有改动任何灵魂,留在第 2 步
    });
  };

  const back = () => {
    setPreview(null);
    setFile(null);
    setCommitFailed(false);
    if (input.current) input.current.value = "";
  };

  const downloadTemplate = () => saveBlob(REGION_BACKFILL_TEMPLATE, "souls_origin_region_template.csv");
  const label = (v: string | null | undefined) => originRegionLabel(t, v, locale);
  const step = done ? 3 : preview ? 2 : 1;
  const title = t("souls.region_backfill.title", { step: String(step) });
  const templateLink = (
    <button type="button" onClick={downloadTemplate} className="underline underline-offset-2">
      {t("souls.import.template")}
    </button>
  );

  // ── 3 · 完成 ──
  if (done) {
    const k = done.skipped.length;
    return (
      <Modal isOpen={isOpen} onClose={close} title={title}
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="primary" onClick={close}>{t("permissions.config.done")}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p role="status" className="text-md font-semibold text-[oklch(var(--color-ink))]">
            {t("souls.region_backfill.done", {
              updated: String(done.updated),
              same: String(done.unchanged),
              skipped: String(k),
            })}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[oklch(var(--color-ink))]" data-testid="region-done-links">
            {k > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => saveBlob(skippedRowsCsv(t, done.skipped), "souls_origin_region_skipped.csv")}
                  className="font-semibold underline underline-offset-2"
                >
                  {t("souls.region_backfill.download_skipped")}
                </button>
                <span aria-hidden="true">·</span>
              </>
            )}
            {templateLink}
          </div>
          {k > 0 && (
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.region_backfill.skipped_file_note")}</p>
          )}
        </div>
      </Modal>
    );
  }

  // ── 2 · 预览 ──
  if (preview) {
    const nothing = preview.changed_count === 0;
    const rows = onlyProblems ? preview.rows.filter((r) => SKIPPED.has(r.status)) : preview.rows;
    return (
      <Modal isOpen={isOpen} onClose={close} title={title} wide dismissOnOutsideClick={false}
        footer={
          <div className="flex flex-wrap items-center justify-end gap-3">
            {commitFailed && (
              <span role="alert" className="mr-auto text-sm text-[oklch(var(--color-status-error))]">
                {t("souls.region_backfill.failed")}
              </span>
            )}
            <Button type="button" variant="ghost" onClick={back} disabled={commitMutation.isPending}>
              {t("souls.region_backfill.back")}
            </Button>
            <Button type="button" variant="primary" onClick={commit} disabled={nothing} loading={commitMutation.isPending}>
              {commitMutation.isPending
                ? t("souls.region_backfill.committing")
                : t("souls.region_backfill.commit", { n: String(preview.changed_count) })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {file && <p className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{file.name}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-[oklch(var(--color-ink))]">
              {t("souls.region_backfill.summary", {
                total: String(preview.total),
                update: String(preview.changed_count),
                same: String(preview.unchanged_count),
                skip: String(preview.skipped_count),
              })}
            </span>
            <span className="ml-auto">
              <FilterChipToggle pressed={onlyProblems} onPressedChange={setOnlyProblems}>
                {t("souls.import.only_errors")}
              </FilterChipToggle>
            </span>
          </div>
          <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.region_backfill.skip_note")}</p>
          {preview.clears_count > 0 && (
            <p className="text-sm font-semibold text-[oklch(var(--color-ink))]">
              {t("souls.region_backfill.to_unknown", { n: String(preview.clears_count), unknown: label("") })}
            </p>
          )}
          {nothing && (
            <div role="status" className="bg-[oklch(var(--color-surface-2))] px-3 py-2 text-sm">
              <p className="font-semibold text-[oklch(var(--color-ink))]">{t("souls.region_backfill.nothing_title")}</p>
              <p className="text-[oklch(var(--color-ink-muted))]">{t("souls.region_backfill.nothing_body")}</p>
            </div>
          )}
          <div className="max-h-[50dvh] overflow-auto border border-[oklch(var(--color-line))]">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-[oklch(var(--color-surface-1))] text-xs text-[oklch(var(--color-ink-muted))]">
                <tr>
                  <th scope="col" className="w-14 px-2 py-2 font-normal">{t("souls.import.col_row")}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{t("souls.region_backfill.col_name")}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{t("souls.region_backfill.col_change")}</th>
                  <th scope="col" className="px-2 py-2 font-normal">{t("souls.import.col_status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <RegionRow key={r.row} row={r} t={t} label={label} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    );
  }

  // ── 1 · 选文件 ──
  const busy = previewMutation.isPending;
  return (
    <Modal isOpen={isOpen} onClose={close} title={title} dismissOnOutsideClick={false}
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="ghost" onClick={close}>{t("common.cancel")}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("souls.region_backfill.intro")}</p>
        <div className="flex flex-wrap items-center gap-2 border border-dashed border-[oklch(var(--color-line))] p-4">
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label={t("souls.import.choose_file")}
            className="sr-only"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            {t("souls.import.choose_file")}
          </Button>
          <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("souls.import.hint_max", { max: "1000" })}</span>
          {file && <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{file.name}</span>}
        </div>
        {busy && <p role="status" className="text-sm text-[oklch(var(--color-ink-muted))]">{t("souls.import.checking")}</p>}
        {fileError && (
          <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
            {regionFileErrorText(t, fileError)}
          </p>
        )}
        <ul className="flex flex-col gap-1 text-xs text-[oklch(var(--color-ink-muted))]">
          <li>{t("souls.import.hint_required", { columns: "soul_id, origin_region" })}</li>
          <li>{t("souls.region_backfill.id_hint")}</li>
          <li>
            {t("souls.region_backfill.values_hint", { europe: label("EUROPE"), asia: label("ASIA"), unknown: label("") })}
          </li>
        </ul>
        <p className="text-sm text-[oklch(var(--color-ink))]">{templateLink}</p>
      </div>
    </Modal>
  );
}

function RegionRow({ row, t, label }: { row: SoulRegionUpdateRow; t: T; label: (v: string | null | undefined) => string }) {
  const skipped = SKIPPED.has(row.status);
  const raw = row.values["origin_region"] ?? "";
  let change: ReactNode;
  if (row.status === "ok") change = `${label(row.old)} → ${label(row.new)}`;
  else if (row.status === "unchanged") change = label(row.new);
  else if (row.status === "invalid_origin_region" && row.old !== null) {
    change = (
      <>
        {label(row.old)} → 「<span className="font-mono">{raw}</span>」
      </>
    );
  } else change = <MissingValue kind="unrecorded" />;
  return (
    <tr
      data-status={row.status}
      className={`h-12 border-t border-[oklch(var(--color-line))] ${
        row.status === "unchanged" ? "text-[oklch(var(--color-ink-muted))]" : "text-[oklch(var(--color-ink))]"
      }`}
    >
      <td className="px-2 font-mono text-sm">{row.row}</td>
      <td className="max-w-0 px-2">
        <span className="flex min-w-0 items-center gap-2">
          {row.identifier ? <IdentifierChip id={row.identifier} variant="inline" /> : <MissingValue kind="unrecorded" />}
          {row.soul_name ? (
            <span className="truncate" title={row.soul_name}>{row.soul_name}</span>
          ) : (
            <MissingValue kind="unrecorded" />
          )}
        </span>
      </td>
      <td className={`px-2 ${row.clears_value ? "font-semibold" : ""}`} data-clears={row.clears_value || undefined}>
        {change}
      </td>
      <td className={`px-2 ${skipped ? "font-medium text-[oklch(var(--color-status-error))]" : ""}`}>
        {regionRowResult(t, row)}
      </td>
    </tr>
  );
}
