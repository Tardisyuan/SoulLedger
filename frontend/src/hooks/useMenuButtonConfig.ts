"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { menuButtonsApi } from "@soulledger/core/api";
import { useTenant } from "@/src/contexts/TenantContext";
import { WIRED_BUTTONS, buttonKey, type WiredButtonId } from "@/src/lib/menuButtons";

/** 与配置页的列表同一个根(`["menu-buttons"]`),配置页一改,这里跟着失效。 */
export const MENU_BUTTON_CONFIG_KEY = ["menu-buttons", "config"] as const;

const BY_ID = new Map<string, (typeof WIRED_BUTTONS)[number]>(WIRED_BUTTONS.map((b) => [b.id, b]));

/**
 * 菜单按钮配置是否允许某个关键按钮(第四十批 W-b)。只回答「配置」这一半;权限码那一半仍是按钮
 * 原来的 `RequirePermission` / `hasPermission`,两者都允许才显示。
 *
 * 没有配置行 = 允许(存量部署不丢按钮)。取数中、取失败也按允许:配置是收窄,不是开门的钥匙,
 * 后端的权限码照样守着每个接口。代价是配置关掉的按钮在首次取数完成前会闪一下;之后走缓存。
 * ADMIN 也受它管 —— Design:被配置隐藏的按钮,管理员视角也不留痕迹。
 */
export function useMenuButtonConfig(): (id: WiredButtonId) => boolean {
  const { user } = useTenant();
  const { data } = useQuery({
    queryKey: MENU_BUTTON_CONFIG_KEY,
    queryFn: () => menuButtonsApi.config().then((res) => res.data),
    staleTime: 5 * 60 * 1000,
    enabled: !!user,
  });
  const off = useMemo(
    () => new Set((Array.isArray(data) ? data : []).filter((row) => !row.is_active).map((row) => buttonKey(row.menu_path, row.code))),
    [data]
  );
  return useCallback(
    (id: WiredButtonId) => {
      const button = BY_ID.get(id);
      return !button || !off.has(buttonKey(button.menu, button.code));
    },
    [off]
  );
}
