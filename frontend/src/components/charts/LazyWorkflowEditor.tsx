"use client";

import dynamic from "next/dynamic";
import { Skeleton, ListSkeleton } from "@/components/ui/skeleton";

// ── Lazy WorkflowEditor ──────────────────────────────────────────
const LazyWorkflowEditor = dynamic(
  () =>
    import("@/src/components/workflow/WorkflowEditor").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col h-full bg-[hsl(var(--color-surface-2))] rounded-lg">
        <div className="flex items-center gap-3 p-3 border-b border-[hsl(var(--color-hairline))] bg-[hsl(var(--color-surface-1))]">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <ListSkeleton count={3} />
        </div>
      </div>
    ),
  }
);

export { LazyWorkflowEditor };
