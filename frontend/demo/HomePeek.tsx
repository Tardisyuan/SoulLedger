"use client";

import { useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Seal } from "@/src/components/plaque/Seal";
import { useI18n } from "@/src/contexts/I18nContext";
import { useMedia } from "./HomePreview";
import { PEEK_FRAMES, PEEK_MS, peekStep } from "./homePreviewFrames";
import { RouteShape } from "./RouteShape";

type Frame = (typeof PEEK_FRAMES)[number];

/** The four frames, drawn by components (no screenshots): the bench's seal, the road, the soul's phone, the farewell. */
function FrameArt({ frame }: { frame: Frame }) {
  const { t } = useI18n();
  const art: Record<Frame, ReactNode> = {
    bench: (
      <div className="flex items-center justify-center gap-4">
        <div className="demo-peek-sheet flex flex-col gap-2 p-3" aria-hidden="true">
          <span className="demo-peek-line w-16" />
          <span className="demo-peek-line w-12" />
          <span className="demo-peek-line w-16" />
          <span className="demo-peek-line w-8" />
        </div>
        <Seal size={52} civ="cn" glyphs={null} decorative className="demo-peek-seal" />
      </div>
    ),
    road: <RouteShape shape="line" className="h-auto w-full max-w-60" />,
    app: (
      <div className="demo-peek-phone flex flex-col gap-2 p-3" aria-hidden="true">
        <span className="demo-peek-line demo-peek-accent w-12" />
        <span className="demo-peek-line w-16" />
        <span className="demo-peek-line w-12" />
        <span className="demo-peek-line demo-peek-accent mt-auto w-16" />
      </div>
    ),
    farewell: (
      <div className="text-center">
        <p className="m-0 font-title text-xl text-[oklch(var(--color-ink))]">{t("auth.goodbye.title")}</p>
        <p className="m-0 mt-2 text-sm text-[oklch(var(--color-ink-muted))]">{t("auth.goodbye.line.cn")}</p>
      </div>
    ),
  };
  return <div className="flex h-40 items-center justify-center" data-civ="cn">{art[frame]}</div>;
}

/**
 * 「先看 30 秒」(Design 第二十七批 §一.6): an overlay, mounted only while open. Four frames, 7 s each, with a progress
 * bar; prev / next; the last button is the page's primary action. Narrow: full screen, one frame at a time, swipe.
 * Focus trap and Escape come from Base UI's dialog (the same primitive as `BaseModal`).
 */
export function HomePeek({ open, onClose, onStart }: { open: boolean; onClose: () => void; onStart: (from: HTMLElement) => void }) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-dialog bg-[oklch(var(--color-scrim)/var(--scrim-alpha))]" />
        <Dialog.Viewport className="fixed inset-0 z-dialog flex items-center justify-center md:p-4">
          <Dialog.Popup data-testid="demo-home-peek" className="demo-peek flex w-full flex-col gap-4 p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                <Dialog.Title className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t("demo.home.peek_title")}</Dialog.Title>
                <Dialog.Description className="m-0 text-sm text-[oklch(var(--color-ink-subtle))]">{t("demo.home.peek_sub")}</Dialog.Description>
              </div>
              <Dialog.Close aria-label={t("common.close")} className="flex size-8 shrink-0 items-center justify-center text-lg text-[oklch(var(--color-ink-muted))]">
                ×
              </Dialog.Close>
            </div>
            {open && <PeekFrames onStart={onStart} />}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PeekFrames({ onStart }: { onStart: (from: HTMLElement) => void }) {
  const { t } = useI18n();
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const [at, setAt] = useState(0);
  const swipe = useRef<number | null>(null);
  const step = (by: number) => setAt((i) => peekStep(i, by));
  return (
    <>
      <ol
        className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-4"
        onPointerDown={(e) => (swipe.current = e.clientX)}
        onPointerUp={(e) => {
          const from = swipe.current;
          swipe.current = null;
          if (from !== null && Math.abs(e.clientX - from) > 40) step(e.clientX < from ? 1 : -1);
        }}
      >
        {PEEK_FRAMES.map((frame, i) => (
          <li key={frame} data-frame={frame} aria-current={i === at ? "step" : undefined} className="demo-peek-tile flex min-w-0 flex-col gap-3 p-3">
            <span aria-hidden="true" className="demo-peek-progress">
              {i === at ? (
                <span
                  className="demo-peek-progress-fill"
                  data-run={reduced ? undefined : ""}
                  style={{ animationDuration: `${PEEK_MS}ms` }}
                  onAnimationEnd={(e) => {
                    if (e.animationName === "demo-peek-progress" && !reduced) step(1);
                  }}
                />
              ) : (
                <span className="demo-peek-progress-fill" data-full={i < at ? "" : undefined} />
              )}
            </span>
            <button type="button" onClick={() => setAt(i)} className="flex flex-col gap-3 text-left">
              <FrameArt frame={frame} />
              <span className="text-sm text-[oklch(var(--color-ink))]">
                <span className="text-[oklch(var(--color-ink-subtle))]">{i + 1}</span> {t(`demo.home.peek_frames.${frame}`)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <button type="button" disabled={at === 0} onClick={() => step(-1)} className="demo-peek-nav h-11 px-3 text-sm disabled:opacity-40">
          ← {t("demo.home.peek_prev")}
        </button>
        <button type="button" disabled={at === PEEK_FRAMES.length - 1} onClick={() => step(1)} className="demo-peek-nav h-11 px-3 text-sm disabled:opacity-40">
          {t("demo.home.peek_next")} →
        </button>
        <button
          type="button"
          data-testid="demo-home-peek-done"
          onClick={(e: MouseEvent<HTMLButtonElement>) => onStart(e.currentTarget)}
          className="demo-home-cta inline-flex h-12 items-center gap-2 px-6 text-md max-md:w-full max-md:justify-center"
        >
          {t("demo.home.peek_done")} <span aria-hidden="true">→</span>
        </button>
      </div>
    </>
  );
}
