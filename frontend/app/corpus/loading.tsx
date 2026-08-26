"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * Route-level loading, distinct from the in-page one. This covers the chunk
 * fetch for the page component; `PageShell`'s `skeleton` slot covers the query
 * that runs once the component is mounted. Both draw the same spinner so a slow
 * cold load does not visibly change shape halfway through.
 */
export default function Loading() {
  return <PageSpinner />;
}
