/**
 * app/scheduler/page.tsx — permissions, grouping, the three failure shapes a
 * write can have, and what the page does with values it does not know.
 *
 * `RequirePermission` and `usePermissions` run for real against a stubbed
 * `useTenant`, the way `permissionGatesActuallyWithhold.test.tsx` does it: a
 * stubbed gate cannot tell "the gate works" from "there is no gate". Every
 * withheld control is asserted absent AND present under the permission that
 * should reveal it.
 *
 * Copy is the real zh-Hans bundle (`tZh`), so a key the page asks for that the
 * bundle lacks renders as the raw key and the text assertions miss.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SchedulerPage from "@/app/scheduler/page";
import en from "@soulledger/core/messages/en.json";
import egy from "@soulledger/core/messages/egy.json";
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import { tZh, zh } from "./support/zhBundle";

jest.mock("@soulledger/core/api", () => ({
  PAGE_SIZE: 20,
  schedulerApi: { jobs: jest.fn(), runs: jest.fn(), updateJob: jest.fn(), runJob: jest.fn(), rebuild: jest.fn() },
}));
const { schedulerApi } = jest.requireMock("@soulledger/core/api") as {
  schedulerApi: Record<"jobs" | "runs" | "updateJob" | "runJob" | "rebuild", jest.Mock>;
};

let mockUser: { id: number; username: string; role: string; permissions: string[] } | null = null;
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));

const mockI18n = {
  t: tZh,
  formatDateTime: (v: string | Date) => `dt(${v instanceof Date ? v.toISOString() : v})`,
  locale: "zh-Hans",
  hydrated: true,
};
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => mockI18n,
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
const mockListeners = new Set<(_event: Record<string, unknown>) => void>();
jest.mock("@/src/contexts/WebSocketContext", () => ({
  useWebSocket: () => ({
    isConnected: true,
    subscribe: (listener: (_event: Record<string, unknown>) => void) => {
      mockListeners.add(listener);
      return () => {
        mockListeners.delete(listener);
      };
    },
  }),
}));
jest.mock("@/src/components/layout/MenuGloss", () => ({ MenuGloss: () => null }));

type Job = Record<string, unknown>;
function job(over: Job = {}): Job {
  return {
    id: 1,
    job_key: "ledger.recalculate_tenant",
    periodic_task_name: "ledger.recalculate_tenant@CN_DIYU",
    task_name: "ledger.recalculate_tenant",
    scope: "TENANT",
    tenant: 1,
    tenant_code: "CN_DIYU",
    description_key: "scheduler.jobs.ledger_recalculate_tenant",
    enabled: true,
    minute: "0",
    hour: "0",
    day_of_month: "*",
    month_of_year: "*",
    day_of_week: "*",
    timezone: "UTC",
    max_runtime_seconds: 3600,
    next_run_at: "2026-09-18T00:00:00Z",
    last_run: { id: 5, status: "SUCCESS", trigger: "SCHEDULE", queued_at: "2026-09-17T00:00:00Z", started_at: "2026-09-17T00:00:01Z", finished_at: "2026-09-17T00:00:03Z", duration_ms: 2100 },
    overdue: false,
    expected_at: null,
    consecutive_failures: 0,
    last_alerted_at: null,
    ...over,
  };
}

const GLOBAL_JOB = job({
  id: 9,
  job_key: "events.retry_pending_webhooks",
  periodic_task_name: "events.retry_pending_webhooks",
  task_name: "events.retry_pending_webhooks",
  scope: "GLOBAL",
  tenant: null,
  tenant_code: null,
  description_key: "scheduler.jobs.events_retry_pending_webhooks",
  minute: "*/5",
  hour: "*",
});

const http = (status: number, data?: unknown) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data } });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return render(<SchedulerPage />, { wrapper: Wrapper });
}

const asAdmin = () => (mockUser = { id: 1, username: "admin", role: "ADMIN", permissions: [] });
const asRole = (...permissions: string[]) => (mockUser = { id: 2, username: "op", role: "GUARDIAN", permissions });

beforeEach(() => {
  jest.clearAllMocks();
  schedulerApi.jobs.mockResolvedValue({ data: [job(), GLOBAL_JOB, job({ id: 2, tenant: 2, tenant_code: "EG_DUAT", periodic_task_name: "ledger.recalculate_tenant@EG_DUAT" })] });
  schedulerApi.runs.mockResolvedValue({ data: { count: 0, next: null, previous: null, results: [] } });
});

