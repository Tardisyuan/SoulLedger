"use client";

import { useState } from "react";
import type {
  SensitiveWord,
  SensitiveWordAction,
  SensitiveWordCategory,
} from "@soulledger/core/api/social-moderation";
import {
  useAddSensitiveWord,
  useRemoveSensitiveWords,
  useSensitiveWords,
  useUpdateSensitiveWord,
  useUpdateSensitiveWords,
} from "@soulledger/core/hooks/useSocialModeration";
import { PAGE_SIZE } from "@soulledger/core/api";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Button } from "@/src/components/ui/Button";
import { Badge } from "@/src/components/ui/Badge";
import { ConfirmDialog, Modal } from "@/src/components/ui/Modal";
import { Drawer } from "@/src/components/ui/Drawer";
import { fieldControl } from "@/src/components/ui/Field";
import { DataTable, ROW_LINK } from "@/components/ui/data-table";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { cn } from "@/lib/utils";
import { WORD_ACTION_TONES, useFailureToast } from "./shared";

const CATEGORIES: SensitiveWordCategory[] = ["PRIVACY", "ABUSE", "INDUCEMENT", "CONFIDENTIAL", "OFFICIAL_DEFAMATION"];
const ACTIONS: SensitiveWordAction[] = ["REVIEW", "HIDE", "MASK"];

/** The edit drawer's form. `category` "" = an old uncategorised word: it must get one before it can be saved. */
type WordDraft = { id: string; word: string; category: SensitiveWordCategory | ""; action: SensitiveWordAction };

/**
 * 敏感词(E-08b)。新增是列表顶部的一行 —— 词 · 类别 · 命中后,回车即加,不开弹层。类别必选(2026-09-25):
 * 没选类别「添加」不可点、回车也不提交;服务端同样拒收。旧词仍显示「未分类」。
 * 删除只能先勾选、再从批量条删(batch-delete,全有或全无);行尾不放删除按钮。
 *
 * 点整行打开编辑抽屉(PATCH:类别每次都必填,与新建同一条规则 —— 旧的未分类词要先选类别才能存);
 * 批量条的「改动作…」走 batch-update,与 batch-delete 一样全有或全无。
 */
