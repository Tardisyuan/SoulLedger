"use client";

import { useState } from "react";
import { mediaGridColumns, mediaUrl, type PostMedia } from "@soulledger/core/domain/postMedia";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";

/**
 * 审阅详情里的配图(C-08 的 MediaTile):方角、细线框、底部一行等宽的「图 1 · 1080×1080」。
 * 列数与灵魂 App 的动态流同一条规则(`mediaGridColumns`:1 张一大格,2–4 两列,5–9 三列),
 * 每格至多 160px,单张 320px。
 *
 * 地址是服务器签给当前官员的短时路径,取文件时再按官员的码名与文明查一次;点开是原图
 * (新标签页,同一个签名)。取不到(过期、失去权限)时格子里说「图片加载失败」,不留空白。
 */
function Tile({ media, index }: { media: PostMedia; index: number }) {
  const { t } = useI18n();
  const [broken, setBroken] = useState(false);
  const caption = t("social_moderation.review.media_caption", {
    i: String(index + 1),
    w: String(media.width),
    h: String(media.height),
  });
  const src = mediaUrl(media.url);
  return (
    <li className="relative aspect-square overflow-hidden border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))]">
      {broken ? (
        <span data-media-broken className="flex h-full items-center justify-center p-2 text-center text-xs text-[oklch(var(--color-ink-subtle))]">
          {t("social_moderation.review.media_load_failed")}
        </span>
      ) : (
        <a href={src} target="_blank" rel="noopener noreferrer" className="block h-full w-full focus-visible:outline focus-visible:outline-2">
          {/* 裸 <img>,不是 next/image:签名地址、按请求鉴权,不能经图片优化代理转一道。 */}
          <img src={src} alt={caption} loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
        </a>
      )}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-0 left-0 bg-[oklch(var(--color-surface-2)/0.85)] px-1.5 py-0.5 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]"
      >
        {caption}
      </span>
    </li>
  );
}

export function MediaGrid({ media }: { media: PostMedia[] }) {
  const { t } = useI18n();
  if (!media.length) return null;
  const cols = mediaGridColumns(media.length);
  return (
    <ul
      aria-label={t("social_moderation.review.media_label")}
      data-media-grid
      data-columns={cols}
      className={cn(
        "mt-3 grid gap-1.5",
        cols === 1 && "grid-cols-[minmax(0,320px)]",
        cols === 2 && "grid-cols-[repeat(2,minmax(0,160px))]",
        cols === 3 && "grid-cols-[repeat(3,minmax(0,160px))]"
      )}
    >
      {media.map((m, i) => (
        <Tile key={m.id} media={m} index={i} />
      ))}
    </ul>
  );
}