describe("access", () => {
  it("refuses the page without scheduler.read and asks the API nothing", async () => {
    asRole("soul.read");
    renderPage();
    expect(screen.getByText(tZh("permission.denied_title"))).toBeInTheDocument();
    expect(schedulerApi.jobs).not.toHaveBeenCalled();
  });

  it("read-only: rows and history, but no switch, no run, no edit, no rebuild", async () => {
    asRole("scheduler.read");
    renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: tZh("scheduler.actions.run_now") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("scheduler.actions.edit") })).toBeNull();
    expect(screen.queryByRole("button", { name: tZh("scheduler.rebuild") })).toBeNull();
    expect(screen.getAllByRole("button", { name: tZh("scheduler.actions.runs") }).length).toBeGreaterThan(0);
    // The reason the controls are missing is on the page, not only in the code.
    expect(screen.getByText(new RegExp(tZh("scheduler.manage_hint").replace(/\./g, "\\.")))).toBeInTheDocument();
  });

  it("scheduler.manage without ADMIN: every row control, still no rebuild", async () => {
    asRole("scheduler.read", "scheduler.manage");
    renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: tZh("scheduler.actions.run_now") })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: tZh("scheduler.actions.edit") })).toHaveLength(3);
    expect(screen.queryByRole("button", { name: tZh("scheduler.rebuild") })).toBeNull();
  });

  it("ADMIN gets rebuild, behind a confirmation", async () => {
    asAdmin();
    schedulerApi.rebuild.mockResolvedValue({ data: { created: 2, updated: 1, removed: 0, legacy_removed: 3 } });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("scheduler.rebuild") }));
    expect(schedulerApi.rebuild).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("scheduler.rebuild") }));
    await waitFor(() => expect(schedulerApi.rebuild).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        tZh("scheduler.rebuild_done", { created: "2", updated: "1", removed: "0", legacy_removed: "3" }),
        "success"
      )
    );
  });
});

describe("grouping and filters", () => {
  it("puts the global group first, then one group per tenant", async () => {
    asAdmin();
    const { container } = renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    const groups = [...container.querySelectorAll("section[data-group]")].map((s) => s.getAttribute("data-group"));
    expect(groups).toEqual(["global", "tenant:CN_DIYU", "tenant:EG_DUAT"]);
  });

  it("collapses a group without dropping the others", async () => {
    asAdmin();
    const { container } = renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    const header = within(container.querySelector('section[data-group="global"]') as HTMLElement).getByRole("button", {
      expanded: true,
    });
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(container.querySelector('[data-job-id="9"]')).toBeNull();
    expect(container.querySelector('[data-job-id="1"]')).not.toBeNull();
  });

  it.each([
    ["disabled", { enabled: false }],
    ["overdue", { overdue: true, expected_at: "2026-09-17T00:00:00Z" }],
    ["failing", { consecutive_failures: 2 }],
  ] as const)("the %s filter keeps only matching rows", async (filter, over) => {
    asAdmin();
    schedulerApi.jobs.mockResolvedValue({ data: [job(), job({ id: 7, ...over })] });
    const { container } = renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    fireEvent.click(screen.getByRole("button", { name: tZh(`scheduler.filters.${filter}`) }));
    expect([...container.querySelectorAll("[data-job-id]")].map((li) => li.getAttribute("data-job-id"))).toEqual(["7"]);
  });

  it("says the filter hid everything, which is not the same as nothing registered", async () => {
    asAdmin();
    renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    fireEvent.click(screen.getByRole("button", { name: tZh("scheduler.filters.failing") }));
    expect(screen.getByText(tZh("scheduler.empty.no_match"))).toBeInTheDocument();
    expect(screen.queryByText(tZh("scheduler.empty.no_jobs"))).toBeNull();
  });
});

