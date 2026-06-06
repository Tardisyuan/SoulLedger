/**
 * useSocialEventBus — unified event subscription hook for social features.
 *
 * Provides:
 *   - Event subscription by type
 *   - Global event listener
 *   - Connection status
 *   - Auto-connect/disconnect lifecycle
 *   - Event deduplication (handled by SocialWSClient)
 */

"use client";

import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SocialWSClient, type SocialEvent, type SocialEventHandler, type SocialWSStatus } from "@/lib/ws/social-client";
import { useTenant } from "@/src/contexts/TenantContext";
import { useToast } from "@/src/contexts/ToastContext";
import { dispatchEvent, type EventPayload } from "@/lib/events/event_registry";

// ── Types ────────────────────────────────────────────────────────────

interface SocialEventBusContextValue {
  /** Current connection status */
  status: SocialWSStatus;
  /** Whether connected */
  isConnected: boolean;
  /** Subscribe to a specific event type */
  subscribe: (eventType: string, handler: SocialEventHandler) => () => void;
  /** Subscribe to all events */
  onEvent: (handler: SocialEventHandler) => () => void;
  /** Send a message to the server */
  send: (data: Record<string, unknown>) => void;
  /** Manually reconnect */
  reconnect: () => void;
  /** Offline queue size */
  offlineQueueSize: number;
}

// ── Context ──────────────────────────────────────────────────────────

const SocialEventBusContext = React.createContext<SocialEventBusContextValue | null>(null);

export function useSocialEventBus(): SocialEventBusContextValue {
  const ctx = useContext(SocialEventBusContext);
  if (!ctx) {
    throw new Error("useSocialEventBus must be used within SocialEventBusProvider");
  }
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────

export function SocialEventBusProvider({ children }: { children: ReactNode }) {
  const { user } = useTenant();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SocialWSStatus>("disconnected");
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);
  const clientRef = useRef<SocialWSClient | null>(null);

  const handleEvent = useCallback(
    (event: SocialEvent) => {
      // Route through event registry for cache invalidation + toast
      dispatchEvent(event as EventPayload, { queryClient, showToast });
      setOfflineQueueSize(clientRef.current?.getOfflineQueueSize() ?? 0);
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

    const client = new SocialWSClient({
      onStatusChange: setStatus,
      onEvent: handleEvent,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [user, handleEvent]);

  const subscribe = useCallback(
    (eventType: string, handler: SocialEventHandler) => {
      return clientRef.current?.subscribe(eventType, handler) ?? (() => {});
    },
    [],
  );

  const onEvent = useCallback(
    (handler: SocialEventHandler) => {
      return clientRef.current?.onEvent(handler) ?? (() => {});
    },
    [],
  );

  const send = useCallback((data: Record<string, unknown>) => {
    clientRef.current?.send(data);
  }, []);

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current?.connect();
  }, []);

  return React.createElement(
    SocialEventBusContext.Provider,
    {
      value: {
        status,
        isConnected: status === "connected",
        subscribe,
        onEvent,
        send,
        reconnect,
        offlineQueueSize,
      },
    },
    children,
  );
}
