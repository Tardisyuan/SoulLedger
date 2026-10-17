/**
 * 通知点进哪一页(审计 1017 #5)。两半:
 *
 * 1. 覆盖:`backend/apps` 里每一处 `related_resource="…"`(含 `"A" if x else "B"` 的两边)要么在
 *    `NAVIGABLE` 里、要么在 `NOT_NAVIGABLE` 里写了为什么不跳;两张表里也不许有后端已经不发的值。
 *    后端新加一类通知而 Web 没跟上,这里红,而不是又多一类点不动的通知。
 * 2. 映射本身:几类代表的 href,以及受刑计划「点了再取灵魂」的那一种。
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NAVIGABLE, NOT_NAVIGABLE, NotificationTargetLink, notificationTarget } from "@/src/components/notifications/NotificationTarget";
import { sentencePlansApi } from "@soulledger/core/api/sentence-plans";

jest.mock("@soulledger/core/api/sentence-plans", () => ({ sentencePlansApi: { get: jest.fn() } }));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));
const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockShowToast }) }));
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const APPS = path.resolve(__dirname, "..", "..", "..", "backend", "apps");

function pyFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "migrations" || entry.name === "tests" || entry.name === "__pycache__") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pyFiles(full, out);
    else if (entry.name.endsWith(".py") && !entry.name.startsWith("test_")) out.push(full);
  }
  return out;
}

const ASSIGNMENT = /related_resource\s*=\s*"([^"]+)"(?:\s+if\s+[^,)]+?\s+else\s+"([^"]+)")?/g;

function emitted(): Map<string, string> {
  const where = new Map<string, string>();
  for (const file of pyFiles(APPS)) {
    for (const m of readFileSync(file, "utf8").matchAll(ASSIGNMENT)) {
      for (const value of [m[1], m[2]]) {
        if (value && !where.has(value)) where.set(value, path.relative(APPS, file));
      }
    }
  }
  return where;
}

const EMITTED = emitted();

describe("every related_resource the backend writes is decided here", () => {
  it("found the backend's emitters (the scan is looking at something)", () => {
    // Values seen on 2026-10-17; a regex that silently stopped matching would make the next two vacuous.
    for (const v of ["workflow", "CrossTenantJudgment", "SentencePlan", "soul_inbox", "DispatchRecord", "soul"]) {
      expect(EMITTED.has(v)).toBe(true);
    }
  });

  it("maps each one, or says why it does not", () => {
    const undecided = [...EMITTED.keys()].filter((v) => !(v in NAVIGABLE) && !(v in NOT_NAVIGABLE));
    expect(undecided.map((v) => `${v} (${EMITTED.get(v)})`)).toEqual([]);
  });

  it("lists nothing the backend no longer writes, and nothing in both tables", () => {
    const listed = [...Object.keys(NAVIGABLE), ...Object.keys(NOT_NAVIGABLE)];
    expect(listed.filter((v) => !EMITTED.has(v))).toEqual([]);
    expect(Object.keys(NAVIGABLE).filter((v) => v in NOT_NAVIGABLE)).toEqual([]);
  });
});

describe("notificationTarget", () => {
  const href = (related_resource: string, related_id: string | null, notification_type = "SYSTEM") => {
    const target = notificationTarget({ related_resource, related_id, notification_type });
    return target?.kind === "href" ? target.href : target;
  };

  it("sends each kind to its page", () => {
    expect(href("workflow", "w1", "WORKFLOW_ASSIGNED")).toBe("/workflow/w1");
    expect(href("CrossTenantJudgment", "x1", "CROSS_JUDGMENT_INVITED")).toBe("/cross-judgments/x1");
    expect(href("judgment", "j1", "JUDGMENT_COMPLETED")).toBe("/judgment/j1");
    expect(href("DispatchRecord", "d1", "DISPATCH_RETURN_BLOCKED")).toBe("/dispatch/d1");
    expect(href("soul", "s1")).toBe("/souls/s1");
    expect(href("soul_inbox", "c1", "SOUL_INBOX_ASSIGNED")).toBe("/soul-inbox?c=c1");
    expect(href("death_sync", "r1")).toBe("/death-sync");
    expect(href("scheduler", "7")).toBe("/scheduler");
    expect(href("assistant_config", null)).toBe("/admin/assistant");
    expect(href("SentencePlan", "p1", "SENTENCE_REQUEST_PENDING")).toBe("/sentence-requests");
    expect(notificationTarget({ related_resource: "SentencePlan", related_id: "p1", notification_type: "SENTENCE_NODE_ACTIVE" }))
      .toEqual({ kind: "sentence_plan", planId: "p1", label: "notifications.open_sentence_plan" });
  });

  it("gives no target without an id where the page needs one, for a non-dispatch DispatchRecord, or for the soul-only kinds", () => {
    expect(href("workflow", null)).toBeNull();
    expect(href("CrossTenantJudgment", "")).toBeNull();
    expect(href("DispatchRecord", "d1", "SYSTEM")).toBeNull();
    expect(href("rebirth_application", "a1")).toBeNull();
    expect(href("user", "u1", "PASSWORD_HELP_REQUESTED")).toBeNull();
    expect(notificationTarget({ related_resource: null, related_id: null })).toBeNull();
  });
});

describe("NotificationTargetLink", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders a plain link for a page target", () => {
    render(<NotificationTargetLink notification={{ related_resource: "workflow", related_id: "w1", notification_type: "WORKFLOW_ASSIGNED" }} />);
    expect(screen.getByRole("link", { name: "notifications.open_workflow" })).toHaveAttribute("href", "/workflow/w1");
  });

  it("renders nothing when there is nowhere to go", () => {
    const { container } = render(<NotificationTargetLink notification={{ related_resource: "user", related_id: "1" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("a sentence-plan notification fetches the plan on click and goes to its soul", async () => {
    (sentencePlansApi.get as jest.Mock).mockResolvedValue({ data: { id: "p1", soul: "s9" } });
    render(<NotificationTargetLink notification={{ related_resource: "SentencePlan", related_id: "p1", notification_type: "SENTENCE_NODE_DONE" }} />);
    expect(sentencePlansApi.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "notifications.open_sentence_plan" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/souls/s9"));
    expect(sentencePlansApi.get).toHaveBeenCalledWith("p1");
  });

  it("says it cannot open the plan instead of navigating when the plan is gone", async () => {
    (sentencePlansApi.get as jest.Mock).mockRejectedValue(new Error("404"));
    render(<NotificationTargetLink notification={{ related_resource: "SentencePlan", related_id: "p1", notification_type: "SENTENCE_NODE_DONE" }} />);
    fireEvent.click(screen.getByRole("button", { name: "notifications.open_sentence_plan" }));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("notifications.open_failed", "error"));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
