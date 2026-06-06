"use client";

import { useWebSocket } from "@/src/contexts/WebSocketContext";
import { useTenant } from "@/src/contexts/TenantContext";

/**
 * ConnectionStatus — small indicator showing WebSocket connection state.
 *
 * - Connected: green dot
 * - Reconnecting: yellow pulsing dot
 * - Disconnected: red dot (only shown when user is logged in)
 * - Not logged in: hidden
 */
export function ConnectionStatus() {
  const { status } = useWebSocket();
  const { user } = useTenant();

  if (!user) return null;

  const config = {
    connected: {
      color: "bg-emerald-500",
      label: "Connected",
      pulse: false,
    },
    connecting: {
      color: "bg-yellow-500",
      label: "Connecting...",
      pulse: true,
    },
    reconnecting: {
      color: "bg-yellow-500",
      label: "Reconnecting...",
      pulse: true,
    },
    disconnected: {
      color: "bg-red-500",
      label: "Disconnected",
      pulse: false,
    },
    failed: {
      color: "bg-red-500",
      label: "Failed",
      pulse: false,
    },
  } as const;

  const { color, label, pulse } = config[status] ?? config.disconnected;

  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span
        className={`w-2 h-2 rounded-full ${color} ${pulse ? "animate-pulse" : ""}`}
      />
      <span className="text-xs text-[hsl(var(--color-ink-subtle))] hidden sm:inline">
        {label}
      </span>
    </div>
  );
}
