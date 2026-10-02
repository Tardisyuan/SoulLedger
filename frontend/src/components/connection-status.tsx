"use client";

import { useSyncExternalStore } from "react";
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

/** Whether the link-down bar is showing. The shell reads it to start the 问一问 panel below the bar. */
export function useConnectionBannerShown(): boolean {
  const { status } = useWebSocket();
  const { user } = useTenant();
  const offline = useBrowserOffline();
  return offline || (!!user && status !== "connected" && status !== "connecting");
}

/**
 * 规范 v1: the connection state is not a standing masthead control any more.
 * It appears only when the link is down — a warning bar with the reason and a
 * retry. Connected or still connecting: nothing.
 *
 * Design E 组: the bar is global state, not part of the plaque — it sits at the
 * very top of the viewport and spans all of it, pillar and 问一问 panel included
 * (`fixed inset-x-0 top-0`). It floats: appearing a while after load, it must not
 * move anything from under the pointer (the E2E avatar click that missed 1 in 16).
 * Its height is fixed at 28 px (`h-7`) so the panel can start exactly below it
 * (`top-7`, see OfficerAssistPanel) instead of being covered by it.
 */
export function ConnectionBanner() {
  const { status, reconnect } = useWebSocket();
  const { t } = useI18n();
  const shown = useConnectionBannerShown();
  const offline = useBrowserOffline();
  if (!shown) return null;
  // Offline outranks the socket: with no network the socket is down *because* of it, and
  // 「离线 · 当前内容可能不是最新版本」 tells the operator what to distrust. Its retry re-dials
  // the socket; queries refetch by themselves on `online` (TanStack Query's onlineManager).
  const canRetry = offline || status === "failed" || status === "disconnected";
  const reason = offline ? t("connection.offline") : t(`connection.${status}`);
  return (
    <div
      role="status"
      data-testid="connection-banner"
      data-offline={offline ? "true" : undefined}
      className="fixed inset-x-0 top-0 z-drawer flex h-7 items-center gap-3 border-t-4 border-t-[oklch(var(--color-warning))] border-b border-[oklch(var(--color-line))] bg-[oklch(var(--color-warning-tint))] px-4 text-xs text-[oklch(var(--color-warning))] md:px-8"
    >
      <span aria-hidden="true">!</span>
      {/* Fixed 28 px: a long egy / en reason is cut, and readable in full on hover. */}
      <span className="flex-1 truncate" title={reason}>{reason}</span>
      {canRetry ? (
        <button type="button" onClick={reconnect} className="underline underline-offset-2">
          {offline ? t("common.retry") : t("connection.retry")}
        </button>
      ) : null}
    </div>
  );
}
