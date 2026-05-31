/**
 * Tests for src/hooks/useWorkflows.ts
 */
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import {
  useWorkflows, useWorkflowTemplates,
  useCreateWorkflow, useAdvanceWorkflow, useApproveNode,
  useCreateWorkflowTemplate, useUpdateWorkflowTemplate, useDeleteWorkflowTemplate,
} from "@/src/hooks/useWorkflows";
import { workflowApi } from "@/lib/api";
import { workflowKeys } from "@/lib/query_keys";

const mockShowToast = jest.fn();

jest.mock("@/lib/api", () => ({
  workflowApi: {
    list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
    get: jest.fn().mockResolvedValue({ data: {} }),
    create: jest.fn().mockResolvedValue({ data: {} }),
    advance: jest.fn().mockResolvedValue({ data: {} }),
    approveNode: jest.fn().mockResolvedValue({ data: {} }),
    templates: {
      list: jest.fn().mockResolvedValue({ data: { results: [], count: 0 } }),
      get: jest.fn().mockResolvedValue({ data: {} }),
      create: jest.fn().mockResolvedValue({ data: {} }),
      update: jest.fn().mockResolvedValue({ data: {} }),
      delete: jest.fn().mockResolvedValue({ data: {} }),
    },
  },
}));

jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
  }),
}));

jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  jest.spyOn(queryClient, "invalidateQueries");
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: React.ReactNode }) {
      return createElement(QueryClientProvider, { client: queryClient }, children);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Query key tests ───────────────────────────────────────────────────

describe("workflowKeys", () => {
  it("should generate correct query keys", () => {
    expect(workflowKeys.all).toEqual(["workflows"]);
    expect(workflowKeys.list({ status: "ACTIVE" })).toEqual(["workflows", "list", { status: "ACTIVE" }]);
    expect(workflowKeys.detail("wf-1")).toEqual(["workflows", "detail", "wf-1"]);
    expect(workflowKeys.templates.all).toEqual(["workflow-templates"]);
  });
});

// ── Shape tests (sanity) ──────────────────────────────────────────────

describe("useWorkflows", () => {
  it("should fetch workflows list", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkflows(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useWorkflowTemplates", () => {
  it("should fetch workflow templates", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useWorkflowTemplates(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useCreateWorkflow", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
  });
});

describe("useAdvanceWorkflow", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useApproveNode", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useApproveNode(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useCreateWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useUpdateWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useDeleteWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper });
    expect(result.current).toHaveProperty("mutate");
  });
});

// ── Workflow mutation behavior ─────────────────────────────────────────

describe("useCreateWorkflow behavior", () => {
  it("calls workflowApi.create with provided data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Approval 1", type: "LEAVE" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.create).toHaveBeenCalledWith({ name: "Approval 1", type: "LEAVE" });
  });

  it("invalidates workflow queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Test" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflows"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Test" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.create as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Test" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("useAdvanceWorkflow behavior", () => {
  it("calls workflowApi.advance with the workflow id", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate("wf-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.advance).toHaveBeenCalledWith("wf-1");
  });

  it("invalidates workflow queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate("wf-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflows"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate("wf-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.advance as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper });
    await act(async () => {
      result.current.mutate("wf-1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("useApproveNode behavior", () => {
  it("calls workflowApi.approveNode with nodeId and data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useApproveNode(), { wrapper });
    await act(async () => {
      result.current.mutate({ nodeId: "node-1", data: { approved: true } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.approveNode).toHaveBeenCalledWith("node-1", { approved: true });
  });

  it("invalidates workflow queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useApproveNode(), { wrapper });
    await act(async () => {
      result.current.mutate({ nodeId: "node-1", data: { approved: true } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflows"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useApproveNode(), { wrapper });
    await act(async () => {
      result.current.mutate({ nodeId: "node-1", data: { approved: true } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.approveNode as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useApproveNode(), { wrapper });
    await act(async () => {
      result.current.mutate({ nodeId: "node-1", data: { approved: true } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

// ── Template mutation behavior ─────────────────────────────────────────

describe("useCreateWorkflowTemplate behavior", () => {
  it("calls workflowApi.templates.create with provided data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Template 1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.templates.create).toHaveBeenCalledWith({ name: "Template 1" });
  });

  it("invalidates template queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Template 1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflow-templates"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Template 1" });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.templates.create as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ name: "Template 1" });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("useUpdateWorkflowTemplate behavior", () => {
  it("calls workflowApi.templates.update with id and data", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "tpl-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.templates.update).toHaveBeenCalledWith("tpl-1", { name: "Updated" });
  });

  it("invalidates template queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "tpl-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflow-templates"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "tpl-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.templates.update as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "tpl-1", data: { name: "Updated" } });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});

describe("useDeleteWorkflowTemplate behavior", () => {
  it("calls workflowApi.templates.delete with the template id", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate("tpl-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(workflowApi.templates.delete).toHaveBeenCalledWith("tpl-1");
  });

  it("invalidates template queries on success", async () => {
    const { queryClient, wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate("tpl-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["workflow-templates"] })
    );
  });

  it("shows success toast on success", async () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate("tpl-1");
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "success");
  });

  it("shows error toast on failure", async () => {
    (workflowApi.templates.delete as jest.Mock).mockRejectedValueOnce(new Error("fail"));
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper });
    await act(async () => {
      result.current.mutate("tpl-1");
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), "error");
  });
});
