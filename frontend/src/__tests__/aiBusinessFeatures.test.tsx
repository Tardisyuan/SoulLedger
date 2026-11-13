/**
 * The two business AI entries (docs/audit/2026-11-12-portfolio-ai-ideas.md part two, points 6 and 7):
 * - `PermissionWhy` on the 403 card: always the lexicon sentence for the computed reason (the model-free fallback),
 *   the model's wording only beside it and labelled; the codename never reaches the page;
 * - `AuditAskBox`: the model's filters are a proposal; nothing is applied until the person confirms, a removed chip
 *   stays removed, and a 503 leaves the manual filters as they were;
 * - `frontend/demo/aiReplay.ts`: the demo answers only what was recorded, exactly.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PermissionWhy } from "@/src/components/rbac/PermissionWhy";
import { AuditAskBox } from "@/src/components/audit/AuditAskBox";
import { aiRead, aiWrite } from "@/demo/aiReplay";
import { auditApi, permApi } from "@soulledger/core/api";
import { officerAssistApi } from "@soulledger/core/api/officer-assist";
import type { Recording } from "@/demo/store";

jest.mock("@soulledger/core/api", () => ({
  permApi: { explain: jest.fn() },
  auditApi: { nlFilter: jest.fn() },
}));
jest.mock("@soulledger/core/api/officer-assist", () => ({
  officerAssistApi: { decideDraft: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@/src/contexts/I18nContext", () =>
  require("./support/mocks").i18nMock({ params: "paren" }),
);

const explanation = {
  action: "judgment.assign",
  permission_name: "Reassign cases",
  allowed: false,
  reason: "missing_permission",
  role: "JUDGE",
  extra_roles: [],
  roles_that_can: ["ADMIN"],
  object_type: null,
  scope_kinds: [],
  explanation: null as string | null,
};

describe("PermissionWhy", () => {
  beforeEach(() => jest.clearAllMocks());

  it("asks only when clicked, and says the computed reason from the lexicon", async () => {
    (permApi.explain as jest.Mock).mockResolvedValue({ data: explanation });
    render(<PermissionWhy action="judgment.assign" />);
    expect(permApi.explain).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("permission-why"));
    expect(await screen.findByTestId("permission-why-reason")).toHaveTextContent("perm_explain.reason.missing_permission");
    expect(permApi.explain).toHaveBeenCalledWith("judgment.assign", undefined);
    expect(screen.queryByTestId("permission-why-ai")).toBeNull();
    expect(screen.getByTestId("permission-why-answer").textContent).not.toContain("judgment.assign");
  });

  it("puts the model's wording beside the lexicon sentence, labelled as AI", async () => {
    (permApi.explain as jest.Mock).mockResolvedValue({ data: { ...explanation, explanation: "Only an administrator reassigns cases." } });
    render(<PermissionWhy action="judgment.assign" />);
    fireEvent.click(screen.getByTestId("permission-why"));
    expect(await screen.findByTestId("permission-why-ai")).toHaveTextContent("Only an administrator reassigns cases.perm_explain.ai_label");
    expect(screen.getByTestId("permission-why-reason")).toHaveTextContent("perm_explain.reason.missing_permission");
  });

  it("says it could not look the reason up when the request fails", async () => {
    (permApi.explain as jest.Mock).mockRejectedValue(new Error("503"));
    render(<PermissionWhy action="judgment.assign" />);
    fireEvent.click(screen.getByTestId("permission-why"));
    expect(await screen.findByTestId("permission-why-failed")).toHaveTextContent("perm_explain.failed");
  });
});

describe("AuditAskBox", () => {
  beforeEach(() => jest.clearAllMocks());

  const ask = (question: string) => {
    fireEvent.change(screen.getByTestId("audit-ask-input"), { target: { value: question } });
    fireEvent.submit(screen.getByTestId("audit-ask-input").closest("form") as HTMLFormElement);
  };

  it("applies nothing until confirmed, and applies what is left after a chip is removed", async () => {
    (auditApi.nlFilter as jest.Mock).mockResolvedValue({
      data: { filters: { action: "DELETE", username: "demo_judge" }, dropped: ["tenant"], understood: true, draft_id: 7, model: "m" },
    });
    const onApply = jest.fn();
    render(<AuditAskBox onApply={onApply} extra={{}} onRemoveExtra={jest.fn()} />);
    ask("demo_judge 删了什么");
    await screen.findByTestId("audit-ask-proposal");
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByTestId("audit-ask-dropped")).toHaveTextContent("tenant");
    fireEvent.click(screen.getByTestId("audit-ask-chip-username"));
    fireEvent.click(screen.getByTestId("audit-ask-apply"));
    expect(onApply).toHaveBeenCalledWith({ action: "DELETE" });
    expect(officerAssistApi.decideDraft).toHaveBeenCalledWith(7, true, '{"action":"DELETE"}');
  });

  it.each([
    ["assistant_not_configured", "audit_ask.not_configured"],
    ["assistant_unavailable", "audit_ask.unavailable"],
    ["assistant_busy", "audit_ask.busy"],
  ])("a %s refusal leaves only a note", async (code, key) => {
    (auditApi.nlFilter as jest.Mock).mockRejectedValue({ response: { status: 503, data: { code } } });
    const onApply = jest.fn();
    render(<AuditAskBox onApply={onApply} extra={{}} onRemoveExtra={jest.fn()} />);
    ask("删除");
    expect(await screen.findByTestId("audit-ask-note")).toHaveTextContent(key);
    expect(screen.queryByTestId("audit-ask-proposal")).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("a reply it could not read is a note, not an empty filter", async () => {
    (auditApi.nlFilter as jest.Mock).mockResolvedValue({ data: { filters: {}, dropped: [], understood: false, draft_id: 1, model: "m" } });
    render(<AuditAskBox onApply={jest.fn()} extra={{}} onRemoveExtra={jest.fn()} />);
    ask("写首诗");
    expect(await screen.findByTestId("audit-ask-note")).toHaveTextContent("audit_ask.not_understood");
  });

  it("keeps the applied date range as removable chips", async () => {
    const onRemoveExtra = jest.fn();
    render(<AuditAskBox onApply={jest.fn()} extra={{ start_date: "2026-11-06" }} onRemoveExtra={onRemoveExtra} />);
    fireEvent.click(screen.getByTestId("audit-ask-chip-start_date"));
    await waitFor(() => expect(onRemoveExtra).toHaveBeenCalledWith("start_date"));
  });
});

describe("demo replay", () => {
  const rec = {
    docs: {
      "/perm/explain/?action=judgment.assign": { s: 200, b: explanation },
      "/audit-logs/nl-filter/?question=所有删除操作": { s: 200, b: { filters: { action: "DELETE" } } },
    },
    lists: {},
  } as unknown as Recording;

  it("answers a recorded explanation exactly, and nothing for another action", () => {
    expect(aiRead(rec, "/perm/explain/", new URLSearchParams({ action: "judgment.assign" }))?.data).toBe(explanation);
    expect(aiRead(rec, "/perm/explain/", new URLSearchParams({ action: "soul.read" }))?.status).toBe(503);
    expect(aiRead(rec, "/souls/", new URLSearchParams())).toBeNull();
  });

  it("answers a recorded question, and names the recorded ones otherwise", () => {
    expect(aiWrite(rec, "POST", "/audit-logs/nl-filter/", { question: "所有删除操作" })?.data).toEqual({ filters: { action: "DELETE" } });
    const other = aiWrite(rec, "POST", "/audit-logs/nl-filter/", { question: "别的" });
    expect(other?.status).toBe(503);
    expect(other?.data).toMatchObject({ code: "demo_not_recorded", examples: ["所有删除操作"] });
    expect(aiWrite(rec, "POST", "/assist/ai-drafts/3/decide/", { adopted: true })?.data).toMatchObject({ id: 3, status: "adopted" });
  });
});
