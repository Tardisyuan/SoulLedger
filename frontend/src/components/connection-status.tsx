"use client";

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
        className={`w-2 h-2 rounded-full ${pulse ? "animate-pulse" : ""}`}
        style={{ backgroundColor: `hsl(var(${token}))` }}
      />
      {/* `role="status"`: the link dropping is a change the operator did not
          make and needs told about, and the dot alone says nothing to a
          screen reader. */}
      <span role="status" className="text-01 text-[hsl(var(--color-ink-subtle))] hidden sm:inline">
        {label}
      </span>
      {canRetry && (
        <button
          type="button"
          onClick={reconnect}
          className="text-01 text-[hsl(var(--color-ink-muted))] hover:text-[hsl(var(--color-ink))] underline underline-offset-2 transition-colors"
        >
          {t("connection.retry")}
        </button>
      )}
    </div>
  );
}
