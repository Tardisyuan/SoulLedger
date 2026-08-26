"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * 迁移前这里是那个被复制了 20 遍的手搓双环转圈,外层写着 `min-h-screen`。
 * `/admin/stats` 走 AppLayout(它不在 AppLayoutWrapper 的 AUTH_PATHS /
 * PUBLIC_PATHS 里),所以那 100vh 嵌在槽位的 100vh−4rem 里,是 PageShell 文件头
 * 第 3 条点名的那 64px 死滚动。
 *
 * `PageSpinner` 现在用的是槽位高度,所以直接采用它 —— 这一段与根 loading 曾经
 * 逐字相同,留两份手抄只会让下一次修复漏掉一份。
 */
export default function Loading() {
  return <PageSpinner />;
}
