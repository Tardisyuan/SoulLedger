/**
 * 侧边栏"当前项"高亮判断。
 *
 * DIRECTORY 分组的 path 是空字符串（不是 null —— 见
 * backend/apps/menus/models.py:28 的 `path = models.CharField(..., blank=True)`）。
 * 空 path 必须永远判定为不 active：不加这道判断的话，`pathname.startsWith("/" )`
 * 对任何路由都成立，每一个分组在每一页都会被误判成"当前项"、常年高亮。
 * 只有真正指向某个页面的叶子菜单（非空 path）才能被判定为 active。
 */
export function isMenuPathActive(
  pathname: string,
  menuPath: string,
  allMenuPaths: readonly string[] = []
): boolean {
  if (!menuPath) return false;
  if (pathname === menuPath) return true;
  if (!pathname.startsWith(menuPath + "/")) return false;
  // 祖先命中成立,除非**另一个菜单项**更具体地命中了同一条路由。
  //
  // 原来是无条件的前缀匹配,于是 `/social/follows` 让 `/social` 与
  // `/social/follows` **同时高亮** —— 两者都是叶子菜单,侧边栏同时点亮两项,
  // 读起来像是不知道自己在哪一页。
  //
  // 但「只有分组才做祖先高亮」是错的另一半:`/souls/42` 是灵魂详情页,它**应该**
  // 点亮 `/souls`,而 `/souls` 是叶子。区别不在这一项有没有子项,在于
  // **有没有更具体的菜单项也命中** —— `/souls/42` 没有对应的菜单,`/social/follows`
  // 有。
  //
  // `allMenuPaths` 由 AppLayout 从真实菜单树摊平得来,不是写死的名单 ——
  // 后者会随菜单表漂移,而这个仓库被手抄副本咬过很多次。
  return !allMenuPaths.some(
    (other) =>
      other.length > menuPath.length &&
      (pathname === other || pathname.startsWith(other + "/"))
  );
}
