import { useSyncExternalStore } from "react";

/**
 * 快捷键提示按平台写(设计参照 2026-11-15 §9):Mac 写 ⌘,其余写 Ctrl。键表与调用点照旧写 Mac 的拼法
 * (`"⌘⏎"`、`"⌘Z · U"`),渲染时过一遍 `keyLabel`。监听本来就两个修饰键都认(`metaKey || ctrlKey`),
 * 这里只改写出来的字。
 */
export const isMac = (): boolean =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** `⌘⏎` → `Ctrl ⏎`(非 Mac);Mac 原样。 */
export function keyLabel(key: string, mac: boolean): string {
  return mac ? key : key.replace(/⌘/g, "Ctrl ");
}

const noSubscribe = () => () => {};

/** 服务端与首帧按 Mac 画(与改动前的输出相同),水合后按真实平台。 */
export function useIsMac(): boolean {
  return useSyncExternalStore(noSubscribe, isMac, () => true);
}

/** `const k = useKeyLabel(); k("⌘⏎")`。 */
export function useKeyLabel(): (key: string) => string {
  const mac = useIsMac();
  return (key) => keyLabel(key, mac);
}
