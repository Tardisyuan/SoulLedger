"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
            // Remounting a page within 30s reuses the cache instead of refetching.
            // Real-time queries (judgment queue and its navigation, notifications,
            // scheduler, soul inbox / chat, dispatch, death-sync, workflows) set
            // `staleTime: 0` themselves. WebSocket invalidation refetches active
            // queries whatever their staleTime.
            staleTime: 30_000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