describe("loading, error and empty are three different screens", () => {
  it("a failed request shows the error with a retry, not the empty state", async () => {
    asAdmin();
    schedulerApi.jobs.mockRejectedValue(http(500));
    renderPage();
    expect(await screen.findByRole("button", { name: tZh("error.retry") })).toBeInTheDocument();
    expect(screen.queryByText(tZh("scheduler.empty.no_jobs"))).toBeNull();
  });

  it("an empty registry says so", async () => {
    asAdmin();
    schedulerApi.jobs.mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText(tZh("scheduler.empty.no_jobs"))).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("values this build does not know are shown, not swallowed", () => {
  it("an unknown run status and an unknown description key render as unrecognized, raw value in title", async () => {
    asAdmin();
    schedulerApi.jobs.mockResolvedValue({
      data: [
        job({
          description_key: "scheduler.jobs.brand_new_job",
          last_run: { id: 1, status: "EXPLODED", trigger: "SCHEDULE", queued_at: "2026-09-17T00:00:00Z", started_at: null, finished_at: null, duration_ms: null },
        }),
      ],
    });
    renderPage();
    const status = await screen.findByTitle("EXPLODED");
    expect(status).toHaveTextContent(tZh("common.value.unrecognized"));
    expect(status).toHaveAttribute("data-enum-state", "unrecognized");
    const name = screen.getByTitle("brand_new_job");
    expect(name).toHaveTextContent(tZh("common.value.unrecognized"));
    // Absence: the dotted key never reaches the text.
    expect(screen.queryByText("scheduler.jobs.brand_new_job")).toBeNull();
  });
});

describe("run now", () => {
  async function confirmRun() {
    asRole("scheduler.read", "scheduler.manage");
    renderPage();
    fireEvent.click((await screen.findAllByRole("button", { name: tZh("scheduler.actions.run_now") }))[0]);
    expect(schedulerApi.runJob).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("scheduler.actions.run_now") }));
    await waitFor(() => expect(schedulerApi.runJob).toHaveBeenCalledTimes(1));
  }

  it("confirms first, then queues and says so", async () => {
    schedulerApi.runJob.mockResolvedValue({ data: { id: 50, status: "PENDING" } });
    await confirmRun();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("scheduler.run.queued"), "success"));
  });

  it.each([
    [409, "scheduler.run.locked"],
    [503, "scheduler.run.enqueue_failed"],
    [500, "scheduler.run.failed"],
  ])("%i reads as %s", async (status, key) => {
    schedulerApi.runJob.mockRejectedValue(http(status, { detail: "x" }));
    await confirmRun();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh(key), "error"));
    expect(mockShowToast).not.toHaveBeenCalledWith(tZh("scheduler.run.queued"), "success");
  });
});

