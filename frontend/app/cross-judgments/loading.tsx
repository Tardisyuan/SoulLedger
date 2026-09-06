"use client";

import { CardListPageSkeleton } from "@/components/ui/page-skeletons";

/** Same shape as `app/cross-judgments/page.tsx`: head over a card stack. */
export default function Loading() {
  return <CardListPageSkeleton cards={4} />;
}
