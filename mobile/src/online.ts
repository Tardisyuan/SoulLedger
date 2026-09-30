/**
 * The network state the offline bar (network.tsx) publishes and every screen may read.
 * Its own module so that ui.tsx (`useReloadOnReconnect`) can read it without importing
 * network.tsx, which draws the bar with ui.tsx's components — that pair was a require cycle.
 */
import { createContext, useContext } from "react";

export interface Online {
  offline: boolean;
  /** Counts returns to the network; 0 until the first. */
  back: number;
}

export const OnlineContext = createContext<Online>({ offline: false, back: 0 });

export function useOnline(): Online {
  return useContext(OnlineContext);
}
