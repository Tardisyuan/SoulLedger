"use client";

import { CardListPageSkeleton } from "@/components/ui/page-skeletons";

/**
 * Same shape as `app/notifications/page.tsx`: head, then the `space-y-3` stack
 * of notification cards.
 *
 * That page already hand-writes a skeleton for its own in-page loading state
 * (`page.tsx:163-181`); this is the route-level one, which was a spinner.
 */
export default function Loading() {
  return <CardListPageSkeleton cards={5} />;
}
