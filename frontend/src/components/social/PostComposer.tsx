"use client";

import { useState } from "react";
import { useCreatePost } from "@soulledger/core/hooks/useSocial";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

const VISIBILITIES = ["PUBLIC", "TENANT", "FOLLOWERS", "PRIVATE"] as const;

/**
 * 发帖框(A5):文本框最小 72 高、15/24、圆角 4;操作行「帖子可见范围」+ 44 高选择 + 右端「发布」。
 *
 * **没有「＋ 配图」**:图片上传只有灵魂端的 `POST /me/social/media/`(要灵魂令牌,
 * `media.upload` 先过 `ensure_can_write` —— 只收本世灵魂),官员的 `POST /social/posts/`
 * (`PostCreateSerializer`)只收 content 与 visibility。所以 Web 发帖框保持纯文字。
 *
 * 393 下它不在页面里,由悬浮「＋ 发帖」打开的弹窗承载(`onPosted` 关掉弹窗)。
 */
export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const createPost = useCreatePost();

  const handleCreate = () => {
    if (!content.trim()) return;
    createPost.mutate(
      { content: content.trim(), visibility },
      {
        onSuccess: () => {
          setContent("");
          setVisibility("PUBLIC");
          onPosted?.();
        },
      },
    );
  };

  return (
    <div data-post-composer="" className="flex flex-col gap-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("social.placeholder")}
        aria-label={t("social.placeholder")}
        rows={3}
        className={cn(fieldControl({ size: "md" }), "min-h-18 px-3 py-[10px] text-md")}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="contents">
          <span className="text-xs text-[oklch(var(--color-ink-muted))]">{t("social.visibility_label")}</span>
          {/* 裸 <select>:标签在同一行左边,SelectField 会把标签叠到控件上面。`w-auto` 撤掉 fieldControl 的 `w-full`。 */}
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className={cn(fieldControl({ size: "sm" }), "w-auto")}
          >
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {t(`social.visibility.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={!content.trim()}
          loading={createPost.isPending}
          className="ml-auto px-[18px]"
        >
          {t("social.post")}
        </Button>
      </div>
    </div>
  );
}
