"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WSClient, type WSStatus, type WSMessage } from "@soulledger/core/ws/client";
import { onSessionResume } from "@soulledger/core/platform";
import { useTenant } from "./TenantContext";
import { useToast } from "./ToastContext";
import { dispatchEvent, type EventPayload } from "@/lib/events/event_registry";

// ── Types ────────────────────────────────────────────────────────────

interface WebSocketContextValue {
  /** Current connection status */
  status: WSStatus;
  /** Whether the WebSocket is connected */
  isConnected: boolean;
  /** Send a message to the server */
  send: (data: WSMessage) => void;
  /** Manually reconnect */
  reconnect: () => void;
}

// ── Context ──────────────────────────────────────────────────────────

const WebSocketContext = createContext<WebSocketContextValue>({
  status: "disconnected",
  isConnected: false,
  send: () => {},
  reconnect: () => {},
});

// ── Provider ─────────────────────────────────────────────────────────

export function WebSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  // As a string: `AuthUser.id` is a number and the social payload's
  // `following_id` arrives as a string off the wire, so comparing them raw
  // would be false for the one case the gate exists to catch.
  const currentUserId = user ? String(user.id) : undefined;
  const [status, setStatus] = useState<WSStatus>("disconnected");
  const clientRef = useRef<WSClient | null>(null);

  const handleNotification = useCallback(
    (notification: Record<string, unknown>) => {
      // Route through event registry
      dispatchEvent(
        {
          domain: "notification",
          event: "NOTIFICATION_CREATED",
          notification: notification as EventPayload["notification"],
        } as EventPayload,
        { queryClient, showToast, currentUserId },
      );
    },
    [queryClient, showToast, currentUserId],
  );

  const handleWorkflowEvent = useCallback(
    (event: Record<string, unknown>) => {
      dispatchEvent(
        {
          domain: "workflow",
          event: (event.event as string) || "",
          workflow_id: event.workflow_id as string,
          workflow_name: event.workflow_name as string,
          soul_name: event.soul_name as string,
          soul_id: event.soul_id as string,
          status: event.status as string,
          verdict: event.verdict as string,
        } as EventPayload,
        { queryClient, showToast, currentUserId },
      );
    },
    [queryClient, showToast, currentUserId],
  );

  const handleGenericEvent = useCallback(
    (event: Record<string, unknown>) => {
      dispatchEvent(event as EventPayload, { queryClient, showToast, currentUserId });
    },
    [queryClient, showToast, currentUserId],
  );

  // Connect / disconnect based on user state
  useEffect(() => {
    if (!user) {
      clientRef.current?.disconnect();
      clientRef.current = null;
      return;
    }

    const client = new WSClient({
      onStatusChange: setStatus,
      onNotification: handleNotification,
      onWorkflowEvent: handleWorkflowEvent,
      onGenericEvent: handleGenericEvent,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [user, handleNotification, handleWorkflowEvent, handleGenericEvent]);

  /**
   * A suspended session coming back re-opens the socket.
   *
   * `WSClient` keeps liveness with a `setInterval` heartbeat and re-opens from
   * exactly one place — `onclose` → `scheduleReconnect()` — and both are
   * timers. A host that freezes the JavaScript loop (React Native
   * backgrounding the app; a browser stashing the page in the bfcache) stops
   * both: the socket dies with nothing running to notice, and the client comes
   * back either believing it is still connected or holding a backoff timer
   * paused mid-count. `WSClient.reconnect()` has existed the whole time. This
   * is the trigger it was missing, and it is the line
   * `packages/core/src/platform/index.ts` names in the doc on `onSessionResume`
   * as not yet written.
   *
   * NO STATUS GUARD, AND THAT IS THE DELIBERATE PART. `client.reconnect()` is
   * called unconditionally because the two obvious guards are both wrong here:
   *
   *   - `getStatus() === "connected"` → skip. That skips exactly the case this
   *     exists for. `setStatus` only leaves `"connected"` from inside
   *     `onclose`; if that callback was dropped while the loop was frozen, the
   *     status still reads `"connected"` over a socket that is gone, and the
   *     guard would decline to fix the one failure it was written for.
   *   - reconnect unconditionally *by tearing down first* — what this
   *     context's own `reconnect()` below does, `disconnect()` then
   *     `connect()`. That would drop a healthy socket every time the operator
   *     steps back into the tab, trading a rare dead link for a guaranteed gap
   *     in delivery.
   *
   * So the decision is left where the fact lives: `WSClient.connect()` returns
   * early when `readyState` is OPEN or CONNECTING, so `reconnect()` over a
   * healthy link is a no-op, and over a dead one — including a dead one whose
   * `_status` still says `"connected"` — it builds a fresh socket. That early
   * return is in a file this one does not own, so it is pinned from here by an
   * assertion that counts sockets rather than reading a status string:
   * `WebSocketContext.sessionResume.test.tsx`, "opens no second socket, and
   * closes none, when the link is already healthy".
   *
   * Empty deps on purpose. The handler reaches the client through `clientRef`
   * at call time instead of closing over it, so it cannot go stale the way the
   * three `useCallback` handlers above did before `6d3d05c` — and the
   * subscription is therefore installed once for the life of the provider
   * rather than being torn down and rebuilt on every `user` identity change
   * that `TenantContext`'s hydration causes. The returned unsubscribe is the
   * cleanup: this listener sits on `window`, which outlives the tree.
   */
  useEffect(() => onSessionResume(() => clientRef.current?.reconnect()), []);

  const send = useCallback((data: WSMessage) => {
    clientRef.current?.send(data);
  }, []);

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current?.connect();
  }, []);

  const value = useMemo(
    () => ({
      status,
      isConnected: status === "connected",
      send,
      reconnect,
    }),
    [status, send, reconnect]
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useWebSocket() {
  return useContext(WebSocketContext);
}
