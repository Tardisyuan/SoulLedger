import { useEffect } from "react";

/**
 * 关标签页 / 刷新 / 地址栏离开时,`dirty` 为真就让浏览器先问一句(浏览器自己的对话框,文案也是它的)。
 * 站内跳转不经过这里:各页已有的「放弃?」确认框管那一条。
 *
 * 用处:案卷台与快审的撤回窗口(印还没发),以及「攒着改」的页 —— 权限矩阵、问一问配置、流程编辑器、调度申请
 * (设计参照 2026-11-15 §9)。
 */
export function useUnsavedGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);
}
