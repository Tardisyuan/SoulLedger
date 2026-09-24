/**
 * 树表行 TreeRow(第三类 B 组「界域」拓扑表):一张平表里的层级,只靠名称格的
 * 缩进(每层 16px)加一道 └ 肘线来说,不加框、不加图标。/menus 与 /organizations
 * 共用 —— 设计答复里点名这两页「套平表会丢掉层级」。
 */

/**
 * 深度优先展开成表行,兄弟之间保持输入顺序(调用方负责排序)。
 *
 * 父节点不在 `items` 里的行当作根。/menus 是分页的(每页 20),一个子菜单的父级
 * 可能在另一页;/organizations 按文明分组,父级可能落在别的组。把这类行丢掉 ——
 * 原来 organizations 的 `walk(null)` 就是这样 —— 等于让一行数据静默消失。
 * `seen` 挡住 parent 链成环时的无限递归。
 */
export function flattenTree<T>(
  items: readonly T[],
  getId: (item: T) => number | string,
  getParent: (item: T) => number | string | null | undefined,
): { item: T; depth: number }[] {
  const ids = new Set(items.map(getId));
  const children = new Map<number | string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = getParent(item);
    if (parent == null || !ids.has(parent)) roots.push(item);
    else children.set(parent, [...(children.get(parent) ?? []), item]);
  }
  const out: { item: T; depth: number }[] = [];
  const seen = new Set<number | string>();
  const walk = (item: T, depth: number) => {
    const id = getId(item);
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ item, depth });
    for (const child of children.get(id) ?? []) walk(child, depth + 1);
  };
  roots.forEach((root) => walk(root, 0));
  // A cycle has no root to reach it from; list it flat rather than drop it.
  items.forEach((item) => walk(item, 0));
  return out;
}

/** 名称格的内容:缩进 + └ 肘线(深度 0 不画)。 */
export function TreeName({ depth, children }: { depth: number; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2" data-tree-depth={depth} style={depth ? { paddingLeft: depth * 16 } : undefined}>
      {depth > 0 && (
        <span
          aria-hidden="true"
          data-tree-elbow=""
          className="-mt-2 h-2 w-3 shrink-0 border-b border-l border-[oklch(var(--color-ink-subtle))]"
        />
      )}
      {children}
    </div>
  );
}
