/**
 * Business AI points 1, 2 and 4 (docs/audit/2026-11-12-portfolio-ai-ideas.md part two):
 * - `StatuteSuggestions`: nothing is cited until the judge ticks; only the ticked ones go through `onCite`;
 * - `VerdictDraftPanel`: no draft before a verdict is chosen; the draft goes into the text box only on "insert",
 *   and the deterministic check failures are shown;
 * - `ModerationPreScreen`: scores only reorder, never drop a row; an injection-flagged row stays on top;
 * - `frontend/demo/aiReplay.ts`: the demo answers only what was recorded.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StatuteSuggestions } from "@/src/components/ai/StatuteSuggestions";
import { VerdictDraftPanel } from "@/src/components/ai/VerdictDraftPanel";
import { AiScoreTag, byRiskOrder } from "@/src/components/ai/ModerationPreScreen";
import { aiWrite } from "@/demo/aiReplay";
import { judgmentAiApi } from "@soulledger/core/api/ai-business";
import { officerAssistApi } from "@soulledger/core/api/officer-assist";
import type { Recording } from "@/demo/store";

jest.mock("@soulledger/core/api/ai-business", () => ({
  judgmentAiApi: { statuteSuggestions: jest.fn(), verdictDraft: jest.fn() },
  moderationAiApi: { screen: jest.fn() },
}));
jest.mock("@soulledger/core/api/officer-assist", () => ({
  officerAssistApi: { decideDraft: jest.fn().mockResolvedValue({}) },
}));
jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ params: "paren" }));

const suggestion = (code: string, statute: string) => ({ statute, code, title: `t-${code}`, text: `text-${code}`, why: `why-${code}`, source: "model" as const });

describe("StatuteSuggestions", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cites only what the judge ticks, then reports the choice", async () => {
    (judgmentAiApi.statuteSuggestions as jest.Mock).mockResolvedValue({
      suggestions: [suggestion("CN-1", "s1"), suggestion("CN-2", "s2")], dropped: ["EU-9"], draft_id: 7, model: "m", fallback: false,
    });
    const onCite = jest.fn().mockResolvedValue({});
    render(<StatuteSuggestions judgmentId="j1" canCite cited={[]} onCite={onCite} />);
    fireEvent.click(screen.getByText("ai_assist.statutes.ask"));
    expect(await screen.findByTestId("ai-statute-CN-1")).toHaveTextContent("text-CN-1");
    expect(screen.getByTestId("ai-statute-CN-1")).toHaveTextContent("why-CN-1");
    expect(screen.getByTestId("ai-statute-cite")).toBeDisabled();
    expect(onCite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ai-statute-CN-2").querySelector("input")!);
    fireEvent.click(screen.getByTestId("ai-statute-cite"));
    await waitFor(() => expect(onCite).toHaveBeenCalledTimes(1));
    expect(onCite).toHaveBeenCalledWith("s2");
    expect(officerAssistApi.decideDraft).toHaveBeenCalledWith(7, true, JSON.stringify(["CN-2"]));
  });

  it("shows nothing to someone who may not cite", () => {
    const { container } = render(<StatuteSuggestions judgmentId="j1" canCite={false} cited={[]} onCite={jest.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says when the list is keyword matches only", async () => {
    (judgmentAiApi.statuteSuggestions as jest.Mock).mockResolvedValue({
      suggestions: [{ ...suggestion("CN-1", "s1"), why: "", source: "keyword" }], dropped: [], draft_id: null, model: "", fallback: true,
    });
    render(<StatuteSuggestions judgmentId="j1" canCite cited={[]} onCite={jest.fn()} />);
    fireEvent.click(screen.getByText("ai_assist.statutes.ask"));
    expect(await screen.findByTestId("ai-statute-fallback")).toBeInTheDocument();
  });
});

describe("VerdictDraftPanel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cannot draft before a verdict is chosen", () => {
    render(<VerdictDraftPanel judgmentId="j1" verdict="" currentText="" onInsert={jest.fn()} />);
    expect(screen.getByText("ai_assist.verdict.ask").closest("button")).toBeDisabled();
    expect(screen.getByText("ai_assist.verdict.need_verdict")).toBeInTheDocument();
  });

  it("previews with the check failures and inserts only when asked", async () => {
    (judgmentAiApi.verdictDraft as jest.Mock).mockResolvedValue({
      text: "依 CN-9,判:无罪。", draft_id: 3, model: "m", fallback: false,
      checks: { unknown_codes: ["CN-9"], contrary_verdict_words: ["无罪"], names_soul: false },
    });
    const onInsert = jest.fn();
    const { unmount } = render(<VerdictDraftPanel judgmentId="j1" verdict="FAILED" currentText="" onInsert={onInsert} />);
    fireEvent.click(screen.getByText("ai_assist.verdict.ask"));
    expect(await screen.findByTestId("ai-verdict-text")).toHaveTextContent("依 CN-9,判:无罪。");
    expect(judgmentAiApi.verdictDraft).toHaveBeenCalledWith("j1", "FAILED");
    expect(screen.getByTestId("ai-verdict-problems").textContent).toContain("ai_assist.verdict.check_unknown");
    expect(onInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("ai-verdict-insert"));
    expect(onInsert).toHaveBeenCalledWith("依 CN-9,判:无罪。");
    expect(officerAssistApi.decideDraft).not.toHaveBeenCalled();
    unmount();
    expect(officerAssistApi.decideDraft).toHaveBeenCalledWith(3, true, "");
  });
});

describe("moderation pre-screen", () => {
  it("reorders without dropping anything", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const score: Record<string, number> = { b: 90, c: 10 };
    expect(byRiskOrder(rows, (r) => score[r.id]).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("explains a rule-only score in words", () => {
    render(<AiScoreTag score={{ id: "a", score: 70, reason: "", signals: ["injection_phrase"], source: "rule" }} />);
    expect(screen.getByTestId("ai-score").textContent).toContain("ai_assist.screen.signals.injection_phrase");
  });
});

describe("demo replay", () => {
  const rec = {
    docs: {
      "/judgment/j1/statute-suggestions/": { s: 200, b: { suggestions: [] } },
      "/judgment/j1/verdict-draft/?verdict=FAILED": { s: 200, b: { text: "recorded" } },
      "/social-moderation/posts/ai-screen/": { s: 200, b: { items: [] } },
    },
    lists: {},
  } as unknown as Recording;

  it("answers what was recorded, by verdict, and 503s the rest", () => {
    expect(aiWrite(rec, "POST", "/judgment/j1/statute-suggestions/", {})?.status).toBe(200);
    expect(aiWrite(rec, "POST", "/judgment/j1/verdict-draft/", { verdict: "FAILED" })?.data).toEqual({ text: "recorded" });
    expect(aiWrite(rec, "POST", "/judgment/j1/verdict-draft/", { verdict: "PASSED" })?.status).toBe(503);
    expect(aiWrite(rec, "POST", "/social-moderation/posts/ai-screen/", {})?.status).toBe(200);
    expect(aiWrite(rec, "POST", "/social-moderation/comments/ai-screen/", {})?.status).toBe(503);
  });
});
