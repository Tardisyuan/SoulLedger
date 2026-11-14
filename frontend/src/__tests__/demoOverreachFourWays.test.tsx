/**
 * 「越权四连」(be-sec 3.10 第 3 站): four cards, each its own button and its own live region, each replaying what the
 * recorder was answered. 404 (the other hall's soul) is drawn muted, «correctly saying nothing»; 403 and 401 are red.
 * A recording without the answer says so; a recording whose answer is no longer the refusal says that, not a badge.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import zh from "@soulledger/core/messages/zh-Hans.json";

import { I18nProvider } from "@/src/contexts/I18nContext";
import { OverreachProbe, PROBES } from "@/demo/OverreachProbe";
import type { OverreachRecording, Recording } from "@/demo/store";

const tZh = (key: string) => {
  let cur: unknown = zh;
  for (const seg of key.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[seg];
  return String(cur);
};

const EU_ID = "e0000000-0000-4000-8000-000000000001";
const rec = (role: Recording["role"], lists: Recording["lists"], docs: Recording["docs"]): Recording =>
  ({ role, lang: "zh", recordedAt: "2026-11-14T00:00:00Z", login: { user: {} }, lists, docs }) as Recording;
const mockRecs: Record<string, Recording> = {};
let mockOverreach: OverreachRecording | null = null;

jest.mock("@/demo/store", () => ({
  ...jest.requireActual("@/demo/store"),
  recording: (role: string) => Promise.resolve(mockRecs[role]),
  overreachRecording: () => Promise.resolve(mockOverreach),
}));

function setRecordings(over: { lateral?: number; vertical?: number } = {}) {
  mockRecs.judge = rec("judge", { "/souls/": { rows: [{ id: "c0000000-0000-4000-8000-000000000001", name: "屈原" }], extra: {} } }, {
    [`/souls/${EU_ID}/`]: { s: over.lateral ?? 404, b: { status: 404, code: "not_found", detail: "未找到。" } },
    "/perm/permissions/": { s: over.vertical ?? 403, b: { detail: "您没有执行该操作的权限。" } },
  });
  mockRecs.judge_eu = rec("judge_eu", { "/souls/": { rows: [{ id: EU_ID, name: "Dante" }], extra: {} } }, {});
  mockOverreach = {
    recordedAt: "2026-11-14T00:00:00Z",
    answers: {
      door: { path: "/souls/", s: 403, b: { status: 403, detail: "灵魂账号不能访问官员接口。" } },
      anon: { path: "/souls/", s: 401, b: { status: 401, detail: "身份认证信息未提供。" } },
    },
  };
}

async function press(kind: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`demo-overreach-try-${kind}`));
  });
}

const renderProbe = () => render(<I18nProvider><OverreachProbe /></I18nProvider>);

beforeEach(() => setRecordings());

it("stacks four cards in the order lateral, vertical, wrong door, anonymous, each with its own live region", () => {
  renderProbe();
  const cards = [...document.querySelectorAll("[data-probe]")].map((el) => el.getAttribute("data-probe"));
  expect(cards).toEqual(["lateral", "vertical", "door", "anon"]);
  expect(PROBES.map((p) => p.expect)).toEqual([404, 403, 403, 401]);
  for (const kind of cards) expect(screen.getByTestId(`demo-overreach-answer-${kind}`)).toHaveAttribute("role", "status");
  // The request is on the button before it is pressed: method, path, who asks.
  expect(screen.getByTestId("demo-overreach-try-lateral")).toHaveTextContent("GET /api/v1/souls/");
  expect(screen.getByTestId("demo-overreach-try-lateral")).toHaveTextContent("demo_judge (CN)");
  expect(screen.getByTestId("demo-overreach-try-door")).toHaveTextContent(tZh("demo.probe.door.who"));
  expect(screen.getByTestId("demo-overreach-try-anon")).toHaveTextContent(tZh("demo.probe.anon.who"));
});

it("pressing one card answers that card only", async () => {
  renderProbe();
  await press("door");
  expect(screen.getByTestId("demo-overreach-status-door")).toHaveTextContent("403");
  expect(screen.getByTestId("demo-overreach-answer-door")).toHaveTextContent("OfficerJWTAuthentication");
  expect(screen.getByTestId("demo-overreach-answer-door")).toHaveTextContent("test_soul_auth_boundary.py");
  for (const kind of ["lateral", "vertical", "anon"]) expect(screen.getByTestId(`demo-overreach-answer-${kind}`)).toBeEmptyDOMElement();
});

it("404 is muted and says it is saying nothing; 403 and 401 are red", async () => {
  renderProbe();
  for (const kind of ["lateral", "vertical", "door", "anon"]) await press(kind);
  const lateral = screen.getByTestId("demo-overreach-status-lateral");
  expect(lateral).toHaveTextContent("404");
  expect(lateral).toHaveAttribute("data-tone", "muted");
  expect(lateral.className).toContain("color-ink-muted");
  expect(lateral.className).not.toContain("color-danger");
  expect(screen.getByTestId("demo-overreach-answer-lateral")).toHaveTextContent(tZh("demo.probe.lateral.quiet"));
  expect(screen.getByTestId("demo-overreach-answer-lateral")).toHaveTextContent(`GET /api/v1/souls/${EU_ID}/`);
  for (const [kind, status] of [["vertical", "403"], ["door", "403"], ["anon", "401"]]) {
    const badge = screen.getByTestId(`demo-overreach-status-${kind}`);
    expect(badge).toHaveTextContent(status);
    expect(badge).toHaveAttribute("data-tone", "danger");
    expect(badge.className).toContain("color-danger");
    expect(screen.getByTestId(`demo-overreach-answer-${kind}`)).not.toHaveTextContent(tZh("demo.probe.lateral.quiet"));
  }
  expect(screen.getByTestId("demo-overreach-answer-vertical")).toHaveTextContent("CanReadPermissionCatalogue");
  expect(screen.getByTestId("demo-overreach-answer-anon")).toHaveTextContent("TenantPermission");
});

it("a recording that no longer holds the refusal says so instead of drawing a badge", async () => {
  setRecordings({ lateral: 200 });
  renderProbe();
  await press("lateral");
  expect(screen.queryByTestId("demo-overreach-status-lateral")).toBeNull();
  expect(screen.getByTestId("demo-overreach-answer-lateral")).toHaveTextContent("200");
});

it("without the overreach file the two soul-and-anonymous cards say they are not recorded yet", async () => {
  mockOverreach = null;
  renderProbe();
  await press("door");
  await press("anon");
  expect(screen.queryByTestId("demo-overreach-status-door")).toBeNull();
  expect(screen.getByTestId("demo-overreach-answer-door")).toHaveTextContent(tZh("demo.probe.pending"));
  expect(screen.getByTestId("demo-overreach-answer-anon")).toHaveTextContent(tZh("demo.probe.pending"));
});
