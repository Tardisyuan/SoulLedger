/**
 * Tests for app/workflow/page.tsx — part one: the template browser.
 *
 * The page mixes two template sources (predefined config objects and saved
 * backend templates) behind one preview pane, and puts three separate
 * permission gates on the write actions. Both are places where a mistake is
 * invisible: the wrong source rendered still looks like a template, and a
 * missing gate still looks like a working page — to whoever has the
 * permission. So the tests below check which source is showing, and assert
 * that each button is *absent* for a user without its permission.
 *
 * The instance list, the editor tab, and the loading state live in
 * `WorkflowPage.instances.test.tsx`. Every module double both files use is
 * defined once in `support/workflowPageHarness.tsx`, which is also where
 * `renderPage` comes from — this file deliberately does not import the page
 * itself, so the mocks cannot be bypassed by an import landing first.
 */
import { screen, waitFor, fireEvent, within } from "@testing-library/react";

import {
  backendTemplate,
  installWorkflowPageHarness,
  mockSession,
  mockShowToast,
  mockedTemplateDelete,
  mockedTemplateGet,
  mockedTemplates,
  renderPage,
} from "./support/workflowPageHarness";

installWorkflowPageHarness();

// ── Template browsing ────────────────────────────────────────────────

describe("WorkflowPage template list", () => {
  it("previews the default predefined template on first render", async () => {
    renderPage();

    expect(await screen.findByText("workflow.predefined_templates")).toBeInTheDocument();
    // CHINESE_ROUTINE is the initial selection.
    expect(screen.getAllByText("十殿审判流程").length).toBeGreaterThan(0);
    expect(screen.getByText("workflow.nodes_count(10)")).toBeInTheDocument();
  });

  it("omits the custom-templates heading when the backend has none", async () => {
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    expect(screen.queryByText("workflow.custom_templates")).not.toBeInTheDocument();
  });

  it("lists backend templates under their own heading", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });

    renderPage();

    expect(await screen.findByText("workflow.custom_templates")).toBeInTheDocument();
    expect(screen.getByText("Custom Tribunal")).toBeInTheDocument();
  });

  it("swaps the preview from the predefined template to the picked backend one", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    // The predefined preview is gone; the backend one, with its node_count, is up.
    expect(screen.queryByText("workflow.nodes_count(10)")).not.toBeInTheDocument();
    expect(screen.getByText("workflow.nodes_count(3)")).toBeInTheDocument();
    expect(screen.getByText("hand rolled")).toBeInTheDocument();
  });

  it("points the operator at the detail view when the list row carries no node graph", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("workflow.view_to_see_nodes")).toBeInTheDocument();
  });

  it("lists the nodes inline when the template does carry them", async () => {
    mockedTemplates.mockResolvedValue({
      data: [
        {
          ...backendTemplate,
          nodes_json: [{ node_name: "First hall", court_code: "H1", node_type: "REVIEW" }],
        },
      ],
    });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("First hall")).toBeInTheDocument();
    expect(screen.queryByText("workflow.view_to_see_nodes")).not.toBeInTheDocument();
  });

  /**
   * The three cases below cover the preview's node rows through the page,
   * which nothing did before `TemplatePreview` existed. Measured at the time:
   * blanking the court cell, the node-type cell or the ordinal — in *either*
   * of the two copies this markup then had — left all 32 cases here green, and
   * so did reverting the preset preview's `nodeTypeFor(...)` to the raw
   * `n.type` that shipped the 400. `node_name` on the backend copy was the one
   * guarded field in the whole preview.
   *
   * `t` is mocked to echo its key, so every enum lands in the "unrecognized"
   * state and `<DomainEnum>` puts the raw member in `title` — which is what
   * makes "the value reaching the cell is a NodeType member, not a step name"
   * checkable here at all.
   */
  it("numbers the predefined preview's node rows from one", async () => {
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    // CHINESE_ROUTINE: 秦广王 · 分流 (第一殿) … 转轮王 · 终审 (第十殿).
    expect(screen.getByText("第一殿")).toBeInTheDocument();
    expect(screen.getByText("第十殿")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    // Absence: an off-by-one still renders ten plausible chips.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("shows each predefined node's NodeType, never the raw step name", async () => {
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    // Nine TRIAL halls and one FINAL, per PRESET_NODE_TYPE.
    expect(screen.getAllByTitle("TRIAL")).toHaveLength(9);
    expect(screen.getByTitle("FINAL")).toBeInTheDocument();
    // The defect this maps around: `n.type` reaching <DomainEnum> unmapped.
    // It is also the value that POSTs as a 400 when the preset is saved.
    expect(screen.queryByTitle("分流")).not.toBeInTheDocument();
    expect(screen.queryByTitle("终审")).not.toBeInTheDocument();
  });

  it("shows the backend preview's court and node type, not just the node name", async () => {
    mockedTemplates.mockResolvedValue({
      data: [
        {
          ...backendTemplate,
          nodes_json: [{ node_name: "First hall", court_code: "H1", node_type: "TRIAL" }],
        },
      ],
    });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("H1")).toBeInTheDocument();
    expect(screen.getByTitle("TRIAL")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder when a backend template has no description", async () => {
    mockedTemplates.mockResolvedValue({ data: [{ ...backendTemplate, description: "" }] });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("workflow.no_description")).toBeInTheDocument();
  });

  it("switches the preview between two predefined templates", async () => {
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    const appealButton = screen.getAllByText(/申诉|复审/)[0];
    fireEvent.click(appealButton);

    expect(screen.queryByText("workflow.nodes_count(10)")).not.toBeInTheDocument();
  });
});

