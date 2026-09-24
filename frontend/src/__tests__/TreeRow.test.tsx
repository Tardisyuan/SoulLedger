/**
 * 树表行 TreeRow: the flattening that /menus and /organizations share, and the
 * elbow mark. The case the old organizations `walk(null)` got wrong — a row
 * whose parent is not in the list silently vanished — is pinned first.
 */
import { render } from "@testing-library/react";
import { TreeName, flattenTree } from "@/src/components/ui/TreeRow";

type Node = { id: number; parent: number | null; name: string };
const n = (id: number, parent: number | null) => ({ id, parent, name: `n${id}` });
const flat = (items: Node[]) =>
  flattenTree(items, (i) => i.id, (i) => i.parent).map(({ item, depth }) => `${item.id}@${depth}`);

describe("flattenTree", () => {
  it("walks depth-first, children right under their parent, siblings in input order", () => {
    expect(flat([n(1, null), n(2, null), n(3, 1), n(4, 3), n(5, 1)])).toEqual(["1@0", "3@1", "4@2", "5@1", "2@0"]);
  });

  it("keeps a row whose parent is off the list (another page, another group) as a root, in its place", () => {
    // In its place, not appended after the real roots: the cycle fallback
    // would also list it, but at the end, out of the server's order.
    expect(flat([n(3, 99), n(4, 3), n(1, null)])).toEqual(["3@0", "4@1", "1@0"]);
  });

  it("lists every row exactly once even when parent links form a cycle", () => {
    const out = flat([n(1, 2), n(2, 1), n(3, null)]);
    expect(out.map((s) => s.split("@")[0]).sort()).toEqual(["1", "2", "3"]);
  });
});

describe("TreeName", () => {
  it("draws an elbow and indents only below the root", () => {
    const { container, rerender } = render(<TreeName depth={0}>root</TreeName>);
    expect(container.querySelector("[data-tree-elbow]")).toBeNull();
    rerender(<TreeName depth={2}>child</TreeName>);
    expect(container.querySelector("[data-tree-elbow]")).not.toBeNull();
    expect((container.firstChild as HTMLElement).style.paddingLeft).toBe("32px");
  });
});
