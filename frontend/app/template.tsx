"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 规范 v3「页面切换」:新页 opacity 0→1、translateY 8px→0,240ms 进场曲线;减少动态效果下
 * 只留 80ms 淡入(`data-motion="fade"`,见 globals.css)。
 *
 * template 而不是 layout:Next 在根之下那一段路由变了时重新挂载它,于是跨段导航重播
 * 一次进场;外壳(AppLayout 的侧栏、牌匾)在 layout 里,不跟着动。
 *
 * 同一段内的跳转(`/souls` → `/souls/123`)Next 不重新挂载 template,同一个动画名也就
 * 不会重播。v3 写的是「导航触发」,不分段,所以 pathname 一变就换到另一个动画名
 * (`page-enter-again`,值逐字相同)—— 换名会让浏览器重播动画,而不用 `key` 重挂页面:
 * 页面状态与焦点都留着。只换查询串(筛选、分页)pathname 不变,不重播。
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [last, setLast] = useState({ pathname, again: false });
  if (last.pathname !== pathname) setLast({ pathname, again: !last.again });
  return (
    <div data-motion="fade" className={last.again ? "animate-page-enter-again" : "animate-page-enter"}>
      {children}
    </div>
  );
}