export function SensitiveWordsSection() {
  const { t, formatDateTime } = useI18n();
  const { showToast } = useToast();
  const fail = useFailureToast();
  const [page, setPage] = useState(1);
  const list = useSensitiveWords(page);
  const add = useAddSensitiveWord();
  const remove = useRemoveSensitiveWords();
  const rows = list.data?.results ?? [];

  const [word, setWord] = useState("");
  const [category, setCategory] = useState<SensitiveWordCategory | "">("");
  const [action, setAction] = useState<SensitiveWordAction>("REVIEW");

  // Selection belongs to the page it was made on (see SoulBatchBar).
  const [selection, setSelection] = useState<{ page: number; ids: Set<string> }>({ page, ids: new Set() });
  if (selection.page !== page) setSelection({ page, ids: new Set() });
  const selected = selection.page === page ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ page, ids });
  const [confirming, setConfirming] = useState(false);

  const update = useUpdateSensitiveWord();
  const updateMany = useUpdateSensitiveWords();
  const [editing, setEditing] = useState<WordDraft | null>(null);
  const [batchAction, setBatchAction] = useState<SensitiveWordAction | null>(null);

  const saveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing || !editing.word.trim() || !editing.category || update.isPending) return;
    const { id, word: text, category: cat, action: act } = editing;
    update.mutate(
      { id, edit: { word: text.trim(), category: cat, action: act } },
      {
        onSuccess: () => {
          setEditing(null);
          showToast(t("social_moderation.done"), "success");
        },
        onError: fail,
      }
    );
  };

  const applyBatchAction = () =>
    batchAction &&
    updateMany.mutate(
      { ids: [...selected], action: batchAction },
      {
        onSuccess: () => {
          setBatchAction(null);
          setSelected(new Set());
          showToast(t("social_moderation.done"), "success");
        },
        onError: fail,
      }
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!word.trim() || !category || add.isPending) return;
    add.mutate(
      { word: word.trim(), category, action },
      {
        onSuccess: () => {
          setWord("");
          showToast(t("social_moderation.done"), "success");
        },
        onError: fail,
      }
    );
  };

  const removeSelected = () =>
    remove.mutate([...selected], {
      onSuccess: () => {
        setSelected(new Set());
        showToast(t("social_moderation.done"), "success");
      },
      onError: fail,
      onSettled: () => setConfirming(false),
    });

  return (
    <div className="space-y-3">
      {/* 内联新增行。一个 <form>:在任一个控件里回车都会提交。 */}
      <form
        onSubmit={submit}
        aria-label={t("social_moderation.words.add_row")}
        className="grid grid-cols-2 gap-2 border-b border-[oklch(var(--color-block))] pb-3 md:grid-cols-[1.6fr_1fr_1fr_auto]"
      >
        <input
          type="text"
          value={word}
          maxLength={50}
          onChange={(e) => setWord(e.target.value)}
          placeholder={t("social_moderation.word_placeholder")}
          aria-label={t("social_moderation.fields.word")}
          aria-describedby="word-hint"
          className={cn(fieldControl({ size: "md" }), "col-span-2 md:col-span-1")}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as SensitiveWordCategory | "")}
          aria-label={t("social_moderation.words.col_category")}
          required
          className={fieldControl({ size: "md" })}
        >
          <option value="" disabled>
            {t("social_moderation.words.category_placeholder")}
          </option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`social_moderation.word_category.${c}`)}
            </option>
          ))}
        </select>
        <select
          value={action}
          onChange={(e) => setAction(e.target.value as SensitiveWordAction)}
          aria-label={t("social_moderation.words.col_action")}
          className={fieldControl({ size: "md" })}
        >
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {t(`social_moderation.word_action.${a}`)}
            </option>
          ))}
        </select>
        <Button
          type="submit"
          variant="primary"
          loading={add.isPending}
          disabled={!word.trim() || !category}
          className="col-span-2 md:col-span-1"
        >
          {t("social_moderation.actions.add_word")}
          <span aria-hidden="true" className="ml-1 font-mono">⏎</span>
        </Button>
        <p id="word-hint" className="col-span-full text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("social_moderation.word_hint")}
        </p>
      </form>

      <DataTable<SensitiveWord>
        caption={t("social_moderation.tabs.words")}
        density="compact"
        linkedRows
        columns={[
          { key: "word", header: t("social_moderation.words.col_word") },
          { key: "category", header: t("social_moderation.words.col_category") },
          { key: "action", header: t("social_moderation.words.col_action") },
          { key: "hits", header: t("social_moderation.words.col_hits"), align: "right" },
          { key: "by", header: t("social_moderation.words.col_by") },
          { key: "at", header: t("social_moderation.words.col_at"), align: "right" },
        ]}
        data={rows}
        isLoading={list.isLoading}
        isError={list.isError && !list.data}
        onRetry={() => list.refetch()}
        emptyMessage={t("social_moderation.empty.words")}
        keyExtractor={(w) => w.id}
        selection={{
          selected,
          onToggle: (key, _w, checked) => {
            const next = new Set(selected);
            if (checked) next.add(key);
            else next.delete(key);
            setSelected(next);
          },
          onToggleAll: (checked) => setSelected(checked ? new Set(rows.map((w) => w.id)) : new Set()),
          rowLabel: (w) => t("social_moderation.words.select_row", { word: w.word }),
          allLabel: t("souls.batch.select_all"),
        }}
        renderRow={(w) => (
          <>
            <td className="px-3 py-2 font-medium text-[oklch(var(--color-ink))] break-all">
              {/* The row's one control: its ::after covers the row (ROW_LINK); the checkbox sits above it. */}
              <button
                type="button"
                onClick={() => setEditing({ id: w.id, word: w.word, category: w.category, action: w.action })}
                className={`${ROW_LINK} text-left`}
              >
                {w.word}
              </button>
            </td>
            <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">
              {t(`social_moderation.word_category.${w.category || "NONE"}`)}
            </td>
            <td className="px-3 py-2">
              <Badge tone={WORD_ACTION_TONES[w.action] ?? "neutral"}>{t(`social_moderation.word_action.${w.action}`)}</Badge>
            </td>
            <td className="px-3 py-2 text-right font-mono text-xs">{w.hits_30d}</td>
            <td className="px-3 py-2 text-xs text-[oklch(var(--color-ink-muted))]">{w.created_by?.display_name ?? <MissingValue kind="unrecorded" />}</td>
            <td className="px-3 py-2 text-right font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{formatDateTime(w.created_at)}</td>
          </>
        )}
        page={page}
        totalPages={list.data ? Math.ceil(list.data.count / PAGE_SIZE) : 0}
        totalCount={list.data?.count}
        onPageChange={setPage}
      />

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t("social_moderation.words.batch_region")}
          className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-[oklch(var(--color-block))] bg-[oklch(var(--color-canvas))] px-4 py-2"
        >
          <span className="font-mono text-xs text-[oklch(var(--color-ink))]" aria-live="polite">
            {t("souls.batch.selected", { n: String(selected.size) })}
          </span>
          <span className="flex-1" />
          <Button type="button" variant="secondary" size="sm" onClick={() => setBatchAction("REVIEW")}>
            {t("social_moderation.words.change_action")}
          </Button>
          <Button type="button" variant="danger" size="sm" onClick={() => setConfirming(true)}>
            {t("social_moderation.words.delete_selected")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
            {t("souls.batch.clear")}
          </Button>
        </div>
      )}

      <Modal
        isOpen={batchAction !== null}
        onClose={() => setBatchAction(null)}
        title={t("social_moderation.words.change_action_title", { n: String(selected.size) })}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setBatchAction(null)} disabled={updateMany.isPending}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="primary" onClick={applyBatchAction} loading={updateMany.isPending}>
              {t("common.save")}
            </Button>
          </div>
        }
      >
        <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
          {t("social_moderation.words.col_action")}
          <select
            value={batchAction ?? "REVIEW"}
            onChange={(e) => setBatchAction(e.target.value as SensitiveWordAction)}
            className={cn(fieldControl({ size: "md" }), "mt-1 w-full")}
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`social_moderation.word_action.${a}`)}
              </option>
            ))}
          </select>
        </label>
      </Modal>

      <Drawer isOpen={editing !== null} onClose={() => setEditing(null)} title={t("social_moderation.words.edit_title")}>
        {editing && (
          <form onSubmit={saveEdit} aria-label={t("social_moderation.words.edit_title")} className="space-y-3">
            <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
              {t("social_moderation.fields.word")}
              <input
                type="text"
                value={editing.word}
                maxLength={50}
                onChange={(e) => setEditing({ ...editing, word: e.target.value })}
                aria-describedby="word-edit-hint"
                className={cn(fieldControl({ size: "md" }), "mt-1 w-full")}
              />
            </label>
            <p id="word-edit-hint" className="text-xs text-[oklch(var(--color-ink-subtle))]">
              {t("social_moderation.words.edit_hint")}
            </p>
            <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
              {t("social_moderation.words.col_category")}
              <select
                value={editing.category}
                required
                onChange={(e) => setEditing({ ...editing, category: e.target.value as SensitiveWordCategory })}
                className={cn(fieldControl({ size: "md" }), "mt-1 w-full")}
              >
                <option value="" disabled>
                  {t("social_moderation.words.category_placeholder")}
                </option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`social_moderation.word_category.${c}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-[oklch(var(--color-ink-muted))]">
              {t("social_moderation.words.col_action")}
              <select
                value={editing.action}
                onChange={(e) => setEditing({ ...editing, action: e.target.value as SensitiveWordAction })}
                className={cn(fieldControl({ size: "md" }), "mt-1 w-full")}
              >
                {ACTIONS.map((a) => (
                  <option key={a} value={a}>
                    {t(`social_moderation.word_action.${a}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2 border-t border-[oklch(var(--color-block))] pt-3">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={update.isPending}
                disabled={!editing.word.trim() || !editing.category}
              >
                {t("common.save")}
              </Button>
            </div>
          </form>
        )}
      </Drawer>

      <ConfirmDialog
        isOpen={confirming}
        title={t("social_moderation.words.confirm_title", { n: String(selected.size) })}
        message={t("social_moderation.confirm_remove_word_body")}
        confirmText={t("social_moderation.words.delete_selected")}
        confirmLoading={remove.isPending}
        onConfirm={removeSelected}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
