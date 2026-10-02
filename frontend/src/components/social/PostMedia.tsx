"use client";

import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { mediaUrl, type PostMedia } from "@soulledger/core/domain/postMedia";
import { useI18n } from "@/src/contexts/I18nContext";
import { cn } from "@/lib/utils";

/**
 * 帖子配图与图片查看器(A5 Post.dc / Social.dc `viewer`)。
 *
 * 方格规则(稿):1 张 16:10、至多 480 宽;2–4 张两列方格、间距 4、至多 400 宽;
 * 5 张起同样两列,只排前四格,第四格叠 55% ink 遮罩 +「+N」。≤ 768 一律三列、间距 3,
 * 排前六格,第六格叠「+N」。两套都由 CSS 断点切换,所以服务端渲染与首帧不跳。
 *
 * **签名地址过期**:`<img>` 的 onError 之后不留破图,格子换成 1px 虚线框
 * 「◌ 链接已过期 · 重新获取」。服务端对过期、无权、已删都回同一个 404(media_views.py),
 * 浏览器分不出是哪一种;「重新获取」就是让调用方重拉列表、拿一个新签的地址(App 的做法是
 * 写「图片加载失败」而不重取,见 mobile/src/screens/circleMedia.tsx —— Web 稿要求能重取)。
 * 重拉之后地址变了,格子按 `id:url` 重新挂载,失败状态随之清掉;还取不到就再显示一次虚线格。
 *
 * 查看器用 Base UI Dialog(与 BaseModal 同一个原语),焦点进出、Esc、焦点圈都随它;
 * 面板圆角 8(`rounded-panel`),← → 切换。动效走全局 reduced-motion 规则(1ms,不是 none)。
 */

const DESKTOP_CELLS = 4;
const NARROW_CELLS = 6;

type T = (k: string, p?: Record<string, string>) => string;

function caption(t: T, m: PostMedia, i: number) {
  return t("social_moderation.review.media_caption", { i: String(i + 1), w: String(m.width), h: String(m.height) });
}

/** 过期格:虚线框 + ◌ + 下划线「重新获取」;393 只留 ◌ 与「重取」。 */
function Expired({ onRefetch }: { onRefetch?: () => void }) {
  const { t } = useI18n();
  return (
    <span
      data-media-expired=""
      className="flex h-full w-full flex-col items-center justify-center gap-1 border border-dashed border-[oklch(var(--color-line-strong))] p-2 text-center text-xs text-[oklch(var(--color-ink-muted))]"
    >
      <span>
        <span aria-hidden="true">◌ </span>
        <span className="max-[768px]:sr-only">{t("social.media.expired")}</span>
      </span>
      {onRefetch ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRefetch();
          }}
          className="min-h-(--control-h-sm) px-2 text-[oklch(var(--color-ink))] underline underline-offset-2"
        >
          <span className="max-[768px]:hidden">{t("social.media.refetch")}</span>
          <span className="min-[769px]:hidden">{t("social.media.refetch_short")}</span>
        </button>
      ) : null}
    </span>
  );
}

const LOADING_BG =
  "bg-[oklch(var(--color-surface-2))] bg-[repeating-linear-gradient(135deg,oklch(var(--color-line)/0.6)_0_1px,transparent_1px_8px)]";

function Img({ media, alt, fit, onBroken }: { media: PostMedia; alt: string; fit: "cover" | "contain"; onBroken: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    // 裸 <img>,不是 next/image:签名地址按请求鉴权,不能经图片优化代理转一道(同 moderation/MediaGrid)。
    <img
      src={mediaUrl(media.url)}
      alt={alt}
      loading="lazy"
      onLoad={() => setLoaded(true)}
      onError={onBroken}
      data-loaded={loaded ? "" : undefined}
      className={cn("h-full w-full", fit === "cover" ? "object-cover" : "object-contain", !loaded && LOADING_BG)}
    />
  );
}

