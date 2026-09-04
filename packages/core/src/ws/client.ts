/**
 * WebSocket client for SoulLedger real-time notifications.
 *
 * Connects to ws://host/ws/notifications/?token=<jwt>
 * Handles reconnection with exponential backoff + jitter.
 * Proper state machine: CONNECTING → CONNECTED → DISCONNECTED → RECONNECTING → FAILED
 */
/* The access token is read through the shared port. This file used to carry
 * its own copy of the reader and its own paraphrase of the warning that goes
 * with it; `../platform/index.ts` now holds one of each. */
import { getAccessToken, getWebSocketUrl } from "../platform/index";


export type WSStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "failed";

/**
 * The close code the server uses to say "your token is not good enough".
 *
 * `backend/apps/core/ws_auth.py` closes with 4001 for a missing, invalid or
 * expired token, and `apps/notifications/consumers.py` does the same for a
 * connection that fails the tenant check. It was the bare literal `4001` in two
 * places on this side, which is the shape that let `CIVILIZATION_ICONS` drift
 * into two tables that agreed on values and disagreed in their comments.
 */
export const WS_CLOSE_AUTH_REJECTED = 4001;

/**
 * Whether a close with this code should be followed by another attempt.
 *
 * WHY `undefined` IS A CASE AND NOT AN OVERSIGHT. Both clients used to ask
 * `event.code === 4001` directly, while `platform/host-globals.d.ts` declares
 * `readonly code?: number` — **optional**, because the package cannot promise
 * that every host delivers a close code. On a host that does not,
 * `undefined === 4001` is false, so an auth rejection fell through to
 * `scheduleReconnect()` and was retried up to `maxReconnectAttempts` (50 for
 * the notifications client, `Infinity` for the social one). The type admitted a
 * case the code did not handle; nothing said which way it should go.
 *
 * IT GOES TO "RETRY", DELIBERATELY, and this is the argument. The two mistakes
 * available are not symmetric:
 *
 *   - Retrying a rejection we could not identify costs a bounded number of
 *     backed-off attempts (capped at 30s apiece), and `connect()` re-reads the
 *     token through `getAccessToken()` on every attempt — so a socket dropped
 *     while the API client was mid-refresh comes back on its own. That is a
 *     real, ordinary sequence, not a hypothetical.
 *   - Refusing to retry an *unidentified* close would permanently disable
 *     reconnection on any host that omits codes — every transient network drop
 *     would end the session's realtime layer for good, silently.
 *
 * So the unknown code is treated as the transient one. The cost is stated
 * rather than hidden: on a host that both omits close codes and rejects the
 * token, this retries instead of reporting `failed`. If such a host turns up,
 * the fix is a close *reason* check or a host port — not flipping this line,
 * which would trade a noisy failure for a silent one.
 *
 * Browsers do not exercise this: they synthesise 1005 when no close frame
 * arrives. It is the type's admission that is being closed, not an observed
 * platform. Pinned by `__tests__/closeWithoutCode.test.ts`.
 */
export function shouldReconnectAfterClose(code: number | undefined): boolean {
  if (code === undefined) return true;
  return code !== WS_CLOSE_AUTH_REJECTED;
}

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

export interface WSClientOptions {
  maxReconnectAttempts?: number;
  initialReconnectDelay?: number;
  maxReconnectDelay?: number;
  heartbeatInterval?: number;
  heartbeatTimeout?: number;
  onStatusChange?: (status: WSStatus) => void;
  onMessage?: (message: WSMessage) => void;
  onConnected?: (data: { user_id: number; tenant_code: string; permissions: string[] }) => void;
  onNotification?: (notification: Record<string, unknown>) => void;
  onWorkflowEvent?: (event: Record<string, unknown>) => void;
  onGenericEvent?: (event: Record<string, unknown>) => void;
  /** 服务端对 `{"type":"permission.refresh"}` 的应答。见 onmessage 里的 case。 */
  onPermissionsRefreshed?: (permissions: string[]) => void;
}




export class WSClient {
  private ws: WebSocket | null = null;
  private _status: WSStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatMissed = 0;
  private options: Required<WSClientOptions>;
  /** False = client is active (can reconnect). True = permanently shut down. */
  private shutdown = false;

  constructor(options: WSClientOptions = {}) {
    this.options = {
      maxReconnectAttempts: 50,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 30000,
      heartbeatTimeout: 3,
      onStatusChange: () => {},
      onMessage: () => {},
      onConnected: () => {},
      onNotification: () => {},
      onWorkflowEvent: () => {},
      onGenericEvent: () => {},
      onPermissionsRefreshed: () => {},
      ...options,
    };
  }

