/**
 * The category field survives a parent re-render.
 *
 * WHY THIS IS A SEPARATE FILE FROM `PermissionFormModal.test.tsx`. That file
 * hands the component a module-level constant for `existingCategories`, so the
 * prop's identity never moves and nothing there can observe what happens when
 * it does. The real caller — `app/permissions/page.tsx` — passes
 * `categories.map((c) => c.category)` **inline**, which mints a new array on
 * every render of a page that re-renders on each keystroke of its own filter
 * box. The harness below reproduces that shape rather than a convenient one;
 * a fixture with a stable array would keep this green no matter what the
 * component did.
 *
 * WHAT IT GUARDS. `PermissionFormModal`'s reset effect deliberately omits
 * `existingCategories` from its dependency array, with an
 * `eslint-disable-next-line react-hooks/exhaustive-deps` above it. This is the
 * argument for that suppression, executed: add the dependency and the effect
 * fires on every parent render, resetting `category` to
 * `existingCategories[0]` under the operator's cursor. Verified by doing
 * exactly that before this file was trusted — the case below went red with
 * "soul" received where "audit" was expected.
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { PermissionFormModal } from "@/src/components/permissions/PermissionFormModal";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "common.cancel": "取消",
        "permissions.submit": "提交",
        "permissions.codename_label": "权限代码",
        "permissions.name_label": "权限名称",
        "permissions.category_label": "分类",
        "permissions.category_hint": "从现有分类中选择，或输入一个新分类",
      })[key] ?? key,
    locale: "en",
    hydrated: true,
  }),
}));

/**
 * The caller's shape, not a convenient one: `existingCategories` is derived
 * inline from a list, so every render of this harness produces a *different*
 * array holding the *same* strings — which is precisely the identity churn the
 * omitted dependency is about.
 */
function Harness() {
  const [filter, setFilter] = useState("");
  const categories = [{ category: "soul" }, { category: "judgment" }, { category: "ledger" }];
  return (
    <div>
      <input
        aria-label="filter"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      <PermissionFormModal
        isOpen
        onClose={jest.fn()}
        onSubmit={jest.fn()}
        isPending={false}
        error={null}
        title="新建权限"
        existingCategories={categories.map((c) => c.category)}
      />
    </div>
  );
}

describe("PermissionFormModal — a parent re-render does not reset the form", () => {
  it("keeps a half-typed new category when the parent re-renders", () => {
    render(<Harness />);
    const categoryInput = screen.getByLabelText("分类") as HTMLInputElement;

    // The operator is naming a category that does not exist yet — the case the
    // <datalist> (rather than a closed <select>) exists for.
    fireEvent.change(categoryInput, { target: { value: "audit" } });
    expect(categoryInput).toHaveValue("audit");

    // Anything at all in the parent. In production this is the matrix page's
    // filter box; here it is one keystroke into a sibling input.
    fireEvent.change(screen.getByLabelText("filter"), { target: { value: "s" } });

    // Presence and absence both: the typed value is still there, and it has
    // not been replaced by `existingCategories[0]`, which is the exact value
    // the reset would write.
    expect(categoryInput).toHaveValue("audit");
    expect(categoryInput).not.toHaveValue("soul");
  });

  it("keeps the other two fields too, for the same reason", () => {
    render(<Harness />);
    const codename = screen.getByLabelText("权限代码") as HTMLInputElement;
    const name = screen.getByLabelText("权限名称") as HTMLInputElement;

    fireEvent.change(codename, { target: { value: "audit.export" } });
    fireEvent.change(name, { target: { value: "导出审计日志" } });
    fireEvent.change(screen.getByLabelText("filter"), { target: { value: "x" } });

    expect(codename).toHaveValue("audit.export");
    expect(name).toHaveValue("导出审计日志");
  });
});
