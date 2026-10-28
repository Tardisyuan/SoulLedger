/**
 * 枉死城的冤情申诉(地府,2026-10-28):审判卡片底部的状态行、「申诉 ›」、整页表单。
 */
import type { MeWangsiCase } from "@soulledger/core/api/soul";
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { WangsiGrievanceScreen, WangsiLine } from "../screens/wangsi";
import { stubApi } from "./stubApi";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const J = "22222222-2222-2222-2222-222222222222";
const PARAMS = { judgment: J, caseNumber: "CN-2026-0011", heldUntil: "2027-12-01" };
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, addListener: () => () => {}, dispatch: jest.fn() }),
  useRoute: () => ({ params: PARAMS }),
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
  mockNavigate.mockClear();
  mockGoBack.mockClear();
});

const row = (over: Partial<MeWangsiCase> = {}): MeWangsiCase =>
  ({
    judgment_id: J,
    case_number: "CN-2026-0011",
    held_until: "2027-12-01",
    held: true,
    wrongful_death_cause: "",
    grievance_level: "",
    grievance_status: "",
    grievance_plea: "",
    grievance_note: "",
    grievance_decided_at: null,
    can_file: true,
    refusal_code: null,
    ...over,
  }) as MeWangsiCase;

it("a held case says until when and offers 「申诉 ›」, which opens the form", () => {
  wrap(<WangsiLine row={row()} />);
  expect(screen.getByTestId(`wangsi-status-${J}`).props.children).toBe("押在枉死城 · 阳寿到 2027-12-01 才受审");
  fireEvent.press(screen.getByTestId(`wangsi-file-${J}`));
  expect(mockNavigate).toHaveBeenCalledWith("WangsiGrievance", { judgment: J, caseNumber: "CN-2026-0011", heldUntil: "2027-12-01" });
});

it("a filed grievance shows its step and no second button; a decided one shows the note", () => {
  const first = wrap(<WangsiLine row={row({ grievance_status: "FILED", can_file: false, refusal_code: "grievance_open" })} />);
  expect(screen.getByTestId(`wangsi-status-${J}`).props.children).toBe("已申诉 · 待城隍核实");
  expect(screen.queryByTestId(`wangsi-file-${J}`)).toBeNull();
  first.unmount();
  wrap(
    <WangsiLine
      row={row({ held: false, held_until: null, grievance_status: "UPHELD", grievance_note: "确属冤死", can_file: false, refusal_code: "not_in_wangsi" })}
    />
  );
  expect(screen.getByTestId(`wangsi-status-${J}`).props.children).toBe("申诉属实 · 已提前释放");
  expect(screen.getByText("确属冤死")).toBeTruthy();
});

it("no row, no line", () => {
  wrap(<WangsiLine row={undefined} />);
  expect(screen.queryByTestId(`wangsi-line-${J}`)).toBeNull();
});

it("the form will not send an empty grievance, and sends the trimmed one", async () => {
  const calls = stubApi({ "POST /me/wangsi/": { status: 201, data: row({ grievance_status: "FILED", can_file: false }) } });
  wrap(<WangsiGrievanceScreen />);
  fireEvent.press(screen.getByTestId("wangsi-submit"));
  expect(screen.getByText("写下你的冤情")).toBeTruthy();
  expect(calls).toHaveLength(0);
  fireEvent.changeText(screen.getByTestId("wangsi-plea"), "  为人所害  ");
  fireEvent.press(screen.getByTestId("wangsi-submit"));
  await screen.findByTestId("wangsi-submit");
  await new Promise((r) => setTimeout(r, 0));
  expect(calls[0]?.body).toEqual({ judgment: J, plea: "为人所害" });
  expect(mockGoBack).toHaveBeenCalled();
});

it("a refusal is said in words, not as a code", async () => {
  stubApi({ "POST /me/wangsi/": { status: 409, data: { detail: "x", code: "not_in_wangsi" } } });
  wrap(<WangsiGrievanceScreen />);
  fireEvent.changeText(screen.getByTestId("wangsi-plea"), "冤");
  fireEvent.press(screen.getByTestId("wangsi-submit"));
  expect(await screen.findByText("你已不在枉死城，不用申诉")).toBeTruthy();
  expect(mockGoBack).not.toHaveBeenCalled();
});
