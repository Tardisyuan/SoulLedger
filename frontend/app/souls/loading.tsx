"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Same shape as `app/souls/page.tsx`: PageShell's head over a compact
 * DataTable of ten rows (`PAGE_SIZE` on that page is 20, but ten is what fits
 * a viewport, and a skeleton taller than the fold buys nothing).
 *
 * Was `<PageSpinner />`. See `components/ui/page-skeletons.tsx` for why all
 * seven of these routes stopped using it.
 */
export default function Loading() {
  return <TablePageSkeleton rows={10} />;
}
