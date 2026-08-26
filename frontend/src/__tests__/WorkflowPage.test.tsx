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
import { screen, waitFor, fireEvent } from "@testing-library/react";

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
});