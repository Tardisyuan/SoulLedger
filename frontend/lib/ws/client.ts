/**
 * WebSocket client for SoulLedger real-time notifications.
 *
 * Connects to ws://host/ws/notifications/?token=<jwt>
 * Handles reconnection with exponential backoff + jitter.
 * Proper state machine: CONNECTING → CONNECTED → DISCONNECTED → RECONNECTING → FAILED
 */

export type WSStatus = "connecting" | "connected" | "disconnected" | "reconnecting" | "failed";

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
}

function getWebSocketUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  return apiBase.replace(/^http/, "ws").replace("/api/v1", "") + "/ws/notifications/";
}

function getAccessToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookieVal = document.cookie
    .split("; ")
    .find((c) => c.startsWith("soulledger_access="))
    ?.split("=")[1];
  if (cookieVal) return cookieVal;
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage.getItem("soulledger_access");
  }
  return null;
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
            this.options.onWorkflowEvent(data as unknown as Record<string, unknown>);
            break;
          case "error":
            console.warn("[WS] Server error:", data.message);
            break;
          default:
            if (data.domain && data.event) {
              this.options.onGenericEvent(data as unknown as Record<string, unknown>);
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

      if (event.code === 4001) {
        this.setStatus("failed");
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose fires after onerror
    };
  }

  /** Manually disconnect. Client can reconnect later. */
  disconnect(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
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
