"use client";

import { useTenant } from "@/src/contexts/TenantContext";

/**
 * 身份带的殿名「<租户名> · <司 / 殿>」(用户 2026-10-02 拍板):每页写一个固定的司名
 * (`plaque.office.*`),审判类页面写当前案子的殿(`judgment.court`、节点的 `court_code`)。
 * `place` 为空(案子没记殿、还没加载)→ undefined,身份带退回只写租户名。
 * 交给 `usePlaque({ hall })`。
 */
export function useHall(place: string | null | undefined): string | undefined {
  const tenant = useTenant().user?.tenant?.display_name;
  if (!place) return undefined;
  return tenant ? `${tenant} · ${place}` : place;
}
