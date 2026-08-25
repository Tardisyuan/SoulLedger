"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * This one already read `--color-accent` rather than `amber-500`, so the colour
 * is unchanged; what it gains is the reduced-motion stop and the `role="status"`
 * hook that all 21 copies of these six lines were missing.
 */
export default function Loading() {
  return <PageSpinner />;
}
