"use client";

import { CardListPageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Same shape as `app/dispatch/page.tsx`, which is TWO titled sections —
 * "pending" over "history" — not one list. A single-stack skeleton would have
 * been a picture of a page that is not coming.
 */
export default function Loading() {
  return <CardListPageSkeleton sections={2} cards={3} />;
}
