"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/** Same shape as this route's `page.tsx`: PageShell's head over a table. Was `<PageSpinner />` (see app/souls/loading.tsx). */
export default function Loading() {
  return <TablePageSkeleton rows={10} />;
}
