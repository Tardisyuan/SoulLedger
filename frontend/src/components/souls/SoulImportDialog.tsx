"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useSoulImportCommit, useSoulImportPreview } from "@soulledger/core/hooks/useSouls";
import {
  SOUL_IMPORT_COLUMNS,
  SOUL_IMPORT_FILE_CODES,
  SOUL_IMPORT_ROW_CODES,
  soulImportFileErrorOf,
  soulImportRowsRefusalOf,
  type SoulImportFileError,
  type SoulImportPreview,
  type SoulImportRow,
} from "@soulledger/core/api";
import { CIVILIZATION_OPTIONS } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { Modal } from "@/src/components/ui/Modal";

/**
 * 「导入」:/souls 的 CSV 批量导入(后端 apps/souls/importer.py)。
 *
 * 两步:选文件 → 预览(`…/import/preview/`,逐行校验、不写库)→ 导入(`…/import/commit/`,
 * 全有或全无)。**只要还有一行有错误,导入按钮就是禁用的,并且在按钮旁说出原因** —— 后端提交时
 * 本来就会整份拒绝(422),这里不让人点一个必定被拒的按钮。
 *
 * 错误落在它所属的格子里,带字形 ✕ 与文字(不只靠颜色);不在表里显示的列(原籍、原名、描述)
 * 与整行的错误收在「状态」格里,带列名。
 */

/** 表里显示的列;其余列的错误并进状态格。 */
const SHOWN = ["name", "civilization", "birth_date", "death_date"] as const;

/** 模板:表头加一行示例。前置 BOM,Excel 才会按 UTF-8 打开。文明取当前账号自己的 —— 填别的会被后端拒绝。 */
export function soulImportTemplate(civilization: string): string {
  return `﻿${SOUL_IMPORT_COLUMNS.join(",")}\nExample Soul,${civilization},-612,-560-03-15,Luoyang,,\n`;
}

