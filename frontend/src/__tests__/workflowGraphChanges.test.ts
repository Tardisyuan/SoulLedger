/**
 * `countGraphChanges` — the number in 「草稿 vN · M 处改动未发布」 (user decision 2026-11-08): nodes added /
 * removed / changed plus routes added / removed / changed, the draft against the published graph.
 */
import { countGraphChanges, type TemplateNode } from "@/src/components/workflow/workflowEditorGraph";

const node = (id: string, order: number, extra: Partial<TemplateNode> = {}): TemplateNode => ({
  id,
  node_name: id.toUpperCase(),
  node_type: "TRIAL",
  court_code: "",
  approver_role: "JUDGE",
  approver_type: "ROLE",
  node_order: order,
  ...extra,
});

const PUBLISHED: TemplateNode[] = [
  node("a", 1, { on_pass: "b", branches: [{ id: "neg", when: [{ fact: "balance", op: "lt", value: 0 }], target: "c" }] }),
  node("b", 2, { on_pass: "c", on_fail: "a" }),
  node("c", 3, { kind: "END" }),
];

describe("countGraphChanges", () => {
  it("is 0 for the same graph, however the empty fields are spelled", () => {
    // What the editor's `getTemplateNodes` sends back: explicit nulls, "", [] and a position.
    const draft = PUBLISHED.map((n) => ({
      ...n,
      name_en: "",
      on_pass: n.on_pass ?? null,
      on_fail: n.on_fail ?? null,
      branches: n.branches ?? [],
      kind: n.kind ?? "APPROVAL",
      signers: [],
      threshold: null,
      reject_to: null,
      timeout_hours: null,
      timeout_action: null,
      timeout_role: null,
      position: { x: 10, y: 20 },
    }));
    expect(countGraphChanges(draft, PUBLISHED)).toBe(0);
  });

  it("counts only an edge label — the condition a branch carries", () => {
    const draft = PUBLISHED.map((n) =>
      n.id === "a" ? { ...n, branches: [{ id: "neg", when: [{ fact: "balance" as const, op: "lte" as const, value: 0 }], target: "c" }] } : n
    );
    expect(countGraphChanges(draft, PUBLISHED)).toBe(1);
  });

  it("counts a retargeted, an added and a removed route", () => {
    const draft = PUBLISHED.map((n) => (n.id === "b" ? { ...n, on_pass: "a", on_fail: null } : n.id === "c" ? { ...n, on_fail: "a" } : n));
    expect(countGraphChanges(draft, PUBLISHED)).toBe(3);
  });

  it("counts a changed, an added and a removed node, with the routes into the removed one", () => {
    const draft = [
      { ...PUBLISHED[0], node_name: "renamed" },
      PUBLISHED[1],
      node("d", 3, { kind: "END" }),
    ];
    // a changed; c removed, d added; a's branch to c and b's on_pass to c both dropped.
    expect(countGraphChanges(draft, PUBLISHED)).toBe(5);
  });

  it("reads an undeclared graph as the node_order chain, as the editor does on load", () => {
    const legacy = [node("a", 1), node("b", 2), node("c", 3)];
    const asSaved = [node("a", 1, { on_pass: "b" }), node("b", 2, { on_pass: "c" }), node("c", 3)];
    expect(countGraphChanges(asSaved, legacy)).toBe(0);
  });
});
