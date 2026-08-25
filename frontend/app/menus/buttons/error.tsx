"use client";

import { PageError } from "@/src/components/ui/PageError";

/**
 * Was the one route error page still hand-rolled: a `text-6xl` "500" in
 * `text-red-500` (palette literal, not the error token), two `rounded-lg`
 * buttons, and its own `min-h-screen` on top of AppLayout's slot. The other
 * seven routes in this group already delegate to `PageError`; this one now
 * does too, so there is one error screen instead of two spellings of it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageError error={error} reset={reset} />;
}
