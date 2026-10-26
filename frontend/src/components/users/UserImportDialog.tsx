"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  userImportFileErrorOf,
  type UserImportFileError,
  type UserImportPreview,
} from "@soulledger/core/api";
import { useUserImportCommit, useUserImportPreview } from "@soulledger/core/hooks/useUsers";
import { useI18n } from "@/src/contexts/I18nContext";
import { saveBlob } from "@/src/lib/saveBlob";
import { Button } from "@/src/components/ui/Button";
import { FilterChipToggle } from "@/src/components/ui/FilterChip";
import { Modal } from "@/src/components/ui/Modal";

/**
 * 「导入 CSV」:/users 的用户批量导入(第三十四批 W-5)。版式沿用灵魂档案导入
 * (`SoulImportDialog`):三步(选文件 → 预览 → 结果)、编码提示、逐行清单、「上一步」。
 * 只换三处:预览表的列(行 · 用户名 · 姓名 · 问题)、模板的列说明、结果页的后续动作。
 *
 * 密码列由管理员在文件里设定,对方第一次登录必须先改(后端 `must_change_password`)。
 * 预览表**从不显示密码**;缺密码或不合规则,和别的校验错误一样落在那一行的「问题」里。
 * 只要还有一行有问题,导入按钮就是禁用的 —— 后端按行各自提交,这里要求整份干净才放行。
 */

export const USER_IMPORT_COLUMNS = ["username", "password", "role", "email", "display_name"] as const;
const FILE_CODES = ["bad_encoding", "empty_file", "missing_columns"] as const;

/** 模板:表头加一行示例。前置 BOM,Excel 才会按 UTF-8 打开。 */
export function userImportTemplate(): string {
  return `﻿${USER_IMPORT_COLUMNS.join(",")}\nexample_user,ChangeMe-12345,VIEWER,example@example.com,Example Name\n`;
}

