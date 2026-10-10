"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { mediaGridColumns, mediaUrl, type PostMedia } from "@soulledger/core/domain/postMedia";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";

/**
 * 审阅详情里的配图(C-08 的 MediaTile):方角、细线框、底部一行等宽的「图 1 · 1080×1080」。
 * 列数与灵魂 App 的动态流同一条规则(`mediaGridColumns`:1 张一大格,2–4 两列,5–9 三列),
 * 每格至多 160px,单张 320px。
 *
 * 地址是服务器签给当前官员的短时路径,取文件时再按官员的码名与文明查一次。取不到(过期、
 * 失去权限)时格子里说「图片加载失败」,不留空白。
 *
 * 点开是查看器(规范 v2 补足 C15「图片上传与查看器」):纯黑底、原图居中;右上「关闭」,
 * ← → 切换,Esc 关闭。不做缩放动画,直接显示 —— 所以查看器不挂任何 transition。
 */
function caption(t: (k: string, p?: Record<string, string>) => string, media: PostMedia, index: number) {
  return t("social_moderation.review.media_caption", {
    i: String(index + 1),
    w: String(media.width),
    h: String(media.height),
  });
}

function Tile({ media, index, onOpen }: { media: PostMedia; index: number; onOpen: () => void }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const label = caption(t, media, index);
  const src = mediaUrl(media.url);
  return (
    <li className="relative aspect-square overflow-hidden border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))]">
      {broken ? (
        <span data-media-broken className="flex h-full items-center justify-center p-2 text-center text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("social_moderation.review.media_load_failed")}
        </span>
      ) : (
        <button type="button" onClick={onOpen} className="block h-full w-full">
          {/* 裸 <img>,不是 next/image:签名地址、按请求鉴权,不能经图片优化代理转一道。 */}
          <img src={src} alt={label} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        </button>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 bg-[oklch(var(--color-surface-2)/0.85)] px-2 py-0.5 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]"
      >
        {label}
      </span>
    </li>
  );
}

/** 全屏查看器。审阅详情的配图格与殿司收件箱里灵魂来信的图共用(`index` 为 null 时不显示)。 */
export function MediaViewer({ media, index, onIndex, onClose }: { media: PostMedia[]; index: number | null; onIndex: (i: number) => void; onClose: () => void }) {
  const { t } = useI18n();
  const open = index !== null;
  const current = open ? media[index] : null;
  const step = (d: number) => {
    if (index === null) return;
    onIndex((index + d + media.length) % media.length);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Popup
          data-media-viewer=""
          aria-label={current && index !== null ? caption(t, current, index) : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") step(1);
            else if (e.key === "ArrowLeft") step(-1);
          }}
          // 纯黑底是查看器的规格(不是 canvas):照片在任何主题下都放在同一种底上看。
          className="fixed inset-0 z-dialog flex items-center justify-center bg-black p-12 focus:outline-hidden"
        >
          {current && index !== null ? (
            <>
              <img src={mediaUrl(current.url)} alt={caption(t, current, index)} className="max-h-full max-w-full object-contain" />
              <span className="absolute bottom-4 left-4 font-mono text-2xs text-white">
                {caption(t, current, index)}
                {media.length > 1 ? ` · ${index + 1} / ${media.length}` : ""}
              </span>
              <Dialog.Close className="absolute right-4 top-4 min-h-(--control-h-sm) border border-white px-3 text-sm text-white focus-visible:outline-white">
                {t("common.close")}
              </Dialog.Close>
            </>
          ) : null}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function MediaGrid({ media }: { media: PostMedia[] }) {
  const { t } = useI18n();
  const [viewing, setViewing] = useState<number | null>(null);
  if (!media.length) return null;
  const cols = mediaGridColumns(media.length);
  return (
    <>
      <ul
        aria-label={t("social_moderation.review.media_label")}
        data-media-grid
        data-columns={cols}
        className={cn(
          "mt-3 grid gap-2",
          cols === 1 && "grid-cols-[minmax(0,320px)]",
          cols === 2 && "grid-cols-[repeat(2,minmax(0,160px))]",
          cols === 3 && "grid-cols-[repeat(3,minmax(0,160px))]"
        )}
      >
        {media.map((m, i) => (
          <Tile key={m.id} media={m} index={i} onOpen={() => setViewing(i)} />
        ))}
      </ul>
      <MediaViewer media={media} index={viewing} onIndex={setViewing} onClose={() => setViewing(null)} />
    </>
  );
}
