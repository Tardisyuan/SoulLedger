"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Same shape as `app/judgment/page.tsx`: PageShell's head, the pending /
 * concluded tab strip, then a six-column DataTable.
 *
 * This was `<PageSpinner />`. The two hand-rolled rings that PageSpinner
 * itself replaced were `border-amber-500/20` and `border-t-amber-500` —
 * palette literals rather than the accent token — and that note is kept here
 * because the spinner is still the right answer inside a card; it was the
 * wrong answer for a whole route, where it says nothing about what is coming.
 */
export default function Loading() {
  return <TablePageSkeleton withTabs rows={8} />;
}
