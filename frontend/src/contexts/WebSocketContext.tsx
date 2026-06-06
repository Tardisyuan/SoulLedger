"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WSClient, type WSStatus, type WSMessage } from "@/lib/ws/client";
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
        { queryClient, showToast },
      );
    },
    [queryClient, showToast],
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
        { queryClient, showToast },
      );
    },
    [queryClient, showToast],
  );

  const handleGenericEvent = useCallback(
    (event: Record<string, unknown>) => {
      dispatchEvent(event as EventPayload, { queryClient, showToast });
    },
    [queryClient, showToast],
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

  const send = useCallback((data: WSMessage) => {
    clientRef.current?.send(data);
  }, []);

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current?.connect();
  }, []);

  return (
    <WebSocketContext.Provider
      value={{
        status,
        isConnected: status === "connected",
        send,
        reconnect,
      }}
    >
      {children}
    </WebSocketContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useWebSocket() {
  return useContext(WebSocketContext);
}
