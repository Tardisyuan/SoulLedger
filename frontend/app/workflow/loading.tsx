"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * The two hand-rolled rings this replaced were `amber-500/20 border` and
 * `amber-500 top border` — palette literals, not the accent token, so they kept
 * spinning amber after the user picked another accent colour. See the note at
 * the top of src/components/ui/Spinner.tsx.
 */
export default function Loading() {
  return <PageSpinner />;
}
