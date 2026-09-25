"use client";

import { useState } from "react";
import { TEMPLATE_PLACEHOLDERS, type InboxReplyTemplate } from "@soulledger/core/api/soul-inbox";
import { useInboxTemplateMutations, useInboxTemplates } from "@soulledger/core/hooks/useSoulInbox";
import { useI18n } from "@/src/contexts/I18nContext";
import { useToast } from "@/src/contexts/ToastContext";
import { Modal } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, TextField } from "@/src/components/ui/Field";

/*
 * 殿司的回复模板(backend `InboxReplyTemplateViewSet`,每个动作要 `soul_inbox.reply`)。
 * 同一殿司的官员共用;占位符只有 `{{soul_name}}` / `{{hall_name}}`,在回复框里插入时替换
 * (`renderTemplate`),模板本身不经过 Synapse。别的 `{{…}}` 服务端拒收,拒绝原文照出。
 */

function detailOf(error: unknown): string | null {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return null;
  const first = Object.values(data).flat()[0];
  return typeof first === "string" ? first : null;
}

export function TemplateManager({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const templates = useInboxTemplates(isOpen);
  const { create, update, remove } = useInboxTemplateMutations();
  // null = 不在编辑;"new" = 新建;否则是正在改的那一条。
  const [editing, setEditing] = useState<InboxReplyTemplate | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const start = (target: InboxReplyTemplate | "new") => {
    setEditing(target);
    setTitle(target === "new" ? "" : target.title);
    setBody(target === "new" ? "" : target.body);
    setError(null);
  };

  const save = () => {
    const done = {
      onSuccess: () => {
        showToast(t("soul_inbox.template.saved"), "success");
        setEditing(null);
      },
      onError: (e: unknown) => setError(detailOf(e) ?? t("soul_inbox.failed")),
    };
    if (editing === "new") create.mutate({ title, body }, done);
    else if (editing) update.mutate({ id: editing.id, title, body }, done);
  };

  const rows = templates.data ?? [];
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("soul_inbox.template.manage")}>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-col gap-3"
        >
          <TextField label={t("soul_inbox.template.title")} value={title} maxLength={80} required
            onChange={(e) => setTitle(e.target.value)} />
          <TextAreaField label={t("soul_inbox.template.body")} value={body} maxLength={4000} rows={5} required
            error={error}
            description={
              <>
                {t("soul_inbox.template.placeholders")}{" "}
                {TEMPLATE_PLACEHOLDERS.map((p) => (
                  <code key={p} className="mr-2 font-mono text-2xs">{`{{${p}}}`}</code>
                ))}
              </>
            }
            onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</Button>
            <Button type="submit" variant="primary" loading={create.isPending || update.isPending}
              disabled={!title.trim() || !body.trim()}>
              {t("common.save")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.length === 0 ? (
            <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("soul_inbox.template.empty_manage")}</p>
          ) : (
            <ul aria-label={t("soul_inbox.template.label")}>
              {rows.map((tpl) => (
                <li key={tpl.id} className="flex items-baseline gap-2 py-2 border-b border-[oklch(var(--color-rule))]">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[oklch(var(--color-ink))]">{tpl.title}</span>
                    <span title={tpl.body} className="block truncate font-serif text-xs text-[oklch(var(--color-ink-muted))]">{tpl.body}</span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => start(tpl)}
                    aria-label={`${t("common.edit")} ${tpl.title}`}>
                    {t("common.edit")}
                  </Button>
                  <Button type="button" size="sm" variant="danger" loading={remove.isPending && remove.variables === tpl.id}
                    aria-label={`${t("common.delete")} ${tpl.title}`}
                    onClick={() =>
                      remove.mutate(tpl.id, {
                        onSuccess: () => showToast(t("soul_inbox.template.deleted"), "success"),
                        onError: () => showToast(t("soul_inbox.failed"), "error"),
                      })
                    }>
                    {t("common.delete")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button type="button" variant="secondary" onClick={() => start("new")}>{t("soul_inbox.template.new")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
