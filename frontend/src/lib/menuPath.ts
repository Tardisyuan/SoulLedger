/**
 * 侧边栏"当前项"高亮判断。
 *
 * DIRECTORY 分组的 path 是空字符串（不是 null —— 见
 * backend/apps/menus/models.py:28 的 `path = models.CharField(..., blank=True)`）。
 * 空 path 必须永远判定为不 active：不加这道判断的话，`pathname.startsWith("/" )`
 * 对任何路由都成立，每一个分组在每一页都会被误判成"当前项"、常年高亮。
 * 只有真正指向某个页面的叶子菜单（非空 path）才能被判定为 active。
 */
export function isMenuPathActive(pathname: string, menuPath: string): boolean {
  return !!menuPath && (pathname === menuPath || pathname.startsWith(menuPath + "/"));
}
