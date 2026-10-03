"use client";

import { useEffect, useRef, useState } from "react";
import { useCreatePost, usePostMediaLimits } from "@soulledger/core/hooks/useSocial";
import { useMediaUploads, type SoulMediaUpload } from "@soulledger/core/hooks/useSoulMediaUploads";
import { socialApi } from "@soulledger/core/api";
import { mediaUrl } from "@soulledger/core/domain/postMedia";
import { useI18n } from "@/src/contexts/I18nContext";
import { Button } from "@/src/components/ui/Button";
import { fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

const VISIBILITIES = ["PUBLIC", "TENANT", "FOLLOWERS", "PRIVATE"] as const;
const UPLOAD_ERRORS = ["not_an_image", "too_large", "too_many_pixels", "too_many_pending"] as const;

/** One picked file → the multipart body `POST /social/media/` reads (`file`). Module-level: a hook dependency. */
function toBody(file: File) {
  const body = new FormData();
  body.append("file", file);
  return body;
}

/** The server's `code` on a refused upload, when it is one the language packs name. */
function uploadErrorCode(error: unknown) {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return UPLOAD_ERRORS.find((c) => c === code);
}

/**
 * 发帖框(A5):文本框最小 72 高、15/24、圆角 4;操作行「帖子可见范围」+ 44 高选择 + 44 高幽灵
 * 「＋ 配图」+ 12px ink-subtle「最多 N 张」+ 右端「发布」。
 *
 * 配图(2026-10-02):先传后发,与 App 同一个队列(`useMediaUploads`,这里接 `socialApi`)——
 * 每张一个请求、各自的进度与失败;失败的可重试或移除,传好的可在发出前移除(服务端真删)。
 * N 读 `GET /social/media/`(`usePostMediaLimits`),不写死。没传完、或有失败的,「发布」不可点。
 * 离开发帖框(393 的弹窗关掉)而没发:传好的删掉;删不掉的由服务端的孤儿清理收走。
 *
 * 393 下它不在页面里,由悬浮「＋ 发帖」打开的弹窗承载(`onPosted` 关掉弹窗)。
 */
export function PostComposer({ onPosted }: { onPosted?: () => void }) {
  const { t } = useI18n();
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState("PUBLIC");
  const createPost = useCreatePost();
  const limits = usePostMediaLimits();
  const max = limits.data?.max_per_post ?? 0;
  const uploads = useMediaUploads<File>(socialApi, toBody, max);
  const picker = useRef<HTMLInputElement>(null);
  const [skipped, setSkipped] = useState(0);

  const discard = useRef(uploads.discard);
  useEffect(() => {
    discard.current = uploads.discard;
  });
  useEffect(() => () => discard.current(), []);

  const hasBody = !!content.trim() || uploads.items.length > 0;
  const canPost = hasBody && uploads.ready;

  const handleCreate = () => {
    if (!canPost) return;
    createPost.mutate(
      { content: content.trim(), visibility, ...(uploads.mediaIds.length ? { media: uploads.mediaIds } : {}) },
      {
        onSuccess: () => {
          setContent("");
          setVisibility("PUBLIC");
          setSkipped(0);
          uploads.clear();
          onPosted?.();
        },
      },
    );
  };

  const handlePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ""; // 同一张再选一次也要触发 change
    if (!files.length) return;
    setSkipped(files.length - uploads.add(files));
  };

  return (
    <div data-post-composer="" className="flex flex-col gap-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("social.placeholder")}
        aria-label={t("social.placeholder")}
        rows={3}
        className={cn(fieldControl({ size: "md" }), "min-h-18 px-3 py-[10px] text-md font-normal")}
      />

      {uploads.items.length ? (
        <ul data-composer-media="" aria-label={t("soul_app.circle.media.count", { n: String(uploads.items.length), max: String(max) })} className="flex flex-col gap-2">
          {uploads.items.map((item, i) => (
            <AttachmentRow
              key={item.key}
              item={item}
              index={i}
              onRetry={() => uploads.retry(item.key)}
              onRemove={() => uploads.remove(item.key)}
            />
          ))}
        </ul>
      ) : null}
      {skipped > 0 ? (
        <p role="status" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("soul_app.circle.media.limit", { max: String(max) })}
        </p>
      ) : null}
      {uploads.failed ? (
        <p role="status" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("soul_app.circle.media.failed_hint")}
        </p>
      ) : uploads.uploading ? (
        <p role="status" className="text-xs text-[oklch(var(--color-ink-muted))]">
          {t("soul_app.circle.media.waiting")}
        </p>
      ) : null}

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
        {/* `accept` 只是筛选器;服务端按魔数解码才是检查。 */}
        <input
          ref={picker}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={handlePicked}
          data-testid="composer-media-input"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => picker.current?.click()}
          disabled={!max || uploads.room === 0}
        >
          <span aria-hidden="true">＋ </span>
          {t("social.media.add")}
        </Button>
        {max ? (
          <span data-media-limit="" className="text-xs text-[oklch(var(--color-ink-subtle))]">
            {t("social.media.max", { max: String(max) })}
          </span>
        ) : null}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleCreate}
          disabled={!canPost}
          loading={createPost.isPending}
          className="ml-auto px-[18px]"
        >
          {t("social.post")}
        </Button>
      </div>
    </div>
  );
}

function AttachmentRow({
  item,
  index,
  onRetry,
  onRemove,
}: {
  item: SoulMediaUpload<File>;
  index: number;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const label = t("soul_app.circle.media.image", { i: String(index + 1) });
  const percent = Math.round(item.progress * 100);
  const code = item.status === "failed" ? uploadErrorCode(item.error) : undefined;
  return (
    <li data-attachment={item.status} className="flex min-h-14 items-center gap-3">
      <span className="size-12 shrink-0 overflow-hidden bg-[oklch(var(--color-surface-2))] bg-[repeating-linear-gradient(135deg,oklch(var(--color-line)/0.6)_0_1px,transparent_1px_8px)]">
        {item.media ? (
          // 裸 <img>:签名地址按请求鉴权,不经 next/image 的优化代理(同 PostMedia)。
          <img src={mediaUrl(item.media.url)} alt="" className="h-full w-full object-cover" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className="block text-[oklch(var(--color-ink))]">{label}</span>
        {item.status === "uploading" ? (
          <>
            <span className="block font-mono tabular-nums text-[oklch(var(--color-ink-muted))]">
              {t("soul_app.circle.media.uploading", { percent: String(percent) })}
            </span>
            <span
              role="progressbar"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-1 block h-0.5 w-full max-w-40 bg-[oklch(var(--color-line))]"
            >
              <span className="block h-full bg-[oklch(var(--color-ink))]" style={{ width: `${percent}%` }} />
            </span>
          </>
        ) : item.status === "failed" ? (
          <span className="block text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">✕ </span>
            {t("soul_app.circle.media.failed")}
            {code ? ` · ${t(`soul_app.circle.media.errors.${code}`)}` : null}
          </span>
        ) : null}
      </span>
      {item.status === "failed" ? (
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
          {t("soul_app.circle.media.retry")}
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`${t("soul_app.circle.media.remove")} ${label}`}>
        {t("soul_app.circle.media.remove")}
      </Button>
    </li>
  );
}
