/**
 * Social WebSocket Client — unified realtime layer for social features.
 *
 * Features:
 *   - Auto-reconnect with exponential backoff
 *   - JWT auth attachment (query string + token refresh)
 *   - Tenant isolation (joins tenant group automatically)
 *   - Event deduplication (idempotent event processing)
 *   - Offline queue (buffers messages when disconnected)
 *   - Heartbeat keepalive
 *   - Event subscription registry
 */

export type SocialWSStatus = "connecting" | "connected" | "disconnected" | "reconnecting";

export interface SocialEvent {
  domain: string;
  event: string;
  [key: string]: unknown;
}

export type SocialEventHandler = (event: SocialEvent) => void;

export interface SocialClientOptions {
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Initial reconnect delay in ms (default: 1000) */
  initialReconnectDelay?: number;
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectDelay?: number;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Offline queue max size (default: 100) */
  offlineQueueSize?: number;
  /** Called when status changes */
  onStatusChange?: (status: SocialWSStatus) => void;
  /** Called when any event is received */
  onEvent?: (event: SocialEvent) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

function getWebSocketUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
  return apiBase.replace(/^http/, "ws").replace("/api/v1", "") + "/ws/notifications/";
}

function getAccessToken(): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((c) => c.startsWith("soulledger_access="))
    ?.split("=")[1];
  if (cookie) return cookie;
  if (typeof sessionStorage !== "undefined") {
    return sessionStorage.getItem("soulledger_access");
  }
  return null;
}

// ── Event Deduplicator ────────────────────────────────────────────────

class EventDeduplicator {
  private seen = new Map<string, number>();
  private readonly ttlMs: number;

  constructor(ttlMs = 5000) {
    this.ttlMs = ttlMs;
  }

  /** Returns true if this is a duplicate event (should be skipped). */
  isDuplicate(event: SocialEvent): boolean {
    const key = this.getKey(event);
    const now = Date.now();
    const lastSeen = this.seen.get(key);

    if (lastSeen && now - lastSeen < this.ttlMs) {
      return true;
    }

    this.seen.set(key, now);
    this.cleanup();
    return false;
  }

  private getKey(event: SocialEvent): string {
    return `${event.domain}:${event.event}:${JSON.stringify(event)}`;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, timestamp] of this.seen) {
      if (now - timestamp > this.ttlMs * 2) {
        this.seen.delete(key);
      }
    }
  }

  reset(): void {
    this.seen.clear();
  }
}

// ── Offline Queue ─────────────────────────────────────────────────────

class OfflineQueue {
  private queue: SocialEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  enqueue(event: SocialEvent): void {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift(); // Drop oldest
    }
    this.queue.push(event);
  }

  flush(): SocialEvent[] {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  get size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }
}

// ── Social WebSocket Client ───────────────────────────────────────────

export class SocialWSClient {
  private ws: WebSocket | null = null;
  private status: SocialWSStatus = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private options: Required<SocialClientOptions>;
  private deduplicator: EventDeduplicator;
  private offlineQueue: OfflineQueue;
  private subscribers = new Map<string, Set<SocialEventHandler>>();
  private globalHandlers: Set<SocialEventHandler> = new Set();

  constructor(options: SocialClientOptions = {}) {
    this.options = {
      maxReconnectAttempts: Infinity,
      initialReconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 30000,
      offlineQueueSize: 100,
      onStatusChange: () => {},
      onEvent: () => {},
      ...options,
    };
    this.deduplicator = new EventDeduplicator();
    this.offlineQueue = new OfflineQueue(this.options.offlineQueueSize);
  }

  // ── Connection ────────────────────────────────────────────────────

  connect(): void {
    if (this.disposed) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const token = getAccessToken();
    if (!token) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");

    try {
      const url = `${getWebSocketUrl()}?token=${encodeURIComponent(token)}`;
      this.ws = new WebSocket(url);
    } catch {
      this.setStatus("disconnected");
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.deduplicator.reset();
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "connected") {
          this.setStatus("connected");
          this.flushOfflineQueue();
          return;
        }

        if (data.type === "pong") return;

        // Route domain events
        if (data.domain && data.event) {
          const socialEvent: SocialEvent = data as SocialEvent;

          if (!this.deduplicator.isDuplicate(socialEvent)) {
            this.emit(socialEvent);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      if (this.disposed) return;

      if (event.code === 4001) {
        this.setStatus("disconnected");
        return;
      }

      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  disconnect(): void {
    this.disposed = true;
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

  // ── Subscription ──────────────────────────────────────────────────

  /** Subscribe to a specific event type. Returns unsubscribe function. */
  subscribe(eventType: string, handler: SocialEventHandler): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);

    return () => {
      this.subscribers.get(eventType)?.delete(handler);
    };
  }

  /** Subscribe to all events. Returns unsubscribe function. */
  onEvent(handler: SocialEventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  // ── Send ──────────────────────────────────────────────────────────

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      // Queue for offline delivery
      this.offlineQueue.enqueue(data as SocialEvent);
    }
  }

  // ── Status ────────────────────────────────────────────────────────

  getStatus(): SocialWSStatus {
    return this.status;
  }

  getOfflineQueueSize(): number {
    return this.offlineQueue.size;
  }

  // ── Private ───────────────────────────────────────────────────────

  private setStatus(status: SocialWSStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.options.onStatusChange(status);
  }

  private emit(event: SocialEvent): void {
    // Global handlers
    for (const handler of this.globalHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.error("[SocialWS] Global handler error:", err);
      }
    }

    // Event-specific handlers
    const handlers = this.subscribers.get(event.event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(event);
        } catch (err) {
          console.error(`[SocialWS] Handler error for ${event.event}:`, err);
        }
      }
    }

    // WSClient callback
    this.options.onEvent(event);
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("reconnecting");

    const delay = Math.min(
      this.options.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.options.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, this.options.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private flushOfflineQueue(): void {
    const messages = this.offlineQueue.flush();
    for (const msg of messages) {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(msg));
      }
    }
  }
}
