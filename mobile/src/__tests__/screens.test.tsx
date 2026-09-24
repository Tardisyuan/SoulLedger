import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { ApplicationDetailScreen, ApplicationsScreen } from "../screens/applications";
import { PastLivesSection } from "../screens/life";
import { application, life, stubApi } from "./stubApi";

const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

function wrap(children: ReactNode) {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <NavigationContainer>{children}</NavigationContainer>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => {
  installMobilePlatform();
  mockNavigate.mockReset();
});

describe("past lives", () => {
  it("renders a past application with NO action at all — not even when the payload says it could be appealed", async () => {
    const calls = stubApi({
      "/me/past-lives/": {
        status: 200,
        data: [
          life(0, {
            rebirth_applications: [application({ cycle: 0, status: "REJECTED", can_appeal: true, rejection_reason: "x" })],
            reincarnation: { cycle_count: 1, rebirth_form: "HUMAN", target_realm: "", reincarnated_at: "2026-01-01T00:00:00Z" },
          }),
        ],
      },
    });
    wrap(<PastLivesSection lex="cn" reloadKey={0} />);
    fireEvent.press(screen.getByTestId("section-past_lives-toggle"));
    await screen.findByTestId("past-life-0");
    fireEvent.press(screen.getByTestId("past-life-0-toggle"));
    expect(screen.getByText("已驳回")).toBeTruthy();
    // The only buttons are the disclosures that opened the section and this life —
    // they show or hide the record and do nothing to it.
    expect(screen.queryAllByRole("button").map((b) => b.props.testID)).toEqual(["section-past_lives-toggle", "past-life-0-toggle"]);
    expect(screen.getByTestId("past-life-0-toggle").props.accessibilityState).toMatchObject({ expanded: true });
    expect(screen.queryByText("申诉")).toBeNull();
    expect(screen.queryByText("提交申请")).toBeNull();
    expect(calls.every((c) => c.method === "GET")).toBe(true);
  });
});

