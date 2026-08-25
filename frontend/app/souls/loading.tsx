"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * The two hand-rolled rings this replaced were `border-amber-500/20` and
 * `border-t-amber-500` — palette literals, not the accent token, so they kept
 * spinning amber after the user picked another accent colour. See the note at
 * the top of src/components/ui/Spinner.tsx.
 */
export default function Loading() {
  return <PageSpinner />;
}