export function UserImportDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const previewMutation = useUserImportPreview();
  const commitMutation = useUserImportCommit();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UserImportPreview | null>(null);
  const [fileError, setFileError] = useState<UserImportFileError | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const [created, setCreated] = useState<{ created: number; invited: number } | null>(null);
  const [commitFailed, setCommitFailed] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setFileError(null);
    setOnlyErrors(false);
    setCreated(null);
    setCommitFailed(false);
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
    setCommitFailed(false);
    previewMutation.mutate(formOf(f), {
      onSuccess: setPreview,
      onError: (error) => setFileError(userImportFileErrorOf(error) ?? { code: "unknown" }),
    });
  };

  const commit = () => {
    if (!file || !preview || preview.error_count > 0) return;
    setCommitFailed(false);
    commitMutation.mutate(formOf(file), {
      onSuccess: (result) => {
        if (result.errors.length > 0) setCommitFailed(true);
        setCreated({ created: result.created, invited: result.invited ?? 0 });
      },
      onError: () => setCommitFailed(true),
    });
  };

  const fileErrorText = (e: UserImportFileError) => {
    const known: readonly string[] = FILE_CODES;
    return t(`souls.import.file_codes.${known.includes(e.code) ? e.code : "unknown"}`, {
      columns: (e.columns ?? []).join(", "),
    });
  };
  const rowText = (code: string) => {
    const known = [
      "username_required", "email_invalid", "role_invalid", "username_taken",
      "email_taken", "password_required", "password_weak",
    ];
    return t(`users.import.row_codes.${known.includes(code) ? code : "unknown"}`);
  };

  const rows = preview ? (onlyErrors ? preview.rows.filter((r) => r.status === "error") : preview.rows) : [];
  const inviteCount = preview ? preview.rows.filter((r) => r.delivery === "invite").length : 0;
  const blocked = preview !== null && preview.error_count > 0;
  const busy = previewMutation.isPending;
  // 步骤:没预览 = 1,有预览 = 2,导入完 = 3。
  const step = created !== null ? 3 : preview ? 2 : 1;
  const stepLabel = t(`users.import.steps.${["choose", "preview", "result"][step - 1]}`);
  const stepLine = (
    <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("users.import.step", { n: String(step), label: stepLabel })}</p>
  );

  // ── 3 · 结果 ──
  if (created !== null) {
    return (
      <Modal isOpen={isOpen} onClose={close} title={t("users.import.title")}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={close}>{t("common.close")}</Button>
            <Link
              href="/users"
              onClick={close}
              className="inline-flex min-h-11 items-center border border-[oklch(var(--color-ink))] px-4 font-semibold text-[oklch(var(--color-ink))]"
            >
              {t("users.import.view_users")}
            </Link>
          </div>
        }
      >
        <div className="flex flex-col gap-2">
          {stepLine}
          <p role="status" className="text-[oklch(var(--color-ink))]">
            <span aria-hidden="true">✓ </span>
            {t("users.import.success", {
              created: String(created.created),
              invited: String(created.invited),
              // 须改密码 = 导入的减去发了邀请信的;后端不单独给这个数。
              password: String(created.created - created.invited),
            })}
          </p>
          {commitFailed && (
            <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t("souls.import.failed")}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={t("users.import.title")}
      wide
      dismissOnOutsideClick={false}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {blocked && preview && (
            <span role="status" className="mr-auto text-sm text-[oklch(var(--color-status-error))]">
              <span aria-hidden="true">✕ </span>
              {t("users.import.blocked", { n: String(preview.error_count) })}
            </span>
          )}
          {step === 2 ? (
            <Button type="button" variant="ghost" onClick={reset} disabled={commitMutation.isPending}>
              {t("users.import.back")}
            </Button>
          ) : (
            <Button type="button" variant="ghost" onClick={close}>
              {t("common.cancel")}
            </Button>
          )}
          {step === 2 && (
            <Button
              type="button"
              variant="primary"
              onClick={commit}
              disabled={!preview || blocked || busy}
              loading={commitMutation.isPending}
            >
              {commitMutation.isPending
                ? t("souls.import.committing")
                : t("users.import.commit", { n: String(preview?.ok_count ?? 0) })}
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {stepLine}
        {step === 1 && (
          <>
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
              <Button type="button" variant="ghost" onClick={() => saveBlob(userImportTemplate(), "users_import_template.csv")}>
                {t("souls.import.template")}
              </Button>
              {file && <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{file.name}</span>}
            </div>
            <p className="text-xs text-[oklch(var(--color-ink-muted))]">
              {t("souls.import.hint_required", { columns: "username, password" })}{" "}
              {t("users.import.template_notes")}
            </p>
            {busy && <p role="status" className="text-sm text-[oklch(var(--color-ink-muted))]">{t("souls.import.checking")}</p>}
            {fileError && (
              <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
                <span aria-hidden="true">✕ </span>
                {fileErrorText(fileError)}
              </p>
            )}
          </>
        )}

        {preview && (
          <>
            {file && <span className="font-mono text-xs text-[oklch(var(--color-ink-muted))]">{file.name}</span>}
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-[oklch(var(--color-ink))]">
                {t("souls.import.summary", {
                  total: String(preview.total),
                  ok: String(preview.ok_count),
                  bad: String(preview.error_count),
                })}
              </span>
              <span className="text-sm text-[oklch(var(--color-ink-muted))]">
                {t("users.import.delivery_summary", {
                  invite: String(inviteCount),
                  password: String(preview.rows.length - inviteCount),
                })}
              </span>
              <FilterChipToggle pressed={onlyErrors} onPressedChange={setOnlyErrors}>
                {t("souls.import.only_errors")}
              </FilterChipToggle>
            </div>
            {commitFailed && (
              <p role="alert" className="text-sm text-[oklch(var(--color-status-error))]">
                <span aria-hidden="true">✕ </span>
                {t("souls.import.failed")}
              </p>
            )}
            <div className="max-h-[50dvh] overflow-auto border border-[oklch(var(--color-line))]">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-[oklch(var(--color-surface-1))]">
                  <tr>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("souls.import.col_row")}</th>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("users.import.col_username")}</th>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("users.import.col_name")}</th>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("users.import.delivery_col")}</th>
                    <th scope="col" className="px-2 py-1 font-semibold">{t("users.import.col_issue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-2 py-3 text-[oklch(var(--color-ink-muted))]">
                        {t("souls.import.empty_filtered")}
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.row} className="border-t border-[oklch(var(--color-line))] align-top" data-status={r.status}>
                      <td className="px-2 py-1 font-mono">{r.row}</td>
                      <td className="px-2 py-1 font-mono">{r.values.username}</td>
                      <td className="px-2 py-1">{r.values.display_name}</td>
                      <td className="px-2 py-1">
                        {r.delivery === "invite" ? (
                          <span className="inline-flex items-center gap-1 border border-[oklch(var(--color-ink))] px-2">
                            <span aria-hidden="true">✉</span>
                            {t("users.import.delivery.invite")}
                          </span>
                        ) : (
                          t("users.import.delivery.password")
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {r.errors.length === 0 ? (
                          <span className="text-[oklch(var(--color-ink-muted))]">
                            <span aria-hidden="true">✓ </span>
                            {t("souls.import.status_ok")}
                          </span>
                        ) : (
                          r.errors.map((e) => (
                            <div key={`${e.field}:${e.code}`} className="text-[oklch(var(--color-status-error))]">
                              <span aria-hidden="true">✕ </span>
                              {rowText(e.code)}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
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