describe("enable switch", () => {
  it("PATCHes only `enabled`, with the inverse of the row", async () => {
    asRole("scheduler.read", "scheduler.manage");
    schedulerApi.jobs.mockResolvedValue({ data: [job({ enabled: true })] });
    schedulerApi.updateJob.mockResolvedValue({ data: job({ enabled: false }) });
    renderPage();
    fireEvent.click(await screen.findByRole("switch"));
    await waitFor(() => expect(schedulerApi.updateJob).toHaveBeenCalledWith(1, { enabled: false }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(tZh("scheduler.toggle.disabled"), "success"));
  });
});

describe("schedule editor", () => {
  async function openEditor(over: Job = {}) {
    asRole("scheduler.read", "scheduler.manage");
    schedulerApi.jobs.mockResolvedValue({ data: [job({ minute: "30", hour: "3", ...over })] });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("scheduler.actions.edit") }));
    return screen.findByRole("dialog");
  }
  const presetSelect = (dialog: HTMLElement) => within(dialog).getByLabelText(tZh("scheduler.editor.preset")) as HTMLSelectElement;

  it("reads a preset-shaped cron as that preset, and edited raw text as custom", async () => {
    const dialog = await openEditor();
    expect(presetSelect(dialog).value).toBe("daily");
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("scheduler.editor.advanced") }));
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.day_of_week")), { target: { value: "1-5" } });
    expect(presetSelect(dialog).value).toBe("custom");
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.day_of_week")), { target: { value: "2" } });
    expect(presetSelect(dialog).value).toBe("weekly");
  });

  it("choosing a preset writes the raw fields", async () => {
    const dialog = await openEditor();
    fireEvent.change(presetSelect(dialog), { target: { value: "every_n_minutes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("scheduler.editor.advanced") }));
    expect((within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.minute")) as HTMLInputElement).value).toBe("*/5");
    expect((within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.hour")) as HTMLInputElement).value).toBe("*");
  });

  it("previews the next three runs, and says so when the text cannot be parsed", async () => {
    const dialog = await openEditor();
    expect(within(dialog).getByTestId("cron-preview").querySelectorAll("li")).toHaveLength(3);
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("scheduler.editor.advanced") }));
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.hour")), { target: { value: "25" } });
    expect(within(dialog).getByText(tZh("scheduler.editor.preview_invalid"))).toBeInTheDocument();
    expect(within(dialog).queryByTestId("cron-preview")).toBeNull();
  });

  it("sends only what changed", async () => {
    schedulerApi.updateJob.mockResolvedValue({ data: job({ minute: "45", hour: "3", timezone: "Asia/Shanghai" }) });
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.minute")), { target: { value: "45" } });
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.timezone")), { target: { value: "Asia/Shanghai" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.save") }));
    await waitFor(() => expect(schedulerApi.updateJob).toHaveBeenCalledWith(1, { minute: "45", timezone: "Asia/Shanghai" }));
  });

  it("puts a 400 cron error beside the cron fields, opening them if they were closed", async () => {
    schedulerApi.updateJob.mockRejectedValue(http(400, { cron: ["invalid crontab: Invalid end range: 60 > 59."] }));
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.minute")), { target: { value: "45" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.save") }));
    const alert = await within(dialog).findByText("invalid crontab: Invalid end range: 60 > 59.");
    expect(alert).toHaveAttribute("role", "alert");
    expect(within(dialog).getByLabelText(tZh("scheduler.editor.cron_fields.minute"))).toBeInTheDocument();
    expect(mockShowToast).not.toHaveBeenCalledWith(tZh("scheduler.editor.save_failed"), "error");
    // Still open: the operator has something to fix.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("puts a 400 timezone error on the timezone field", async () => {
    schedulerApi.updateJob.mockRejectedValue(http(400, { timezone: ["Unknown time zone"] }));
    const dialog = await openEditor();
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.timezone")), { target: { value: "Europe/Rome" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tZh("common.save") }));
    const select = within(dialog).getByLabelText(tZh("scheduler.editor.timezone"));
    await waitFor(() => expect(select).toHaveAttribute("aria-invalid", "true"));
    const describedBy = select.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy.split(" ").at(-1)!)).toHaveTextContent("Unknown time zone");
  });

  it("pins the five common zones first and filters the rest by search", async () => {
    const dialog = await openEditor();
    const select = within(dialog).getByLabelText(tZh("scheduler.editor.timezone")) as HTMLSelectElement;
    const common = select.querySelector(`optgroup[label="${tZh("scheduler.editor.timezone_common")}"]`)!;
    expect([...common.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "UTC",
      "Asia/Shanghai",
      "Africa/Cairo",
      "Europe/Rome",
      "Europe/Athens",
    ]);
    expect(select.querySelector('option[value="Asia/Shanghai"]')).toHaveTextContent("Asia/Shanghai (UTC+08:00)");
    fireEvent.change(within(dialog).getByLabelText(tZh("scheduler.editor.timezone_search")), { target: { value: "tokyo" } });
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual(["UTC", "Asia/Tokyo"]);
  });
});