describe("applying", () => {
  it("cooling-off: the apply button is disabled, the reason and the end date are shown", async () => {
    stubApi({
      "/me/rebirth-applications/": {
        status: 200,
        data: { can_apply: false, reason: "cooldown", cooldown_until: "2026-10-17T00:00:00Z", results: [] },
      },
    });
    wrap(<ApplicationsScreen />);
    const apply = await screen.findByTestId("apply");
    expect(apply.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(apply);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("eligibility-reason").props.children).toBe("驳回后的冷却期内不能重新申请");
    expect(screen.getByText(/^冷却期至 /)).toBeTruthy();
  });

  it.each(["application_open", "terminal_cosmology", "soul_state", "application_approved"])(
    "can_apply=false (%s) also disables it",
    async (reason) => {
      stubApi({ "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason, cooldown_until: null, results: [] } } });
      wrap(<ApplicationsScreen />);
      expect((await screen.findByTestId("apply")).props.accessibilityState.disabled).toBe(true);
    }
  );

  it("can_apply=true enables it and opens the form", async () => {
    stubApi({ "/me/rebirth-applications/": { status: 200, data: { can_apply: true, reason: null, cooldown_until: null, results: [] } } });
    wrap(<ApplicationsScreen />);
    const apply = await screen.findByTestId("apply");
    expect(apply.props.accessibilityState.disabled).toBe(false);
    fireEvent.press(apply);
    expect(mockNavigate).toHaveBeenCalledWith("NewApplication");
  });

  it("an unknown reason code is shown with its raw value, not dropped", async () => {
    stubApi({ "/me/rebirth-applications/": { status: 200, data: { can_apply: false, reason: "brand_new_rule", cooldown_until: null, results: [] } } });
    wrap(<ApplicationsScreen />);
    expect((await screen.findByTestId("eligibility-reason")).props.children).toBe("出错了(brand_new_rule)");
  });
});

describe("application detail", () => {
  it("shows the current step by ROLE, and an unknown status as unrecognized + raw", async () => {
    stubApi({ "/me/rebirth-applications/a1/": { status: 200, data: application({ status: "ON_HOLD" }) } });
    wrap(<ApplicationDetailScreen id="a1" />);
    await screen.findByTestId("application-detail");
    expect(screen.getByText("评估")).toBeTruthy();
    expect(screen.getByText("审判者")).toBeTruthy();
    // The unrecognized status is a badge carrying the raw member, not a guess and not a dotted key.
    const badge = screen.getByTestId("status-badge");
    expect(within(badge).getByText("未识别取值")).toBeTruthy();
    expect(within(badge).getByText("ON_HOLD")).toBeTruthy();
    expect(screen.queryByText(/soul_app\.status/)).toBeNull();
    expect(screen.queryByTestId("appeal")).toBeNull();
    // In the badge row the pill must not shrink, or its glyph and label wrap apart (simulator, round 3).
    expect(StyleSheet.flatten(screen.getByTestId("status-badge-slot").props.style)).toMatchObject({ flexShrink: 0 });
  });

  it("offers the appeal only when can_appeal, and shows the rejection reason", async () => {
    const calls = stubApi({
      "GET /me/rebirth-applications/a1/": [
        { status: 200, data: application({ status: "REJECTED", can_appeal: true, rejection_reason: "业报未清", current_step: null }) },
        { status: 200, data: application({ status: "APPEALING", can_appeal: false }) },
      ],
      "POST /me/rebirth-applications/a1/appeal/": { status: 200, data: application({ status: "APPEALING" }) },
    });
    wrap(<ApplicationDetailScreen id="a1" />);
    expect(await screen.findByText("业报未清")).toBeTruthy();
    fireEvent.changeText(screen.getByTestId("appeal-statement"), "请复核");
    fireEvent.press(screen.getByTestId("submit-appeal"));
    await screen.findByText("申诉中");
    expect(screen.queryByTestId("appeal")).toBeNull();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ statement: "请复核" });
  });

  it("while appealing, the FIRST rejection's reason and time are still shown (first_rejection_reason / first_decided_at)", async () => {
    const FIRST = new Date(2026, 7, 19, 16, 40).toISOString();
    stubApi({
      "/me/rebirth-applications/a1/": {
        status: 200,
        data: application({
          status: "APPEALING",
          appeal_statement: "请复核",
          rejection_reason: "",
          decided_at: null,
          first_rejection_reason: "一九八三年之欺瞒未清",
          first_decided_at: FIRST,
          current_step: { node_type: "APPEAL", approver_role: "JUDGE", is_appeal: true },
        }),
      },
    });
    wrap(<ApplicationDetailScreen id="a1" />);
    const block = await screen.findByTestId("first-rejection");
    expect(within(block).getByText("首次驳回理由")).toBeTruthy();
    expect(screen.getByTestId("first-rejection-reason").props.children).toBe("一九八三年之欺瞒未清");
    expect(screen.getByTestId("first-rejection-at").props.children).toBe("2026-08-19 16:40");
    // Shown once — not also as a "latest decision" block, which the appeal cleared.
    expect(screen.queryByTestId("rejection")).toBeNull();
    expect(within(screen.getByTestId("step-first-decision")).getByText("2026-08-19 16:40")).toBeTruthy();
  });

  it("appealed before those columns existed: both say 未记录, nothing is borrowed from another field", async () => {
    stubApi({
      "/me/rebirth-applications/a1/": {
        status: 200,
        data: application({
          status: "APPEALING",
          appeal_statement: "请复核",
          rejection_reason: "",
          decided_at: null,
          current_step: { node_type: "APPEAL", approver_role: "JUDGE", is_appeal: true },
        }),
      },
    });
    wrap(<ApplicationDetailScreen id="a1" />);
    await screen.findByTestId("first-rejection");
    expect(screen.getByTestId("first-rejection-reason").props.children).toBe("未记录");
    expect(screen.getByTestId("first-rejection-at").props.children).toBe("未记录");
  });

  it("appeal rejected: the first rejection AND the appeal's own reason, each under its own heading", async () => {
    stubApi({
      "/me/rebirth-applications/a1/": {
        status: 200,
        data: application({
          status: "APPEAL_REJECTED",
          appeal_statement: "请复核",
          rejection_reason: "复核维持原判",
          decided_at: "2026-09-12T00:00:00Z",
          first_rejection_reason: "业报未清",
          first_decided_at: "2026-09-05T00:00:00Z",
          current_step: null,
        }),
      },
    });
    wrap(<ApplicationDetailScreen id="a1" />);
    expect(within(await screen.findByTestId("first-rejection")).getByText("业报未清")).toBeTruthy();
    const latest = screen.getByTestId("rejection");
    expect(within(latest).getByText("申诉驳回理由")).toBeTruthy();
    expect(within(latest).getByText("复核维持原判")).toBeTruthy();
    expect(within(latest).queryByText("业报未清")).toBeNull();
  });

  it("never appealed: no first-rejection block (the one rejection is the latest decision)", async () => {
    stubApi({
      "/me/rebirth-applications/a1/": {
        status: 200,
        data: application({ status: "REJECTED", can_appeal: true, rejection_reason: "业报未清", decided_at: "2026-09-05T00:00:00Z", current_step: null }),
      },
    });
    wrap(<ApplicationDetailScreen id="a1" />);
    await screen.findByTestId("rejection");
    expect(screen.queryByTestId("first-rejection")).toBeNull();
  });
});
