"use client";

import { PageSpinner } from "@/src/components/ui/Spinner";

/**
 * 根加载边界,**两种处境共用一份**,所以高度取哪个值是有取舍的。
 *
 * 它包住 `app/layout.tsx` 的 children,也就是 `AppLayoutWrapper`。于是:
 *  - 访问 `/` 或 `/login` 时,Wrapper 直接把 children 交出去,这一段在**全视口**里;
 *  - 访问任何自己没有 `loading.tsx` 的内层路由时,这一段落在 AppLayout 那个
 *    `min-h-[calc(100vh-4rem)]` 的槽位里。
 *
 * 取槽位高度(`PageSpinner` 的值),不取 `min-h-screen`。理由与 Spinner.tsx 里
 * 写的是同一条,只是这里两边都会发生:在 `/` 上矮 64px,对一个居中的转圈是看不见
 * 的;在内层路由上高 64px,是每一条都多一根滚动条。矮一点没有代价,高一点有。
 */
export default function Loading() {
  return <PageSpinner />;
}
