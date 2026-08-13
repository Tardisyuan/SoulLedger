"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { JudgmentQueueConsole } from "@/src/components/judgment/JudgmentQueueConsole";
import { PermissionDenied } from "@/src/components/rbac/PermissionDenied";
import { RequirePermission } from "@/src/components/rbac/RequirePermission";

/**
 * `/judgment/queue` — the triage console (BRIEF §4.2).
 *
 * `?at=<judgmentId>` enters the queue on a named case; the soul lifecycle
 * spine's "open in the judgment queue" links here. The backend treats it as a
 * preference rather than a filter, so a case that has since been concluded
 * lands the operator at the head of the queue instead of on a dead link.
 *
 * Gated on `judgment.read` — the same codename `GET /judgment/next/` requires.
 * Rendering the console for someone the API will refuse is a worse experience
 * than saying so up front.
 */
function QueueRoute() {
  const searchParams = useSearchParams();
  const at = searchParams.get("at") ?? undefined;
  return <JudgmentQueueConsole at={at} />;
}

export default function JudgmentQueuePage() {
  return (
    <RequirePermission permissions="judgment.read" fallback={<PermissionDenied />}>
      {/* useSearchParams needs a Suspense boundary or the whole route opts out
          of static rendering (Next.js App Router). */}
      <Suspense fallback={null}>
        <QueueRoute />
      </Suspense>
    </RequirePermission>
  );
}