export function PostMediaGrid({
  media,
  onRefetch,
  author,
  time,
}: {
  media: PostMedia[];
  /** 重拉帖子列表(拿新签的地址)。 */
  onRefetch: () => void;
  /** 查看器头部:作者与时间(已格式化)。 */
  author: string;
  time: string;
}) {
  const { t } = useI18n();
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const [viewing, setViewing] = useState<number | null>(null);
  if (!media.length) return null;

  const keyOf = (m: PostMedia) => `${m.id}:${m.url}`;
  const markBroken = (m: PostMedia) => setBroken((s) => new Set(s).add(keyOf(m)));
  const single = media.length === 1;
  const n = media.length;

  return (
    <>
      <ul
        data-media-grid=""
        data-count={n}
        aria-label={t("soul_app.circle.media.grid", { n: String(n) })}
        className={cn(
          single
            ? "max-w-[480px]"
            : "grid max-w-[400px] grid-cols-2 gap-1 max-[768px]:max-w-none max-[768px]:grid-cols-3 max-[768px]:gap-[3px]",
        )}
      >
        {media.map((m, i) => {
          const hiddenDesktop = i >= DESKTOP_CELLS;
          const hiddenNarrow = i >= NARROW_CELLS;
          const moreDesktop = i === DESKTOP_CELLS - 1 && n > DESKTOP_CELLS ? n - DESKTOP_CELLS : 0;
          const moreNarrow = i === NARROW_CELLS - 1 && n > NARROW_CELLS ? n - NARROW_CELLS : 0;
          const label = t("soul_app.circle.media.image", { i: String(i + 1) });
          return (
            <li
              key={keyOf(m)}
              data-media-cell={i}
              className={cn(
                "relative overflow-hidden",
                single ? "aspect-[16/10]" : "aspect-square",
                hiddenDesktop && "min-[769px]:hidden",
                hiddenNarrow && "max-[768px]:hidden",
              )}
            >
              {broken.has(keyOf(m)) ? (
                <Expired onRefetch={onRefetch} />
              ) : (
                <button type="button" onClick={() => setViewing(i)} className="block h-full w-full" aria-label={label}>
                  <Img media={m} alt="" fit="cover" onBroken={() => markBroken(m)} />
                  {moreDesktop || moreNarrow ? (
                    <span
                      data-media-more=""
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-0 flex items-center justify-center bg-[oklch(var(--color-ink)/0.55)] font-title font-semibold text-[oklch(var(--color-surface-1))]",
                        "text-xl max-[768px]:text-lg",
                        !moreDesktop && "min-[769px]:hidden",
                        !moreNarrow && "max-[768px]:hidden",
                      )}
                    >
                      <span className="max-[768px]:hidden">+{moreDesktop}</span>
                      <span className="min-[769px]:hidden">+{moreNarrow}</span>
                    </span>
                  ) : null}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <MediaViewer
        media={media}
        index={viewing}
        onIndex={setViewing}
        onClose={() => setViewing(null)}
        isBroken={(m) => broken.has(keyOf(m))}
        onBroken={markBroken}
        onRefetch={onRefetch}
        author={author}
        time={time}
      />
    </>
  );
}

export function MediaViewer({
  media,
  index,
  onIndex,
  onClose,
  isBroken,
  onBroken,
  onRefetch,
  author,
  time,
}: {
  media: PostMedia[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  isBroken: (m: PostMedia) => boolean;
  onBroken: (m: PostMedia) => void;
  onRefetch: () => void;
  author: string;
  time: string;
}) {
  const { t } = useI18n();
  const open = index !== null;
  const current = index !== null ? media[index] : undefined;
  const many = media.length > 1;
  const step = (d: number) => {
    if (index === null) return;
    onIndex((index + d + media.length) % media.length);
  };
  const arrow =
    "absolute top-1/2 z-[1] flex size-(--control-h-lg) -translate-y-1/2 items-center justify-center border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] text-lg text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]";

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          data-motion="fade"
          className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/0.78)] transition-opacity duration-base ease-enter data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <Dialog.Viewport className="fixed inset-0 z-dialog flex items-center justify-center p-4 max-[768px]:p-2">
          <Dialog.Popup
            data-media-viewer=""
            data-motion="fade"
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") step(1);
              else if (e.key === "ArrowLeft") step(-1);
            }}
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-[1040px] flex-col overflow-hidden rounded-panel border border-[oklch(var(--color-ink))] bg-[oklch(var(--color-surface-1))] shadow-overlay transition-opacity duration-base ease-enter data-ending-style:opacity-0 data-starting-style:opacity-0"
          >
            {current && index !== null ? (
              <>
                <div className="flex h-14 shrink-0 items-center gap-3 border-b border-[oklch(var(--color-line))] pl-[20px] pr-2">
                  <Dialog.Title className="min-w-0 truncate text-sm font-medium text-[oklch(var(--color-ink))]">
                    {author}
                  </Dialog.Title>
                  <span className="font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">{time}</span>
                  <span
                    data-testid="viewer-position"
                    className="ml-auto font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]"
                  >
                    {index + 1} / {media.length}
                  </span>
                  <Dialog.Close
                    aria-label={t("common.close")}
                    className="flex size-(--control-h-sm) items-center justify-center text-lg text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-2))]"
                  >
                    <span aria-hidden="true">✕</span>
                  </Dialog.Close>
                </div>

                <div className="relative h-[600px] max-h-[60dvh] min-h-0 shrink bg-[oklch(var(--color-surface-2))]">
                  {isBroken(current) ? (
                    <div className="flex h-full items-center justify-center p-8">
                      <div className="h-40 w-64">
                        <Expired onRefetch={onRefetch} />
                      </div>
                    </div>
                  ) : (
                    <Img
                      key={`${current.id}:${current.url}`}
                      media={current}
                      alt={caption(t, current, index)}
                      fit="contain"
                      onBroken={() => onBroken(current)}
                    />
                  )}
                  {many ? (
                    <>
                      <button type="button" onClick={() => step(-1)} aria-label={t("social.media.prev")} className={`${arrow} left-4`}>
                        <span aria-hidden="true">←</span>
                      </button>
                      <button type="button" onClick={() => step(1)} aria-label={t("social.media.next")} className={`${arrow} right-4`}>
                        <span aria-hidden="true">→</span>
                      </button>
                    </>
                  ) : null}
                  {/* 只写后端真给的:序号与像素尺寸(PostMedia 只有 id / url / width / height)。 */}
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-[oklch(var(--color-surface-1)/0.85)] px-2 font-mono text-xs tabular-nums text-[oklch(var(--color-ink-muted))]">
                    {caption(t, current, index)}
                  </span>
                </div>

                {many ? (
                  <div className="flex shrink-0 items-center gap-[6px] overflow-x-auto border-t border-[oklch(var(--color-line))] px-[20px] py-3">
                    {media.map((m, i) => (
                      <button
                        key={`${m.id}:${m.url}`}
                        type="button"
                        onClick={() => onIndex(i)}
                        aria-label={t("soul_app.circle.media.viewer", { i: String(i + 1), n: String(media.length) })}
                        aria-current={i === index ? "true" : undefined}
                        data-thumb={i}
                        className={cn(
                          "size-14 shrink-0 overflow-hidden",
                          i === index && "outline-2 -outline-offset-2 outline-[oklch(var(--color-ink))]",
                        )}
                      >
                        {isBroken(m) ? (
                          <span data-media-expired="" className="flex h-full w-full items-center justify-center border border-dashed border-[oklch(var(--color-line-strong))] text-[oklch(var(--color-ink-muted))]">
                            <span aria-hidden="true">◌</span>
                          </span>
                        ) : (
                          <Img media={m} alt="" fit="cover" onBroken={() => onBroken(m)} />
                        )}
                      </button>
                    ))}
                    <span className="ml-auto shrink-0 pl-3 text-xs text-[oklch(var(--color-ink-muted))] max-[768px]:hidden">
                      {t("social.media.viewer_hint")}
                    </span>
                  </div>
                ) : null}
              </>
            ) : null}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
