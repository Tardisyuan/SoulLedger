"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { useWebSocket } from "@/src/contexts/WebSocketContext";

/**
 * ConnectionStatus — the realtime link, and the way back when it is gone.
 *
 * THE DEAD END THIS FIXES. `WSClient` gives up after its retry budget, and on
 * a 4001 (auth) close it does not retry at all; either way `status` becomes
 * `"failed"` and stays there for the life of the page. This component rendered
 * a red dot and the word "Failed" and offered nothing — while
 * `WebSocketContext` had been exporting `reconnect()` the whole time. The only
 * recovery an operator had was to guess that reloading would help.
 *
 * Two other things went with it, both of the kind this repo keeps finding:
 * every label was hardcoded English on a UI that ships three bundles, and the
 * dots were raw `bg-emerald-500` / `bg-yellow-500` / `bg-red-500` rather than
 * the status tokens — which is why they were the same colour in both themes
 * while everything around them changed.
 */
export function ConnectionStatus() {
  const { status, reconnect } = useWebSocket();
  const { user } = useTenant();
  const { t } = useI18n();

  if (!user) return null;

  const config = {
    connected: { token: "--color-status-success", key: "connected", pulse: false },
    connecting: { token: "--color-status-warning", key: "connecting", pulse: true },
    reconnecting: { token: "--color-status-warning", key: "reconnecting", pulse: true },
    disconnected: { token: "--color-status-error", key: "disconnected", pulse: false },
    failed: { token: "--color-status-error", key: "failed", pulse: false },
  } as const;

  const { token, key, pulse } = config[status] ?? config.disconnected;
  const label = t(`connection.${key}`);

  // Offered for both terminal states. `disconnected` can also be terminal —
  // the client reaches it after an explicit disconnect — and a button that
  // does nothing useful there is a smaller cost than no way back from it.
  const canRetry = status === "failed" || status === "disconnected";

  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`w-2 h-2 ${pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: `oklch(var(${token}))` }}
      />
      {/* `role="status"`: the link dropping is a change the operator did not
          make and needs told about, and the dot alone says nothing to a
          screen reader. */}
      <span role="status" className="text-2xs text-[oklch(var(--color-ink-subtle))] hidden sm:inline">
        {label}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={reconnect}
          className="text-2xs text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))] underline underline-offset-2 transition-colors"
        >
          {t("connection.retry")}
        </button>
      )}
    </div>
  );
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * The browser says there is no network (v3 离线条:`navigator.onLine === false`, kept current by
 * the `offline` / `online` events). `onLine === true` only means "some network", so this is the
 * one direction it can be trusted in. The server render has no navigator: online.
 */
export function useBrowserOffline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine === false, () => false);
}

/** Whether the link-down pill is showing (offline, or the socket down and not just connecting). */
export function useConnectionBannerShown(): boolean {
  const { status } = useWebSocket();
  const { user } = useTenant();
  const offline = useBrowserOffline();
  return offline || (!!user && status !== "connected" && status !== "connecting");
}

/** v4 第八批:连上之后胶囊淡出的时长。 */
/** = `--transition-duration-base`(`duration-base`,240ms)—— 淡出完再清空内容。 */
const FADE_MS = 240;

type Tone = "warn" | "neg" | "offline";
/** The dot and the 2px rule: amber while it retries, red when it gave up, grey offline. `--color-amber` is
 *  for marks only, never text — the pill's words are ink. */
const TONE_COLOUR: Record<Tone, string> = {
  warn: "bg-[oklch(var(--color-amber))]",
  neg: "bg-[oklch(var(--color-danger))]",
  offline: "bg-[oklch(var(--color-faint-text))]",
};

/**
 * 规范 v1: the connection state is not a standing masthead control. It appears only when the link is
 * down — the reason, and a way back when there is one. Connected or still connecting: nothing.
 *
 * v4 第八批第 4 条 (Design, 2026-11-06): a pill IN the toolbar, after the path, plus a 2px rule in the
 * status colour along the toolbar's lower edge. The toolbar is 52 high either way, so nothing moves and
 * nothing is covered. This replaces Design E 组's 28px bar fixed across the top of the viewport, which
 * covered the top of every toolbar button (the 问一问 panel had to start below it), and the in-flow
 * version that was tried and reverted (`44ca2db4`) because it pushed the page down 28px when it came up
 * (`connection-banner-does-not-shift-content.spec.ts`, `content-slot-fits-viewport.spec.ts`).
 *
 * ≤ 768 (393): the toolbar has no room for a second pill, so the same pill floats, centred, just under
 * the toolbar's lower edge — fixed, over the top of the content, pushing nothing. No rule there.
 *
 * Reconnecting: amber dot, pulsing. Failed (or disconnected — terminal too): red dot and 重连. Offline:
 * grey dot, no button — queries refetch on `online` by themselves, and if the socket gave up meanwhile
 * the pill turns red and offers 重连 then. On reconnect the pill fades out over 240ms (`duration-base`), no 「已连接」.
 */
export function ConnectionBanner() {
  const { status, reconnect } = useWebSocket();
  const { t } = useI18n();
  const shown = useConnectionBannerShown();
  const offline = useBrowserOffline();

  // Offline outranks the socket: with no network the socket is down *because* of it.
  const tone: Tone | null = !shown ? null : offline ? "offline" : status === "reconnecting" ? "warn" : "neg";
  const reason = !tone ? null : offline ? t("connection.offline") : t(`connection.${status}`);

  // The last state shown, kept for the fade after the link comes back (derived state, set during render).
  const [last, setLast] = useState<{ tone: Tone; reason: string } | null>(null);
  if (tone && reason && (last?.tone !== tone || last?.reason !== reason)) setLast({ tone, reason });
  useEffect(() => {
    if (tone) return;
    const id = window.setTimeout(() => setLast(null), FADE_MS);
    return () => window.clearTimeout(id);
  }, [tone]);

  const view = tone && reason ? { tone, reason } : last;
  if (!view) return null;
  const leaving = !tone;
  const canRetry = view.tone === "neg";

  return (
    <>
      {/* The pill. Desktop: in the toolbar's row, after the breadcrumb. ≤ 768: floats under the toolbar. */}
      <span
        role="status"
        aria-live="polite"
        data-testid="connection-banner"
        data-tone={view.tone}
        data-offline={view.tone === "offline" ? "true" : undefined}
        className={`inline-flex h-7.5 min-w-0 shrink items-center gap-2 whitespace-nowrap rounded-[9999px] border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-2))] pl-2 text-xs text-[oklch(var(--color-ink))] transition-opacity duration-base motion-reduce:transition-none max-[768px]:fixed max-[768px]:left-1/2 max-[768px]:top-[calc(var(--spacing)*15+var(--imp-h))] max-[768px]:z-masthead max-[768px]:max-w-[calc(100vw-32px)] max-[768px]:-translate-x-1/2 ${
          canRetry ? "pr-1" : "pr-3"
        } ${leaving ? "opacity-0" : "opacity-100"}`}
      >
        <span aria-hidden="true" className={`relative size-2 shrink-0 rounded-[50%] ${TONE_COLOUR[view.tone]}`}>
          {view.tone === "warn" ? (
            <span className="absolute -inset-[3px] animate-ping rounded-[50%] border-2 border-[oklch(var(--color-amber))] opacity-60 motion-reduce:animate-none" />
          ) : null}
        </span>
        {/* A long egy / en reason is cut, and readable in full on hover. */}
        <span className="min-w-0 truncate" title={view.reason}>{view.reason}</span>
        {canRetry ? (
          <button
            type="button"
            onClick={reconnect}
            className="h-6 shrink-0 rounded-[9999px] px-2 text-2xs text-[oklch(var(--color-ink))] hover:bg-[oklch(var(--color-surface-3))] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[oklch(var(--color-focus))]"
          >
            {t("connection.retry")}
          </button>
        ) : null}
      </span>
      {/* The toolbar's lower edge in the status colour (desktop only). Absolute in the sticky toolbar, over
          its 1px border: it takes no height. */}
      <span
        aria-hidden="true"
        data-testid="connection-rule"
        className={`pointer-events-none absolute inset-x-0 -bottom-px h-0.5 transition-opacity duration-base motion-reduce:transition-none max-[768px]:hidden ${TONE_COLOUR[view.tone]} ${
          leaving ? "opacity-0" : "opacity-80"
        }`}
      />
    </>
  );
}
