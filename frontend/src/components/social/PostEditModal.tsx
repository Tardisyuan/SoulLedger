"use client";

import { useState } from "react";
import { useUpdatePost } from "@soulledger/core/hooks/useSocial";
import { BaseModal, ConfirmDialog } from "@/src/components/ui/Modal";
import { Button } from "@/src/components/ui/Button";
import { TextAreaField, fieldControl } from "@/src/components/ui/Field";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { VISIBILITIES } from "./PostComposer";
import type { Post } from "@soulledger/core/api";

/**
 * 作者改自己的帖子(`PATCH /social/posts/:id/`,后端只认作者):文字与可见范围。
 * 配图后端不收(`media` 只读),所以这里不碰;空白不能存(后端同样 400 `blank`),
 * 没改动「保存」不可点,只发改动了的字段。有未保存改动时关闭先确认。
 * 仅在编辑时挂载(PostCard 条件渲染),初值取挂载那一刻的帖子。
 */
export function PostEditModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const { t } = useI18n();
  const update = useUpdatePost();
  const [content, setContent] = useState(post.content);
  const [visibility, setVisibility] = useState(post.visibility);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const trimmed = content.trim();
  const textChanged = trimmed !== post.content.trim();
  const visibilityChanged = visibility !== post.visibility;
  const dirty = textChanged || visibilityChanged;
  const canSave = dirty && !!trimmed && !update.isPending;

  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    update.mutate(
      {
        id: post.id,
        data: {
          ...(textChanged ? { content: trimmed } : {}),
          ...(visibilityChanged ? { visibility } : {}),
        },
      },
      { onSuccess: onClose },
    );
  };

  const footer = (
    <div className="flex justify-end gap-2">
      <Button type="button" variant="secondary" onClick={requestClose} disabled={update.isPending}>
        {t("common.cancel")}
      </Button>
      <Button type="submit" form="post-edit-form" variant="primary" disabled={!canSave} loading={update.isPending}>
        {t("common.save")}
      </Button>
    </div>
  );

  return (
    <>
      <BaseModal isOpen onClose={requestClose} title={t("social.edit_title")} footer={footer} dismissOnOutsideClick={false}>
        <form id="post-edit-form" onSubmit={save} className="flex flex-col gap-3">
          <TextAreaField
            label={t("social.placeholder")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={update.isPending}
            rows={4}
          />
          {post.media?.length ? (
            <div data-edit-media="" className="flex flex-col gap-1">
              <ul className="flex flex-wrap gap-2">
                {post.media.map((m) => (
                  <li key={m.id} className="size-14 overflow-hidden bg-[oklch(var(--color-surface-2))]">
                    {/* 裸 <img>:签名地址按请求鉴权,不经 next/image(同 PostMedia)。无任何控件。 */}
                    <img src={mediaUrl(m.url)} alt="" className="h-full w-full object-cover" />
                  </li>
                ))}
              </ul>
              <p className="text-xs text-[oklch(var(--color-ink-muted))]">{t("social.edit_media_locked")}</p>
            </div>
          ) : null}
          <label className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("social.visibility_label")}</span>
            <select
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as Post["visibility"])}
              disabled={update.isPending}
              className={cn(fieldControl({ size: "sm" }), "w-auto")}
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {t(`social.visibility.${v}`)}
                </option>
              ))}
            </select>
          </label>
        </form>
      </BaseModal>
      <ConfirmDialog
        isOpen={confirmDiscard}
        title={t("social.edit_discard_title")}
        message={t("social.edit_discard_message")}
        confirmText={t("social.edit_discard_confirm")}
        cancelText={t("social.edit_keep")}
        onConfirm={onClose}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
