"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/** Same shape as `app/recycle-bin/page.tsx`: head over a DataTable. */
export default function Loading() {
  return <TablePageSkeleton rows={6} />;
}
