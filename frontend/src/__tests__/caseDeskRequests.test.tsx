/**
 * 案台冷加载一件卷宗的请求数(be-api §1.1:此前 9 个 —— 四个分组列表、queue-counts、hall-stats、案子、灵魂、灵魂的 path)。
 * 现在是两个:`GET /dossiers/desk/` 与 `GET /dossiers/{id}/`。在 HTTP 客户端这一层数,所以哪个 hook 偷偷多发一个都会红;
 * 外壳(AppLayout 的未读数、菜单)不在这棵树里,不计。
 */
import { screen, waitFor } from "@testing-library/react";
import { api } from "@soulledger/core/api/client";
import { CaseDesk } from "@/src/components/desk/CaseDesk";
import { renderWithProviders } from "./support/render";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  usePathname: () => "/desk",
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { role: "JUDGE", permissions: ["judgment.read", "judgment.execute", "soul.read"] } }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

const ROW = {
  id: "j-1", case_number: "EU-2026-0001", soul: "s-1", soul_name: "Francesca", civilization: "EUROPEAN", court: "Minos",
  source: "queue", deadline_at: null, is_overdue: false, claimed_by: null, claimed_by_name: null, deferred_at: null, stale_since: null,
  deadline_remaining_seconds: null, retrial_of: null, is_final: false, duat_stage: "", held_until: null, conclude_refusal: "", untimely: false,
};
const DESK = {
  groups: ["mine", "unclaimed", "others", "deferred"].map((group) => ({ group, total: group === "unclaimed" ? 1 : 0, rows: group === "unclaimed" ? [ROW] : [] })),
  counts: { mine: 0, unclaimed: 1, others: 0, deferred: 0, total: 1, overdue: 0, returned: 0, sources: { queue: 1, city_god: 0, cross: 0 }, elsewhere: {} },
  month_done_pct: null,
};
// A non-Chinese hall on purpose: before, it was the one that also fetched `/souls/{id}/path/` (the third tier of the waterfall).
const DOSSIER = {
  id: "j-1", version: 1, phase: "UNCLAIMED", citations: [], soul_redacted: false,
  judgment: { ...ROW, created_at: "2026-11-01T00:00:00Z", confession: "", merit_score: 1, demerit_score: 2 },
  soul: { id: "s-1", name: "Francesca", current_state: "JUDGING", diyu_station: "", is_residing: false, records: [] },
  whereabouts: { hall: "EU_INFERNO", residing: false, realm_code: "EU_HELL_2ND", since: null, spine: { civ: "eu", at: "circle", n: 2 } },
  actions: { claim: true, release: false, conclude: false, refusals: {} },
};

it("a cold open of one dossier costs two requests: the desk and the dossier", async () => {
  const get = jest.spyOn(api, "get").mockImplementation((url: string) => {
    if (url === "/dossiers/desk/") return Promise.resolve({ data: DESK } as never);
    if (url === "/dossiers/j-1/") return Promise.resolve({ data: DOSSIER } as never);
    return Promise.resolve({ data: { count: 0, next: null, previous: null, results: [] } } as never);
  });
  renderWithProviders(<CaseDesk />);
  await screen.findByTestId("desk-row-j-1");
  await waitFor(() => expect(screen.getByTestId("desk-spine")).toHaveAttribute("data-now", JSON.stringify({ civ: "eu", at: "circle", n: 2 })));
  const urls = get.mock.calls.map(([url]) => url);
  expect(urls.filter((u) => u === "/dossiers/desk/")).toHaveLength(1);
  expect(urls.filter((u) => u === "/dossiers/j-1/")).toHaveLength(1);
  expect(urls).toHaveLength(2);
  // Absence: none of the nine the desk used to send.
  expect(urls.some((u) => /^\/judgment\/|^\/souls\//.test(u))).toBe(false);
  get.mockRestore();
});