// ── Permission gates ─────────────────────────────────────────────────

describe("WorkflowPage permission gates", () => {
  beforeEach(() => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
  });

  it("shows every write action to an admin", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("+ workflow.new_template")).toBeInTheDocument();
    expect(screen.getByText("common.edit")).toBeInTheDocument();
    expect(screen.getByText("common.delete")).toBeInTheDocument();
  });

  it("hides the create button from a user without workflow.create", async () => {
    mockSession.user = { role: "JUDGE", permissions: ["workflow.update", "workflow.delete"] };
    renderPage();

    await screen.findByText("Custom Tribunal");
    expect(screen.queryByText("+ workflow.new_template")).not.toBeInTheDocument();
  });

  it("hides the edit button from a user without workflow.update", async () => {
    mockSession.user = { role: "JUDGE", permissions: ["workflow.create", "workflow.delete"] };
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.queryByText("common.edit")).not.toBeInTheDocument();
    expect(screen.getByText("common.delete")).toBeInTheDocument();
  });

  it("hides the delete button from a user without workflow.delete", async () => {
    mockSession.user = { role: "JUDGE", permissions: ["workflow.create", "workflow.update"] };
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
  });

  it("leaves a permissionless user with the read-only view button only", async () => {
    mockSession.user = { role: "VIEWER", permissions: [] };
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.getByText("workflow.view")).toBeInTheDocument();
    expect(screen.queryByText("common.edit")).not.toBeInTheDocument();
    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
    expect(screen.queryByText("+ workflow.new_template")).not.toBeInTheDocument();
  });
});

// ── Deletion ─────────────────────────────────────────────────────────

describe("WorkflowPage template deletion", () => {
  beforeEach(() => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    mockedTemplateDelete.mockResolvedValue({});
  });

  async function openDeleteDialog() {
    renderPage();
    fireEvent.click(await screen.findByText("Custom Tribunal"));
    fireEvent.click(screen.getByText("common.delete"));
    return screen.getByText("workflow.delete_confirm_msg(Custom Tribunal)");
  }

  it("names the template in the confirmation prompt", async () => {
    expect(await openDeleteDialog()).toBeInTheDocument();
    expect(mockedTemplateDelete).not.toHaveBeenCalled();
  });

  it("deletes nothing when the operator cancels", async () => {
    await openDeleteDialog();

    fireEvent.click(screen.getByText("common.cancel"));

    await waitFor(() => expect(screen.queryByText("workflow.delete_irreversible")).not.toBeInTheDocument());
    expect(mockedTemplateDelete).not.toHaveBeenCalled();
  });

  it("deletes the template once confirmed", async () => {
    await openDeleteDialog();

    const dialogButtons = screen.getAllByText("common.confirm_delete");
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(mockedTemplateDelete).toHaveBeenCalledWith("7"));
  });

  it("toasts when the delete request is refused", async () => {
    mockedTemplateDelete.mockRejectedValue(new Error("403"));
    await openDeleteDialog();

    const dialogButtons = screen.getAllByText("common.confirm_delete");
    fireEvent.click(dialogButtons[dialogButtons.length - 1]);

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("workflow.delete_error", "error"));
  });
});

// ── Detail modal ─────────────────────────────────────────────────────