  // ── Public API ───────────────────────────────────────────────────────

  connect(): void {
    if (this.shutdown) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    const token = getAccessToken();
    if (!token) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");

    try {
      this.ws = new WebSocket(`${getWebSocketUrl()}?token=${encodeURIComponent(token)}`);
    } catch {
      this.setStatus("disconnected");
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.heartbeatMissed = 0;
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSMessage;
        this.options.onMessage(data);

        switch (data.type) {
          case "connected":
            this.setStatus("connected");
            this.options.onConnected(data as unknown as { user_id: number; tenant_code: string; permissions: string[] });
            break;
          case "pong":
            this.heartbeatMissed = 0;
            break;
          case "notification":
            this.options.onNotification(data.notification as Record<string, unknown>);
            break;
          case "workflow":
            this.options.onWorkflowEvent(data);
            break;
          case "permission.refreshed":
            // 后端一直在应答这条,而前端**从来没有 case 处理它** ——
            // 落到 default,`domain`/`event` 都没有,于是被静默丢弃。
            // 全仓 grep `permission.refresh` 零命中:这条通道两端都在,
            // 中间没有接线。
            //
            // 现在收下它。发送端仍然由调用方决定(`send({type:
            // "permission.refresh"})`),这里只保证送回来的新权限集不会掉在地上。
            this.options.onPermissionsRefreshed(
              (data.permissions as string[] | undefined) ?? []
            );
            break;
          case "error":
            console.warn("[WS] Server error:", data.message);
            break;
          default:
            if (data.domain && data.event) {
              this.options.onGenericEvent(data);
            }
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      if (this.shutdown) return;

      if (!shouldReconnectAfterClose(event.code)) {
        this.setStatus("failed");
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  /** Manually disconnect. Client can reconnect later.
   *
   * DETACHING `onclose` IS THE POINT, NOT TIDINESS. This used to be
   * `this.ws.close(); this.ws = null;` with no `shutdown` flag set — and the
   * browser then fires `close` on that socket **after** we have dropped our
   * reference to it. `onclose` sees `this.shutdown === false` and a code of
   * 1005 (not 4001), falls through to `scheduleReconnect()`, and one second
   * later **this discarded instance opens a brand-new WebSocket** that nothing
   * on the React side holds a reference to. Its `onStatusChange` still points
   * at the setState of an unmounted component.
   *
   * `WebSocketContext.tsx` calls `disconnect()` in its cleanup, and the `user`
   * object changes identity at least once while TenantContext hydrates — so
   * every session left at least one zombie behind.
   *
   * Why no test caught it: `src/__tests__/support/wsHarness.ts`'s
   * `FakeWebSocket.close()` only incremented a counter and set `readyState`.
   * **It never fired `onclose`** — unlike a real WebSocket. The two tests for
   * `close()` in `wsClient.reconnect.test.ts` reach for `serverClose(1006)`
   * explicitly to simulate that, so the difference was known; `disconnect()`
   * just never had the same treatment. The harness is fixed alongside this.
   */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      // Detach first. A close we asked for must not be reported to the handler
      // whose job is to react to closes we did not ask for.
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  /** Permanently shut down — no reconnect possible. */
  close(): void {
    this.shutdown = true;
    this.disconnect();
  }

  /** Manually reconnect — always works (resets shutdown flag). */
  reconnect(): void {
    this.shutdown = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  send(data: WSMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  getStatus(): WSStatus {
    return this._status;
  }

  // ── Private ───────────────────────────────────────────────────────

  private setStatus(status: WSStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.options.onStatusChange(status);
  }

  private scheduleReconnect(): void {
    if (this.shutdown) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setStatus("failed");
      return;
    }

    this.setStatus("reconnecting");

    // Exponential backoff with jitter
    const base = this.options.initialReconnectDelay * Math.pow(2, this.reconnectAttempts);
    const jitter = base * (0.5 + Math.random() * 0.5);
    const delay = Math.min(jitter, this.options.maxReconnectDelay);
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatMissed = 0;
    this.heartbeatTimer = setInterval(() => {
      this.heartbeatMissed++;
      if (this.heartbeatMissed >= this.options.heartbeatTimeout) {
        console.warn("[WS] Heartbeat timeout — forcing reconnect");
        this.ws?.close();
        return;
      }
      this.send({ type: "heartbeat" });
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
