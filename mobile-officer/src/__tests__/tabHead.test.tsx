/**
 * Design v4 第四十六批第四节「两个 App：跟」, the officer app's side: the top line's shapes across the identity band, the
 * paper texture under every tab's head (a first-level page) and nowhere else, and the head mark on 案卷台 only — the
 * hall's name from the login tenant's `hall_names`, clear of the buttons and the title. The shapes themselves are
 * mobile/src/__tests__/civHead.test.tsx.
 */
import { act, fireEvent, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import Svg from "react-native-svg";

import { TabHead } from "../assist";
import { IdentityBand } from "../kit";
import { OFFICER, renderOfficer } from "./harness";

const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

// The harness's tenant reads as the neutral skin (its `civilization` is no short code); 地府's is CHINESE.
const DIYU = { ...OFFICER, tenant: { ...OFFICER.tenant!, civilization: "CHINESE" } };
const WITH_HALL = { ...DIYU, tenant: { ...DIYU.tenant, hall_names: { "zh-Hans": "秦廣殿", en: "First Court", egy: "Wesekhet 1" } } };
const mark = () => screen.getByTestId("head-mark-cn", { includeHiddenElements: true });
const opacity = () => StyleSheet.flatten(mark().props.style).opacity;
const svgIds = () => screen.UNSAFE_getAllByType(Svg).map((el) => el.props.testID);
const layout = (testID: string, width: number, height = 44) =>
  fireEvent(screen.getByTestId(testID), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height } } });

describe("案卷台's head", () => {
  it("is the big-title head: 96 high, the title at 30, the texture behind it, the hall's name as its mark (hidden from screen readers)", async () => {
    renderOfficer(<TabHead tab="queue" onAsk={jest.fn()} onSearch={jest.fn()} />, { user: WITH_HALL });
    expect(StyleSheet.flatten(screen.getByTestId("tab-head").props.style)).toMatchObject({ minHeight: 96, alignItems: "flex-end" });
    expect(StyleSheet.flatten(screen.getByText("案卷台").props.style).fontSize).toBe(30);
    await act(async () => layout("tab-head", 393, 96));
    expect(svgIds()).toContain("tab-head-texture");
    expect(screen.queryByTestId("head-mark-cn")).toBeNull();
    expect(mark().props.importantForAccessibility).toBe("no-hide-descendants");
    expect(mark().findAll((n) => String(n.type) === "Text").map((n) => n.props.children)).toEqual(["秦", "廣", "殿"]);
  });

  it("sits left of the buttons (24 + their width + 16) and is drawn only while the title ends 24 short of it", async () => {
    renderOfficer(<TabHead tab="queue" onAsk={jest.fn()} onSearch={jest.fn()} />, { user: WITH_HALL });
    // Not measured yet: laid out, not shown.
    expect(opacity()).toBe(0);
    await act(async () => {
      layout("tab-head-end", 120);
      fireEvent(screen.getByText("案卷台"), "textLayout", { nativeEvent: { lines: [{ width: 90 }] } });
      mark().props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 20, height: 69 } } });
    });
    expect(StyleSheet.flatten(mark().props.style).right).toBe(24 + 120 + 16);
    // The title ends at 24 + 90 = 114; the mark starts at 393 − 160 − 20 = 213. Ink at 30% (light).
    expect(opacity()).toBe(0.3);
    await act(async () => {
      fireEvent(screen.getByText("案卷台"), "textLayout", { nativeEvent: { lines: [{ width: 170 }] } });
    });
    // 24 + 170 + 24 = 218 > 213: not drawn at all.
    expect(opacity()).toBe(0);
  });

  it("a cached profile without hall names: 地府", () => {
    renderOfficer(<TabHead tab="queue" onAsk={jest.fn()} />, { user: DIYU });
    expect(mark().findAll((n) => String(n.type) === "Text").map((n) => n.props.children)).toEqual(["地", "府"]);
  });
});

describe("the other tabs' heads", () => {
  it("the neutral skin: no texture, no mark", async () => {
    renderOfficer(<TabHead tab="queue" onAsk={jest.fn()} />);
    await act(async () => layout("tab-head", 393, 96));
    expect(screen.UNSAFE_queryAllByType(Svg)).toEqual([]);
    expect(screen.queryByTestId(/^head-mark-/, { includeHiddenElements: true })).toBeNull();
  });

  it.each(["todo", "search", "notices", "me"] as const)("%s: the texture (a first-level page), no mark, the title at 20", async (tab) => {
    renderOfficer(<TabHead tab={tab} onAsk={jest.fn()} />, { user: WITH_HALL });
    await act(async () => layout("tab-head", 393, 61));
    expect(svgIds()).toContain("tab-head-texture");
    expect(screen.queryByTestId("head-mark-cn", { includeHiddenElements: true })).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId("tab-head").props.style).minHeight).toBeUndefined();
  });
});

describe("the identity band", () => {
  it("the top line inset 30 in 地府's solid 3; the header light, and no texture or civilization pattern (it is on every page)", async () => {
    renderOfficer(<IdentityBand hall="秦廣殿" name="阎罗" />, { user: WITH_HALL });
    expect(StyleSheet.flatten(screen.getByTestId("topline").props.style)).toMatchObject({ top: 0, left: 30, right: 30, height: 3 });
    await act(async () => layout("identity-band", 393, 48));
    expect(svgIds()).toEqual(["identity-band-glow"]);
    expect(screen.queryByTestId("head-mark-cn", { includeHiddenElements: true })).toBeNull();
  });
});
