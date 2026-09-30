"use client";

import { TablePageSkeleton } from "@/components/ui/page-skeletons";

/**
 * 路由级加载:与页面同形的静态骨架(规范 v2 补足 C15「加载骨架 · 静态,不闪光」),
 * 不再是居中的转圈 —— 转圈说不出将要出现的是一张表,数据到了页面会跳一格。
 */
export default function Loading() {
  return <TablePageSkeleton />;
}
