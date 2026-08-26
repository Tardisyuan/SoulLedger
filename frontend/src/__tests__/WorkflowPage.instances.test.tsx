/**
 * Tests for app/workflow/page.tsx — part two: the instance list, the editor
 * tab, and the loading state.
 *
 * The instance rows are the part with a live accessibility contract: they used
 * to be `<div onClick={router.push}>`, which a mouse satisfies and a keyboard
 * never reaches. The row test below asserts the anchor and its `href`, and
 * asserts the *absence* of a negative tabIndex — the one edit that would put
 * the fix back behind a tag that still looks correct.
 *
 * The template browser, permission gates, deletion, and detail modal live in
 * `WorkflowPage.test.tsx`. Every module double both files use is defined once
 * in `support/workflowPageHarness.tsx`, which is also where `renderPage` comes
 * from — this file deliberately does not import the page itself, so the mocks
 * cannot be bypassed by an import landing first.
 */
import { screen, fireEvent, within } from "@testing-library/react";

import {
  backendTemplate,
  installWorkflowPageHarness,
  mockedTemplates,
  mockedWorkflows,
  mockT,
  renderPage,
} from "./support/workflowPageHarness";

installWorkflowPageHarness();

// ── Instances tab ────────────────────────────────────────────────────

describe("WorkflowPage instances tab", () => {
  async function openInstances() {
    renderPage();
    fireEvent.click(await screen.findByText("workflow.instances"));
  }

  it("shows an empty state when there are no workflow instances", async () => {
    await openInstances();

    expect(await screen.findByText("workflow.no_instances")).toBeInTheDocument();
  });

  it("never shows the raw status, even when no bundle covers it", async () => {
    mockedWorkflows.mockResolvedValue({
      data: {
        results: [
          { id: "w1", workflow_name: "Trial A", case_type: "ROUTINE", soul: "Meng", status: "IN_PROGRESS", is_appeal: false },
        ],
      },
    });
    await openInstances();

    // BRIEF §4.6: an enum member the bundles don't cover falls back to the
    // convention's "unrecognized" copy, never to the SCREAMING_SNAKE token —
    // see resolveEnumDisplay in src/lib/domainDisplay.ts. (`t` is mocked to
    // echo its key here, so the visible copy is the key for that string.)
    expect(await screen.findByText("Trial A")).toBeInTheDocument();
    expect(screen.queryByText("IN_PROGRESS")).not.toBeInTheDocument();
    // The row's case_type is also uncovered, so two cells read "unrecognized";
    // select by title, which names exactly which enum this is.
    expect(screen.getByTitle("IN_PROGRESS").textContent).toBe("common.value.unrecognized");
  });

  it("uses the translated status when a translation exists", async () => {
    mockT.mockImplementation((key: string) => (key === "workflow.status.COMPLETED" ? "已完成" : key));
    mockedWorkflows.mockResolvedValue({
      data: { results: [{ id: "w1", workflow_name: "Trial A", soul: "Meng", status: "COMPLETED", is_appeal: false }] },
    });
    await openInstances();

    expect(await screen.findByText("已完成")).toBeInTheDocument();
    expect(screen.queryByText("COMPLETED")).not.toBeInTheDocument();
  });

  it("renders an empty status label rather than 'undefined' when status is missing", async () => {
    mockedWorkflows.mockResolvedValue({
      data: { results: [{ id: "w1", workflow_name: "Trial A", soul: "Meng", is_appeal: false }] },
    });
    await openInstances();

    await screen.findByText("Trial A");
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("badges only the instances that are appeals", async () => {
    mockedWorkflows.mockResolvedValue({
      data: {
        results: [
          { id: "w1", workflow_name: "Plain", soul: "A", status: "COMPLETED", is_appeal: false },
          { id: "w2", workflow_name: "Appealed", soul: "B", status: "COMPLETED", is_appeal: true },
        ],
      },
    });
    await openInstances();

    await screen.findByText("Plain");
    expect(screen.getAllByText("workflow.appeal_badge")).toHaveLength(1);
  });

  /**
   * The row used to be a <div onClick={router.push}>, and the old version of
   * this test asserted `mockPush` — which a mouse click satisfies and a
   * keyboard user never can. Asserting the anchor instead is the point: an
   * <a href> is the only shape here that Tab reaches and Enter activates, so
   * checking `href` on an <a> checks the accessibility fix, not just that
   * something navigates. `closest("a")` would also match a wrapper further up,
   * so the tab-order assertion below pins that the row itself is focusable.
   */
  it("renders each instance row as a focusable link to its detail page", async () => {
    mockedWorkflows.mockResolvedValue({
      data: { results: [{ id: "w9", workflow_name: "Trial A", soul: "Meng", status: "COMPLETED", is_appeal: false }] },
    });
    await openInstances();

    const row = (await screen.findByText("Trial A")).closest("a");
    expect(row).not.toBeNull();
    expect(row).toHaveAttribute("href", "/workflow/w9");
    // A negative tabIndex would put the anchor back out of tab order and
    // re-create the bug behind a tag that looks correct.
    expect(row).not.toHaveAttribute("tabindex", "-1");
  });
});

// ── Editor tab ───────────────────────────────────────────────────────

describe("WorkflowPage editor tab", () => {
  it("opens the editor with no template id when creating a new one", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("+ workflow.new_template"));

    expect(screen.getByTestId("editor")).toHaveTextContent("new");
  });

  it("opens the editor bound to the template being edited", async () => {
    mockedTemplates.mockResolvedValue({ data: [backendTemplate] });
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));
    fireEvent.click(screen.getByText("common.edit"));

    expect(screen.getByTestId("editor")).toHaveTextContent("7");
  });

  it("hands the preset's own priority to the editor", async () => {
    // 紧急审判流程 (CHINESE_EMERGENCY) carries `priority: 1`. Dropping it here
    // would make the editor open at 0 and POST 0, so `WorkflowTemplate.priority`
    // would exist and no preset could ever set it.
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    fireEvent.click(screen.getAllByText("紧急审判流程")[0]);
    fireEvent.click(screen.getByText("common.edit"));

    expect(screen.getByTestId("editor-priority")).toHaveTextContent("1");
  });

  it("hands an ordinary preset's priority through as 0, not as undefined", async () => {
    // Absence: the case above would also pass if `priority` were hardcoded to
    // 1 on the way into the editor.
    renderPage();

    await screen.findByText("workflow.predefined_templates");
    fireEvent.click(screen.getByText("common.edit"));

    expect(screen.getByTestId("editor-priority")).toHaveTextContent("0");
  });

  it("returns to the template list when the editor tab is left", async () => {
    renderPage();

    fireEvent.click(await screen.findByText("+ workflow.new_template"));
    expect(screen.getByTestId("editor")).toBeInTheDocument();

    fireEvent.click(screen.getByText("workflow.existing"));

    expect(screen.queryByTestId("editor")).not.toBeInTheDocument();
    expect(screen.getByText("workflow.predefined_templates")).toBeInTheDocument();
  });
});

// ── Loading states ───────────────────────────────────────────────────

describe("WorkflowPage loading", () => {
  it("shows a skeleton list while the backend templates load", () => {
    mockedTemplates.mockReturnValue(new Promise(() => {}));

    const { container } = renderPage();

    expect(within(container).queryByText("workflow.custom_templates")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
  });
});
