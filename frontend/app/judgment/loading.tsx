"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Same shape as `app/judgment/page.tsx`: PageShell's head, the pending /
 * concluded tab strip, then a six-column DataTable.
 *
 * This was `<PageSpinner />`. The two hand-rolled rings that PageSpinner
 * itself replaced were `amber-500/20 border` and `amber-500 top border` —
 * palette literals rather than the accent token — and that note is kept here
 * because the spinner is still the right answer inside a card; it was the
 * wrong answer for a whole route, where it says nothing about what is coming.
 */
export default function Loading() {
  return <TablePageSkeleton withTabs rows={8} />;
}
