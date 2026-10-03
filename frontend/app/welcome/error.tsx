"use client";

import { PageError } from "@/src/components/ui/PageError";

// 2026-10-01:与其余路由的 error 边界一样走 `PageError`(规范 v3 的 500 卡)。
// 此前它自己画了一块:`--color-status-error` 的「500」、实心主按钮「重试」加一个「返回首页」。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <PageError error={error} reset={reset} />;
}