describe("run history drawer", () => {
  it("asks for this job's runs, filters by status from page 1, and hides a failure's error until asked", async () => {
    asAdmin();
    schedulerApi.jobs.mockResolvedValue({ data: [job()] });
    schedulerApi.runs.mockResolvedValue({
      data: {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 77, job: 1, task_name: "ledger.recalculate_tenant", celery_task_id: "c-1", tenant: 1, trigger: "MANUAL",
            status: "FAILURE", queued_at: "2026-09-17T00:00:00Z", started_at: "2026-09-17T00:00:01Z",
            finished_at: "2026-09-17T00:00:02Z", duration_ms: 900, worker_hostname: "celery@w1",
            error: "Traceback (most recent call last):\nValueError: boom", result: "", triggered_by: 1, triggered_by_username: "admin",
          },
        ],
      },
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: tZh("scheduler.actions.runs") }));
    const drawer = await screen.findByRole("dialog");
    await waitFor(() => expect(schedulerApi.runs).toHaveBeenCalledWith({ job: 1, status: undefined, page: 1 }));
    await within(drawer).findByTitle("FAILURE");
    expect(within(drawer).queryByText(/ValueError: boom/)).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: tZh("scheduler.runs.show_error") }));
    expect(within(drawer).getByText(/ValueError: boom/)).toBeInTheDocument();

    fireEvent.change(within(drawer).getByLabelText(tZh("scheduler.runs.status_filter")), { target: { value: "FAILURE" } });
    await waitFor(() => expect(schedulerApi.runs).toHaveBeenCalledWith({ job: 1, status: "FAILURE", page: 1 }));

    act(() => {
      fireEvent.keyDown(drawer, { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("run history tab", () => {
  const RUN = {
    id: 88, job: 9, task_name: "events.retry_pending_webhooks", celery_task_id: "c-88", tenant: null, trigger: "SCHEDULE",
    status: "LOST", queued_at: "2026-09-18T00:00:00Z", started_at: null, finished_at: null, duration_ms: null,
    worker_hostname: "", error: "", result: "", triggered_by: null, triggered_by_username: null,
  };

  async function openHistory(client?: QueryClient) {
    schedulerApi.runs.mockResolvedValue({ data: { count: 1, next: null, previous: null, results: [RUN] } });
    const qc = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<SchedulerPage />, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    const tab = screen.getByRole("button", { name: tZh("scheduler.tabs.history") });
    expect(tab).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-pressed", "true");
    return screen.findByTestId("run-history");
  }

  it("opens on FAILURE + LOST across every job, and names each run's job and tenant", async () => {
    asAdmin();
    const panel = await openHistory();
    await waitFor(() => expect(schedulerApi.runs).toHaveBeenLastCalledWith({ status: "FAILURE,LOST", page: 1 }));
    const call = schedulerApi.runs.mock.lastCall![0] as Record<string, unknown>;
    expect(call.job).toBeUndefined();
    const statuses = within(panel).getByRole("group", { name: tZh("scheduler.runs.status_filter") });
    // By accessible name, not textContent: a pressed filter chip also draws an
    // aria-hidden「×」, which is chrome, not part of the label.
    expect(within(statuses).getAllByRole("button", { pressed: true })).toEqual([
      within(statuses).getByRole("button", { name: tZh("scheduler.status.FAILURE") }),
      within(statuses).getByRole("button", { name: tZh("scheduler.status.LOST") }),
    ]);
    const row = await within(panel).findByTitle("LOST");
    const item = row.closest("li")!;
    expect(item).toHaveTextContent(tZh("scheduler.jobs.events_retry_pending_webhooks"));
    expect(item).toHaveTextContent(tZh("scheduler.groups.global"));
    // The job list is not on this tab.
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.queryByRole("group", { name: tZh("scheduler.filters.label") })).toBeNull();
  });

  it("clearing the filters asks for every status; each filter goes to the API from page 1", async () => {
    asAdmin();
    const panel = await openHistory();
    fireEvent.click(within(panel).getByRole("button", { name: tZh("scheduler.history.clear") }));
    await waitFor(() => expect(schedulerApi.runs).toHaveBeenLastCalledWith({ page: 1 }));
    expect((schedulerApi.runs.mock.lastCall![0] as Record<string, unknown>).status).toBeUndefined();
    expect(within(panel).queryByRole("button", { name: tZh("scheduler.history.clear") })).toBeNull();

    fireEvent.change(within(panel).getByLabelText(tZh("scheduler.history.job")), { target: { value: "ledger.recalculate_tenant" } });
    fireEvent.change(within(panel).getByLabelText(tZh("scheduler.history.tenant")), { target: { value: "2" } });
    fireEvent.change(within(panel).getByLabelText(tZh("scheduler.history.trigger")), { target: { value: "MANUAL" } });
    fireEvent.change(within(panel).getByLabelText(tZh("scheduler.history.queued_from")), { target: { value: "2026-09-01T08:00" } });
    fireEvent.change(within(panel).getByLabelText(tZh("scheduler.history.search")), { target: { value: "  boom " } });
    fireEvent.click(within(panel).getByRole("button", { name: tZh("scheduler.status.SKIPPED") }));
    await waitFor(() =>
      expect(schedulerApi.runs).toHaveBeenLastCalledWith({
        status: "SKIPPED",
        task_name: "ledger.recalculate_tenant",
        tenant: 2,
        trigger: "MANUAL",
        queued_after: new Date("2026-09-01T08:00").toISOString(),
        search: "boom",
        page: 1,
      })
    );
  });

  it("offers the tenant filter to ADMIN only, with the tenants of the visible jobs", async () => {
    asAdmin();
    const panel = await openHistory();
    const select = within(panel).getByLabelText(tZh("scheduler.history.tenant")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual([tZh("scheduler.history.all_tenants"), "CN_DIYU", "EG_DUAT"]);
  });

  it("a tenant-scoped reader gets no tenant filter", async () => {
    asRole("scheduler.read");
    const panel = await openHistory();
    expect(within(panel).queryByLabelText(tZh("scheduler.history.tenant"))).toBeNull();
    expect(within(panel).getByLabelText(tZh("scheduler.history.job"))).toBeInTheDocument();
  });

  it("refetches when the scheduler keys are invalidated — what the realtime handler does", async () => {
    asAdmin();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await openHistory(client);
    await waitFor(() => expect(schedulerApi.runs).toHaveBeenCalled());
    const before = schedulerApi.runs.mock.calls.length;
    const { schedulerKeys } = jest.requireActual("@soulledger/core/query_keys") as typeof import("@soulledger/core/query_keys");
    await act(() => client.invalidateQueries({ queryKey: schedulerKeys.all }));
    await waitFor(() => expect(schedulerApi.runs.mock.calls.length).toBeGreaterThan(before));
  });
});

describe("a realtime failure toasts once, and nothing else toasts", () => {
  const frame = (over: Record<string, unknown>) => ({
    domain: "scheduler",
    event: "SCHEDULER_RUN_UPDATED",
    job_id: 1,
    run_id: 50,
    task_name: "ledger.recalculate_tenant",
    ...over,
  });
  const push = (event: Record<string, unknown>) => act(() => mockListeners.forEach((listener) => listener(event)));

  async function openPage() {
    asAdmin();
    const view = renderPage();
    await screen.findAllByText(tZh("scheduler.jobs.ledger_recalculate_tenant"));
    mockShowToast.mockClear();
    return view;
  }

  it.each([
    ["FAILURE", "scheduler.realtime.run_failed"],
    ["LOST", "scheduler.realtime.run_lost"],
  ])("%s → one error toast naming the job", async (status, key) => {
    await openPage();
    push(frame({ status }));
    // `zh` throws on a key the bundle lacks, so this also pins the copy exists.
    const job = zh("scheduler.jobs.ledger_recalculate_tenant");
    expect(mockShowToast.mock.calls).toEqual([[zh(key, { job }), "error"]]);
  });

  it("names a run whose job is not on screen by its task name", async () => {
    await openPage();
    push(frame({ status: "FAILURE", job_id: 404, task_name: "some.unknown_task" }));
    expect(mockShowToast.mock.calls).toEqual([[zh("scheduler.realtime.run_failed", { job: "some.unknown_task" }), "error"]]);
  });

  it("toasts nothing for any other status, for the SCHEDULER_RUN_FAILED twin, or for other domains", async () => {
    await openPage();
    for (const status of ["PENDING", "RUNNING", "RETRY", "SKIPPED", "SUCCESS"]) push(frame({ status }));
    push(frame({ event: "SCHEDULER_RUN_FAILED", status: "FAILURE" }));
    push(frame({ domain: "dispatch", status: "FAILURE" }));
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("stops listening when the page goes away", async () => {
    const { unmount } = await openPage();
    expect(mockListeners.size).toBeGreaterThan(0);
    unmount();
    expect(mockListeners.size).toBe(0);
  });
});

describe("the bundles cover every job the backend registers", () => {
  it("has a description for each JobSpec in backend/apps/scheduler/registry.py, in all three locales", () => {
    // The backend derives description_key as "scheduler.jobs." + key with dots
    // flattened (JobSpec.description_key). Derived from the registry, not from
    // a list here, so a ninth job turns this red until it has copy.
    const source = readFileSync(path.join(__dirname, "..", "..", "..", "backend", "apps", "scheduler", "registry.py"), "utf8");
    const keys = [...source.matchAll(/JobSpec\(\s*"([\w.]+)"/g)].map((m) => m[1].replace(/\./g, "_"));
    expect(keys.length).toBeGreaterThanOrEqual(8);
    for (const [locale, bundle] of [["zh-Hans", zhHans], ["en", en], ["egy", egy]] as const) {
      const jobs = (bundle as { scheduler: { jobs: Record<string, string> } }).scheduler.jobs;
      expect({ locale, missing: keys.filter((k) => !jobs[k]) }).toEqual({ locale, missing: [] });
    }
  });
});
