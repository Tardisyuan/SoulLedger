/**
 * Shared fixture for the `app/workflow/page.tsx` suites.
 *
 * `WorkflowPage.test.tsx` (templates, permissions, deletion, detail modal) and
 * `WorkflowPage.instances.test.tsx` (instance list, editor tab, loading) are
 * two halves of one set of tests. Both need the same eight module mocks, and
 * the two must not drift: the header of the original file records a case where
 * a stub rendering `{value}` reproduced the exact defect under test, so the
 * assertions measured the stub. Two copies of a stub is two chances for that.
 * There is therefore exactly one copy of every double, here.
 *
 * `@/src/components/ui/DomainValue` is deliberately NOT stubbed, for the same
 * reason. The real component is cheap (one span) and reads `t` through the
 * I18nContext mock installed below.
 *
 * IMPORT ORDER MATTERS, and is guarded by construction: this module owns the
 * only import of `@/app/workflow/page` in the suite. The `jest.mock` calls
 * below are hoisted above that import, so the page always sees the doubles.
 * A suite file that imported the page itself could get the real modules
 * instead — so it does not; it takes `renderPage` from here.
 *
 * This file is deliberately NOT named `*.test.tsx`: `jest.config.js`'s
 * `testMatch` and `suiteShape.test.ts`'s directory walk both key on that
 * suffix, and a fixture is neither a suite nor something the suite list should
 * carry.
 */
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkflowPage from "@/app/workflow/page";
import { workflowApi } from "@/lib/api";

export const mockPush = jest.fn();

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

export const mockShowToast = jest.fn();
export const mockT = jest.fn((key: string) => key);

/** Mutable stand-in for the signed-in user; assign `mockSession.user` in a test
 *  to change who the page thinks is looking at it. Reset before every test. */
export const mockSession: { user: { role: string; permissions?: string[] } | null } = {
  user: { role: "ADMIN" },
};

jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: mockSession.user }),
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
  // `initialTemplateData.priority` is rendered, not just accepted: the preset's
  // template-level urgency has to survive the hand-off into the editor, and a
  // stub that swallowed it would keep the case below green while the three
  // 紧急审判流程 presets opened — and saved — as ordinary ones.
  LazyWorkflowEditor: ({
    templateId,
    initialTemplateData,
  }: {
    templateId?: string;
    initialTemplateData?: { priority?: number };
  }) => (
    <div data-testid="editor">
      {templateId ?? "new"}
      <span data-testid="editor-priority">
        {initialTemplateData ? String(initialTemplateData.priority) : "none"}
      </span>
    </div>
  ),
}));

export const mockedWorkflows = workflowApi.list as jest.Mock;
export const mockedTemplates = workflowApi.templates.list as jest.Mock;
export const mockedTemplateGet = workflowApi.templates.get as jest.Mock;
export const mockedTemplateDelete = workflowApi.templates.delete as jest.Mock;

export const backendTemplate = {
  id: 7,
  name: "Custom Tribunal",
  description: "hand rolled",
  civilization: "CHINESE",
  case_type: "APPEAL",
  node_count: 3,
};

export function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, ...render(<WorkflowPage />, { wrapper: Wrapper }) };
}

/** Registers the reset both suites share. Call once at a suite's top level. */
export function installWorkflowPageHarness() {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.user = { role: "ADMIN" };
    mockT.mockImplementation((key: string) => key);
    mockedWorkflows.mockResolvedValue({ data: { results: [] } });
    mockedTemplates.mockResolvedValue({ data: [] });
  });
}
