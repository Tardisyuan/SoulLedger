/**
 * 走完导览,访客自己撞一次租户隔离(2026-11-14 用户定,叙事传输):结束卡上的「试着打开别的殿的案卷」就是现成的横向探针
 * (`OverreachProbe` 的 lateral:中国殿的判官要欧洲殿的灵魂),按下即问,答的是录下的 404。四殿与「系统怎么保护自己」都有;
 * 只出横向那一张,不是四连。HowBuilt 底部的联系方式按语言链到两份 README。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";

import { I18nProvider } from "@/src/contexts/I18nContext";
import DemoTour from "@/demo/DemoTour";
import { TOUR_KEY } from "@/demo/DemoEntrances";
import type { Tour } from "@/demo/tour";
import type { Recording } from "@/demo/store";
import { HowBuilt } from "@/src/components/landing/Landing";

const EU_ID = "e0000000-0000-4000-8000-000000000001";
const rec = (role: Recording["role"], lists: Recording["lists"], docs: Recording["docs"]): Recording =>
  ({ role, lang: "zh", recordedAt: "2026-11-14T00:00:00Z", login: { user: {} }, lists, docs }) as Recording;
const mockRecs: Record<string, Recording> = {
  judge: rec("judge", { "/souls/": { rows: [{ id: "c0000000-0000-4000-8000-000000000001", name: "屈原" }], extra: {} } }, {
    [`/souls/${EU_ID}/`]: { s: 404, b: { status: 404, code: "not_found", detail: "未找到。" } },
  }),
  judge_eu: rec("judge_eu", { "/souls/": { rows: [{ id: EU_ID, name: "Dante" }], extra: {} } }, {}),
};

let mockTour: Tour = { skin: "cn", steps: [{ n: 1, target: "soul", route: "/souls" }] };
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ usePathname: () => "/souls", useRouter: () => ({ push: mockPush }) }));
jest.mock("@soulledger/core/api/client", () => ({ api: { get: () => Promise.resolve({ data: mockTour }) } }));
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: { username: "demo_judge" }, setUser: jest.fn() }) }));
jest.mock("@/src/hooks/useWideViewport", () => ({ useWideViewport: () => true }));
jest.mock("@/demo/DemoEntrances", () => ({
  ...jest.requireActual("@/demo/DemoEntrances"),
  useEnter: () => ({ enter: jest.fn(), warm: jest.fn() }),
}));
jest.mock("@/demo/store", () => ({
  ...jest.requireActual("@/demo/store"),
  recording: (role: string) => Promise.resolve(mockRecs[role]),
  overreachRecording: () => Promise.resolve(null),
}));

async function finished(skin: string, extra: object = {}) {
  mockTour = { skin, steps: [{ n: 1, target: "soul", route: "/souls" }] };
  sessionStorage.setItem(TOUR_KEY, JSON.stringify({ step: 0, finished: true, ...extra }));
  const view = render(<I18nProvider><DemoTour /></I18nProvider>);
  await act(async () => {});
  return view;
}

const click = (id: string) => act(async () => void fireEvent.click(screen.getByTestId(id)));

beforeEach(() => sessionStorage.clear());

it.each(["cn", "eu", "eg", "gr", "guard"])("%s: the end card's button asks the lateral probe at once and shows the recorded 404", async (skin) => {
  await finished(skin);
  const button = screen.getByTestId("demo-tour-try-overreach");
  expect(button).toHaveTextContent(zh.demo.tour.try_overreach);
  expect(screen.queryByTestId("demo-overreach")).toBeNull();

  await click("demo-tour-try-overreach");
  expect(screen.queryByTestId("demo-tour-try-overreach")).toBeNull();
  const status = screen.getByTestId("demo-overreach-status-lateral");
  expect(status).toHaveTextContent("404");
  expect(screen.getByTestId("demo-overreach-answer-lateral")).toHaveTextContent(`GET /api/v1/souls/${EU_ID}/`);
  // One card, not the four: the vertical, wrong-door and anonymous probes stay on the safeguards tour's step.
  expect([...document.querySelectorAll("[data-probe]")].map((el) => el.getAttribute("data-probe"))).toEqual(["lateral"]);
});

it("重看导览 brings the button back", async () => {
  await finished("cn");
  await click("demo-tour-try-overreach");
  await click("demo-tour-replay");
  await click("demo-tour-next");
  expect(screen.getByTestId("demo-tour-try-overreach")).toBeInTheDocument();
  expect(screen.queryByTestId("demo-overreach")).toBeNull();
});

it("the tour's own steps do not carry it", async () => {
  mockTour = { skin: "cn", steps: [{ n: 1, target: "soul", route: "/souls" }] };
  sessionStorage.setItem(TOUR_KEY, JSON.stringify({ step: 0 }));
  render(<I18nProvider><DemoTour /></I18nProvider>);
  await act(async () => {});
  expect(screen.getByTestId("demo-tour")).not.toHaveAttribute("data-finished");
  expect(screen.queryByTestId("demo-tour-try-overreach")).toBeNull();
});

it.each([
  ["zh-Hans", "https://github.com/Tardisyuan/SoulLedger/blob/main/README.zh-CN.md#联系", zh.demo.build.contact],
  ["en", "https://github.com/Tardisyuan/SoulLedger#contact", en.demo.build.contact],
] as const)("HowBuilt (%s) ends with a link to the README's contact section", async (locale, href, text) => {
  render(<I18nProvider initialLocale={locale}><HowBuilt /></I18nProvider>);
  const link = screen.getByTestId("how-built-contact");
  expect(link).toHaveAttribute("href", href);
  // A non-Chinese pack loads after the first render.
  await waitFor(() => expect(link).toHaveTextContent(text));
});
