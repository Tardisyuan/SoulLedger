/**
 * @jest-environment node
 *
 * The demo's 问一问 recordings (作品集建议 B1 / B2 / B3), written by scripts/demo-record-assist.py.
 *
 * - The 「为什么越不了权」 card names, for each safeguard, the code that does it and the test that holds it. A claim that
 *   something is held needs that test to exist: renamed or deleted, this goes red before a visitor reads a dead name.
 * - A recorded answer carries its trace in both languages, and the runtime hands it out with the answer (B1); a case
 *   with no recording gets no answer at all, so the card can say so instead of showing one.
 * - A recorded eval run, once there, answers the eval tab's three reads (B2).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import security from "../../demo/data/assist-security.json";

/** The card names backend files (code and tests); they are read under here, so a backend-only push runs this too. */
const BACKEND = join(__dirname, "..", "..", "..", "backend");
const inBackend = (rel: string) => join(BACKEND, rel.replace(/^backend\//, ""));

const TRACE = {
  tools_called: ["judgment_queue"], retrieval: "vector", retrieved_entries: ["officer-judgment-queue"], latency_ms: 1900,
  first_token_ms: 700, tokens: { input: 1000, output: 60, cache_read: 800 }, model: "m", provider_role: "primary", fallback_reason: null,
};

jest.mock("../../demo/data/assist-replies.json", () => ({
  recordedAt: "2026-11-13T00:00:00Z",
  replies: [
    { question: { "zh-Hans": "有几件？", en: "How many?" }, answer: { "zh-Hans": "三件。", en: "Three." }, trace: { "zh-Hans": TRACE, en: TRACE } },
    { question: { "zh-Hans": "旧的录制", en: "Old recording" }, answer: { "zh-Hans": "没有过程。", en: "No trace." } },
  ],
}));
jest.mock("../../demo/data/assist-eval-run.json", () => ({
  recordedAt: "2026-11-13T00:00:00Z",
  cases: [{ id: 1, question: "q" }],
  runs: [{ id: 9, status: "done", summary: [], results: [{ id: 1 }] }],
}));

import { fetchAnswer } from "../../demo/runtime";

async function ask(question: string, lang = "zh-Hans") {
  const response = await fetchAnswer("/api/v1/assist/", { method: "POST", body: JSON.stringify({ question }), headers: { "Accept-Language": lang } });
  const events = (await response.text()).trim().split("\n\n").map((block) => JSON.parse(block.replace(/^data: /, "")));
  return events.find((e) => e.event === "done").answer;
}

describe("the 「为什么越不了权」 card", () => {
  it.each(security.guards)("$id: its code exists and its test is defined", ({ code, test }) => {
    expect(existsSync(inBackend(code))).toBe(true);
    const [file, name] = test.split("::");
    expect(readFileSync(inBackend(file), "utf8")).toMatch(new RegExp(`^def ${name}\\(`, "m"));
  });

  it("states each case and what it should do in both languages", () => {
    expect(security.cases.length).toBeGreaterThanOrEqual(2);
    for (const c of security.cases as { question: Record<string, string>; expect: Record<string, string>; answer?: unknown; trace?: unknown }[]) {
      for (const lang of ["zh-Hans", "en"]) {
        expect(c.question[lang]).toBeTruthy();
        expect(c.expect[lang]).toBeTruthy();
      }
      // A recorded answer comes with its trace; an unrecorded case has neither — nothing is made up in between.
      expect(Boolean(c.answer)).toBe(Boolean(c.trace));
    }
  });

  it("an unrecorded case gets no answer from the runtime, only the not-recorded notice", async () => {
    const unrecorded = (security.cases as { question: Record<string, string>; answer?: unknown }[]).find((c) => !c.answer);
    if (!unrecorded) return; // every case recorded: nothing to check here
    const answer = await ask(unrecorded.question["zh-Hans"]);
    expect(answer.content).toContain("这个问题没有录");
    expect(answer.trace).toBeUndefined();
  });
});

describe("recorded answers carry their trace (B1)", () => {
  it("in the done event's answer, in the asker's language", async () => {
    const answer = await ask("How many?", "en");
    expect(answer.content).toContain("Three.");
    expect(answer.trace).toEqual(TRACE);
  });

  it("an answer recorded before traces existed comes without one", async () => {
    const answer = await ask("旧的录制");
    expect(answer.content).toContain("没有过程。");
    expect(answer).not.toHaveProperty("trace");
  });
});

describe("a recorded eval run answers the eval tab (B2)", () => {
  const get = async (path: string) => {
    const response = await fetchAnswer(`/api/v1${path}`);
    return { status: response.status, data: await response.json() };
  };

  it("lists the run without its results, details it with them, and serves the cases it was judged against", async () => {
    expect(await get("/assist-admin/eval/runs/")).toEqual({ status: 200, data: [{ id: 9, status: "done", summary: [] }] });
    expect((await get("/assist-admin/eval/runs/9/")).data.results).toEqual([{ id: 1 }]);
    expect((await get("/assist-admin/eval/runs/8/")).status).toBe(404);
    expect((await get("/assist-admin/eval/cases/")).data).toEqual([{ id: 1, question: "q" }]);
  });
});