describe("WorkflowPage detail modal", () => {
  it("shows the predefined template's nodes without any network call", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("workflow.view"));

    expect(await screen.findByText("workflow.detail.nodes")).toBeInTheDocument();
    expect(mockedTemplateGet).not.toHaveBeenCalled();
    expect(screen.getAllByText("秦广王 · 分流").length).toBeGreaterThan(0);
  });

  /**
   * The preset's 查看 button builds `nodes_json` locally — no fetch — and
   * `node_type` is the one field in that object that is not a pass-through:
   * `n.type` is a Chinese step name (「分流」「初审」「终审」…), and
   * `nodeTypeFor` is what turns it into a NodeType member. Passing the step
   * name through is the shipped 400 recorded in
   * `@soulledger/core/config/workflow-node-types`.
   *
   * Measured 2026-09-04: reverting that one call to the raw `n.type` left the
   * whole frontend run green — 126 suites / 2177 tests, exit 0. The sibling
   * call on the 编辑 path is guarded by `presetNodeTypes.test.tsx`; this one
   * had nothing on it. That asymmetry is what this case closes.
   *
   * Nothing on the value's path is stubbed. `TemplateDetailModal` and
   * `<DomainEnum>` are the real components, and `t` echoing its key is what
   * lands every enum in the "unrecognized" state, where `<DomainEnum>` puts
   * the *raw* member in `title` — so the strings below are the strings
   * production writes into the DOM. The expected members are literals: a
   * fixture that recomputed them by calling `nodeTypeFor` itself would stay
   * green through exactly the mutation this guards.
   *
   * Scoped to the dialog with `within`. The preview pane behind it renders
   * the same nine TRIALs through a *different* call site
   * (`presetPreviewModel`), so an unscoped count would be answered by the
   * wrong block and this case would guard the line that was already guarded.
   */
  it("maps the predefined nodes onto NodeType members, never the raw step name", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("workflow.view"));
    const dialog = within(await screen.findByRole("dialog"));

    // CHINESE_ROUTINE: nine halls, then 转轮王 · 终审.
    expect(dialog.getAllByTitle("TRIAL")).toHaveLength(9);
    expect(dialog.getByTitle("FINAL")).toBeInTheDocument();
    // Absence: these are the values that POST as `"分流" is not a valid choice`.
    expect(dialog.queryByTitle("分流")).not.toBeInTheDocument();
    expect(dialog.queryByTitle("初审")).not.toBeInTheDocument();
    expect(dialog.queryByTitle("终审")).not.toBeInTheDocument();
    // The names and courts are untouched pass-throughs, asserted so a green
    // above cannot have come from a modal that listed no nodes at all.
    expect(dialog.getByText("秦广王 · 分流")).toBeInTheDocument();
    expect(dialog.getByText("转轮王 · 终审")).toBeInTheDocument();
    expect(dialog.getByText("第一殿")).toBeInTheDocument();
  });

  it("fetches the full template when viewing a backend one", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    mockedTemplateGet.mockResolvedValue({
      data: { ...backendTemplate, nodes: [{ node_name: "Fetched node", approver_role: "JUDGE" }] },
    });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));
    fireEvent.click(screen.getByText("workflow.view"));

    expect(await screen.findByText("Fetched node")).toBeInTheDocument();
    expect(screen.getByText("JUDGE")).toBeInTheDocument();
    expect(mockedTemplateGet).toHaveBeenCalledWith("7");
  });

  it("falls back to the list row when the detail fetch fails, instead of showing nothing", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    mockedTemplateGet.mockRejectedValue(new Error("500"));
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));
    fireEvent.click(screen.getByText("workflow.view"));

    expect(await screen.findByText("workflow.no_node_data")).toBeInTheDocument();
    expect(screen.getAllByText("Custom Tribunal").length).toBeGreaterThan(1);
  });

  /**
   * 保存的模板列表:三态。
   *
   * 这一页有两个查询,只有 `workflows` 那个被修过 —— `templatesData` 既没有
   * `isError` 也没有空态,它的渲染分支以 `: null` 结尾。所以模板列表取失败时
   * **什么都不画**:没有报错,也没有「你还没保存过自己的模板」,只剩它下面那个
   * 预定义列表,而操作员自己的模板本该在那儿。
   *
   * 静默缺失是三种里最糟的一种,因为屏幕上没有任何东西可供怀疑。
   */
  describe("保存的模板:失败 / 空 / 有,是三屏", () => {
    it("取失败时报错,而不是什么都不画", async () => {
      mockedTemplates.mockRejectedValue(new Error("500"));

      const { container } = renderPage();

      await waitFor(() =>
        expect(container.querySelector("[data-query-error]")).toBeInTheDocument()
      );
      // 缺席断言:失败时不许说「你还没保存过」。
      expect(screen.queryByText("workflow.no_custom_templates")).not.toBeInTheDocument();
    });

    it("真的一条都没有时说出来", async () => {
      mockedTemplates.mockResolvedValue({ data: [] });

      const { container } = renderPage();

      expect(await screen.findByText("workflow.no_custom_templates")).toBeInTheDocument();
      expect(container.querySelector("[data-query-error]")).toBeNull();
    });

    it("有模板时两条分支都不出现", async () => {
      mockedTemplates.mockResolvedValue({ data: [backendTemplate] });

      const { container } = renderPage();

      await screen.findByText("workflow.custom_templates");
      expect(screen.queryByText("workflow.no_custom_templates")).not.toBeInTheDocument();
      expect(container.querySelector("[data-query-error]")).toBeNull();
    });
  });
});