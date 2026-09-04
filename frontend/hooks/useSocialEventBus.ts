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
import { SocialWSClient, type SocialEvent, type SocialEventHandler, type SocialWSStatus } from "@soulledger/core/ws/social-client";
import { notify } from "@soulledger/core/platform";
import { useTenant } from "@/src/contexts/TenantContext";
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
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SocialWSStatus>("disconnected");
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);
  const clientRef = useRef<SocialWSClient | null>(null);

  const handleEvent = useCallback(
    (event: SocialEvent) => {
      // Route through event registry for cache invalidation + toast.
      //
      // The wrapper is not decoration, and it now does two jobs.
      //
      // `EventContext.showToast` (`lib/events/eventTypes.ts`) declares `type`
      // optional, while the platform port requires a kind — deliberately, so a
      // host adapter cannot be handed a notification whose loudness is
      // unstated. `"info"` is the default `showToast` itself applied, so
      // nothing changes for a handler that omits it.
      //
      // And `{ text }` rather than a bare string, which the port would read as
      // a message key. The registry's handlers build these sentences out of
      // payload fields — a soul's name, a workflow's node — so they are not
      // keys and no bundle could hold them. This is the second of the two
      // places `NotifyMessage`'s `{ text }` form exists for; the other is DRF's
      // `non_field_errors` in `src/hooks/useSocial.ts`.
      //
      // NOT A LOOPHOLE FOR THE REGISTRY'S OWN COPY. `lib/events/event_registry`
      // is still in the web tree and still translates before it gets here;
      // moving it is not part of this change.
      const toast = (message: string, kind?: "success" | "error" | "info", duration?: number) =>
        notify({ text: message }, kind ?? "info", duration);
      dispatchEvent(event as EventPayload, { queryClient, showToast: toast });
      setOfflineQueueSize(clientRef.current?.getOfflineQueueSize() ?? 0);
    },
    [queryClient],
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
