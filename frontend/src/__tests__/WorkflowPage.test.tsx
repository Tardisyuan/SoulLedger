/**
 * Tests for app/workflow/page.tsx — the template browser / instance list.
 *
 * The page mixes two template sources (predefined config objects and saved
 * backend templates) behind one preview pane, and puts three separate
 * permission gates on the write actions. Both are places where a mistake is
 * invisible: the wrong source rendered still looks like a template, and a
 * missing gate still looks like a working page — to whoever has the
 * permission. So the tests below check which source is showing, and assert
 * that each button is *absent* for a user without its permission.
 *
 * `@/src/components/ui/DomainValue` is NOT stubbed. It was, while it was
 * owned by another change in flight, but a stub that rendered `{value}` put
 * the raw enum member back on screen — the precise defect BRIEF §4.6 asks to
 * remove — so the status assertions below were measuring the stub, not the
 * page. The real component is cheap (one span) and reads `t` through the
 * I18nContext mock already installed above.
 */
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowPage from "@/app/workflow/page";
import { workflowApi } from "@/lib/api";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/lib/api", () => ({
  workflowApi: {
    list: jest.fn(),
    templates: { list: jest.fn(), get: jest.fn(), delete: jest.fn() },
  },
  menusApi: {
    all: jest.fn().mockResolvedValue({ data: [] }),
    list: jest.fn().mockResolvedValue({ data: { results: [] } }),
  },
}));

const mockShowToast = jest.fn();
const mockT = jest.fn((key: string) => key);
let mockUser: { role: string; permissions?: string[] } | null = { role: "ADMIN" };

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockUser }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? `${mockT(key)}(${Object.values(params).join(",")})` : mockT(key),
    locale: "en",
    hydrated: true,
  }),
}));

jest.mock("@/src/components/charts/LazyWorkflowEditor", () => ({
  LazyWorkflowEditor: ({ templateId }: { templateId?: string }) => (
    <div data-testid="editor">{templateId ?? "new"}</div>
  ),
}));

const mockedWorkflows = workflowApi.list as jest.Mock;
const mockedTemplates = workflowApi.templates.list as jest.Mock;
const mockedTemplateGet = workflowApi.templates.get as jest.Mock;
const mockedTemplateDelete = workflowApi.templates.delete as jest.Mock;

const backendTemplate = {
  id: 7,
  name: "Custom Tribunal",
  description: "hand rolled",
  civilization: "CHINESE",
  case_type: "APPEAL",
  node_count: 3,
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<WorkflowPage />, { wrapper: Wrapper }) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { role: "ADMIN" };
  mockT.mockImplementation((key: string) => key);
  mockedWorkflows.mockResolvedValue({ data: { results: [] } });
  mockedTemplates.mockResolvedValue({ data: [] });
});

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
    mockUser = { role: "JUDGE", permissions: ["workflow.update", "workflow.delete"] };
    renderPage();

    await screen.findByText("Custom Tribunal");
    expect(screen.queryByText("+ workflow.new_template")).not.toBeInTheDocument();
  });

  it("hides the edit button from a user without workflow.update", async () => {
    mockUser = { role: "JUDGE", permissions: ["workflow.create", "workflow.delete"] };
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.queryByText("common.edit")).not.toBeInTheDocument();
    expect(screen.getByText("common.delete")).toBeInTheDocument();
  });

  it("hides the delete button from a user without workflow.delete", async () => {
    mockUser = { role: "JUDGE", permissions: ["workflow.create", "workflow.update"] };
    renderPage();

    fireEvent.click(await screen.findByText("Custom Tribunal"));

    expect(screen.queryByText("common.delete")).not.toBeInTheDocument();
  });

  it("leaves a permissionless user with the read-only view button only", async () => {
    mockUser = { role: "VIEWER", permissions: [] };
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

  it("navigates to the instance detail when a row is clicked", async () => {
    mockedWorkflows.mockResolvedValue({
      data: { results: [{ id: "w9", workflow_name: "Trial A", soul: "Meng", status: "COMPLETED", is_appeal: false }] },
    });
    await openInstances();

    fireEvent.click(await screen.findByText("Trial A"));

    expect(mockPush).toHaveBeenCalledWith("/workflow/w9");
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