export function SoulImportDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useTenant();
  const { showToast } = useToast();
  const previewMutation = useSoulImportPreview();
  const commitMutation = useSoulImportCommit();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SoulImportPreview | null>(null);
  const [fileError, setFileError] = useState<SoulImportFileError | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [created, setCreated] = useState(0);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setFileError(null);
    setOnlyErrors(false);
    setBatchId(null);
    setCreated(0);
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
    setOnlyErrors(false);
    previewMutation.mutate(formOf(f), {
      onSuccess: setPreview,
      onError: (error) => setFileError(soulImportFileErrorOf(error) ?? { code: "unknown" }),
    });
  };

  const commit = () => {
    if (!file || !preview || preview.error_count > 0) return;
    commitMutation.mutate(formOf(file), {
      onSuccess: (result) => {
        setBatchId(result.batch_id);
        setCreated(result.created);
        showToast(t("souls.import.success", { n: String(result.created) }), "success");
      },
      onError: (error) => {
        const refusal = soulImportRowsRefusalOf(error);
        if (refusal) setPreview(refusal);
        else setFileError(soulImportFileErrorOf(error) ?? { code: "unknown" });
      },
    });
  };

  const downloadTemplate = () => {
    const civ = user?.tenant?.civilization ?? CIVILIZATION_OPTIONS[0];
    saveBlob(soulImportTemplate(civ), "souls_import_template.csv");
  };

  const codeText = (code: string, group: "row_codes" | "file_codes", params?: Record<string, string>) => {
    const known: readonly string[] = group === "row_codes" ? SOUL_IMPORT_ROW_CODES : SOUL_IMPORT_FILE_CODES;
    return t(`souls.import.${group}.${known.includes(code) ? code : "unknown"}`, params);
  };
  const fileErrorText = (e: SoulImportFileError) =>
    codeText(e.code, "file_codes", {
      columns: (e.columns ?? []).join(", "),
      max: String(e.max_rows ?? ""),
    });

  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.status === "error") : preview.rows) : [];
  const blocked = preview !== null && preview.error_count > 0;
  const busy = previewMutation.isPending;

  // ── success ──
  if (batchId) {
    return (
      <Modal isOpen={isOpen} onClose={close} title={t("souls.import.title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t("common.close")}</Button>
            <Link
              href={`/souls?import_batch=${encodeURIComponent(batchId)}`}
              onClick={close}
              className="inline-flex min-h-11 items-center border border-[oklch(var(--color-ink))] px-4 font-semibold text-[oklch(var(--color-ink))]"
            >
              {t("souls.import.view_batch")}
            </Link>
          </div>
        }
      >
        <p role="status" className="text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">✓ </span>
          {t("souls.import.success", { n: String(created) })}
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t("souls.import.title")}
      wide
      dismissOnOutsideClick={false}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {blocked && preview && (
            <span role="status" className="mr-auto text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t("souls.import.blocked", { n: String(preview.error_count) })}
            </span>
          )}
          <Button type="button" variant="ghost" onClick={close} disabled={commitMutation.isPending}>
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={commit}
            disabled={!preview || blocked || busy}
            loading={commitMutation.isPending}
          >
            {commitMutation.isPending
              ? t("souls.import.committing")
              : t("souls.import.commit", { n: String(preview?.ok_count ?? 0) })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
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
          <Button type="button" variant="ghost" onClick={downloadTemplate}>
            {t("souls.import.template")}
          </Button>
          {file && <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{file.name}</span>}
        </div>
        <p className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("souls.import.hint_required", { columns: "name, civilization" })}{" "}
          {t("souls.import.hint_max", { max: String(preview?.max_rows ?? 1000) })}
        </p>

        {busy && <p role="status" className="text-sm text-[oklch(var(--color-ink-muted))]">{t("souls.import.checking")}</p>}

        {fileError && (
          <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
            <span aria-hidden="true">✕ </span>
            {fileErrorText(fileError)}
          </p>
        )}

        {preview && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[oklch(var(--color-ink))]">
                {t("souls.import.summary", {
                  total: String(preview.total),
                  ok: String(preview.ok_count),
                  bad: String(preview.error_count),
                })}
              </span>
              <FilterChipToggle pressed={onlyErrors} onPressedChange={setOnlyErrors}>
                {t("souls.import.only_errors")}
              </FilterChipToggle>
            </div>
            <div className="max-h-[50dvh] overflow-auto border border-[oklch(var(--color-line))]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[oklch(var(--color-surface-1))]">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("souls.import.col_row")}</th>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("souls.import.col_status")}</th>
                    {SHOWN.map((c) => (
                      <th key={c} scope="col" className="px-2 py-1 font-mono font-semibold">{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={2 + SHOWN.length} className="px-2 py-3 text-[oklch(var(--color-ink-muted))]">
                        {t("souls.import.empty_filtered")}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <PreviewRow key={r.row} row={r} text={(code) => codeText(code, "row_codes")} t={t} />
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function PreviewRow({
  row,
  text,
  t,
}: {
  row: SoulImportRow;
  text: (code: string) => string;
  t: (key: string) => string;
}) {
  const bad = row.status === "error";
  const shown: readonly string[] = SHOWN;
  const elsewhere = row.errors.filter((e) => !shown.includes(e.field));
  return (
    <tr className="border-t border-[oklch(var(--color-line))] align-top" data-status={row.status}>
      <td className="px-2 py-1 font-mono">{row.row}</td>
      <td className="px-2 py-1 whitespace-nowrap">
        <span className={bad ? "text-[oklch(var(--color-status-error))]" : "text-[oklch(var(--color-ink-muted))]"}>
          <span aria-hidden="true">{bad ? "✕" : "✓"} </span>
          {bad ? t("souls.import.status_error") : t("souls.import.status_ok")}
        </span>
        {elsewhere.map((e) => (
          <div key={`${e.field}:${e.code}`} className="text-[oklch(var(--color-status-error))]">
            <span aria-hidden="true">✕ </span>
            <span className="font-mono">{e.field}</span> {text(e.code)}
          </div>
        ))}
      </td>
      {SHOWN.map((c) => {
        const errs = row.errors.filter((e) => e.field === c);
        return (
          <td key={c} className="px-2 py-1">
            <span className={errs.length ? "text-[oklch(var(--color-status-error))]" : undefined}>{row.values[c]}</span>
            {errs.map((e) => (
              <div key={e.code} className="text-[oklch(var(--color-status-error))]">
                <span aria-hidden="true">✕ </span>
                {text(e.code)}
              </div>
            ))}
          </td>
        );
      })}
    </tr>
  );
}
