/**
 * Tests for src/hooks/useWorkflows.ts
 */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import {
  useWorkflows, useWorkflowTemplates,
  useCreateWorkflow, useAdvanceWorkflow, useApproveNode,
  useCreateWorkflowTemplate, useUpdateWorkflowTemplate, useDeleteWorkflowTemplate,
} from "@/src/hooks/useWorkflows";
import { workflowKeys } from "@/lib/query_keys";

// Mock the API
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

// Mock showToast
jest.mock("@/src/components/ui/Toast", () => ({
  showToast: jest.fn(),
}));

// Mock useI18n
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    t: (key: string) => key,
    locale: "en",
    setLocale: jest.fn(),
    hydrated: true,
  }),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

describe("workflowKeys", () => {
  it("should generate correct query keys", () => {
    expect(workflowKeys.all).toEqual(["workflows"]);
    expect(workflowKeys.list({ status: "ACTIVE" })).toEqual(["workflows", "list", { status: "ACTIVE" }]);
    expect(workflowKeys.detail("wf-1")).toEqual(["workflows", "detail", "wf-1"]);
    expect(workflowKeys.templates.all).toEqual(["workflow-templates"]);
  });
});

describe("useWorkflows", () => {
  it("should fetch workflows list", async () => {
    const { result } = renderHook(() => useWorkflows(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useWorkflowTemplates", () => {
  it("should fetch workflow templates", async () => {
    const { result } = renderHook(() => useWorkflowTemplates(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results).toEqual([]);
  });
});

describe("useCreateWorkflow", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useCreateWorkflow(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
    expect(result.current).toHaveProperty("isPending");
  });
});

describe("useAdvanceWorkflow", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useAdvanceWorkflow(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useApproveNode", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useApproveNode(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useCreateWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useCreateWorkflowTemplate(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useUpdateWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useUpdateWorkflowTemplate(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});

describe("useDeleteWorkflowTemplate", () => {
  it("returns mutation object", () => {
    const { result } = renderHook(() => useDeleteWorkflowTemplate(), { wrapper: createWrapper() });
    expect(result.current).toHaveProperty("mutate");
  });
});
