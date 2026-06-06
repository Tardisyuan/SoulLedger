"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

// ── Lazy KarmaChart ──────────────────────────────────────────────
const LazyKarmaChart = dynamic(
  () =>
    import("@/src/components/karma/KarmaChart").then((mod) => mod.KarmaChart),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <div className="flex gap-4 text-sm">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-5 w-24" />
        </div>
        <Skeleton className="h-[140px] w-full" />
      </div>
    ),
  }
);

export { LazyKarmaChart };
