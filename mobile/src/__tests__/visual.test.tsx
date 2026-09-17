/**
 * The presentation rules as rendered: the unknown-value badge, the reason under
 * a disabled control, the initial-password expiry warning, a past life with no
 * action in it, the civilization skin, and the long-label layout.
 */
import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { I18nProvider } from "../i18n";
import { installMobilePlatform } from "../platform";
import { APPLICATION_BADGES } from "../rules";
import { ExpiryBox } from "../screens/auth";
import { LifeSections } from "../screens/life";
import { themeFor } from "../theme";
import { Button, DataRow, EnumBadge, ThemeContext } from "../ui";
import { application, life } from "./stubApi";

const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

function wrap(children: ReactNode, civilization: string | null = "CHINESE") {
  return render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <ThemeContext.Provider value={themeFor(civilization, "dark")}>
          <NavigationContainer>{children}</NavigationContainer>
        </ThemeContext.Provider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

beforeEach(() => installMobilePlatform());

describe("the unrecognized-value badge", () => {
  it("shows the label AND the raw member, in mono, inside a dotted border", () => {
    wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="PENDING_SYNC" />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText("?")).toBeTruthy();
    expect(within(badge).getByText("未识别取值")).toBeTruthy();
    const raw = within(badge).getByText("PENDING_SYNC");
    expect(flat(raw).fontFamily).toBe("IBMPlexMono_400Regular");
    expect(flat(badge).borderStyle).toBe("dotted");
  });

  it("a known member shows its label only — no raw value beside it, no dotted border", () => {
    wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="REJECTED" />);
    const badge = screen.getByTestId("b");
    expect(within(badge).getByText("已驳回")).toBeTruthy();
    expect(within(badge).queryByText("REJECTED")).toBeNull();
    expect(within(badge).queryByText("未识别取值")).toBeNull();
    expect(flat(badge).borderStyle).toBe("solid");
  });
});

describe("a disabled control says why", () => {
  it("the reason is shown while disabled, and pressing does nothing", () => {
    const onPress = jest.fn();
    wrap(<Button testID="go" title="提交" onPress={onPress} disabled reason="已有一份进行中的转生申请" reasonTestID="why" />);
    expect(screen.getByTestId("why").props.children).toBe("已有一份进行中的转生申请");
    fireEvent.press(screen.getByTestId("go"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("an enabled control shows no reason", () => {
    wrap(<Button testID="go" title="提交" onPress={jest.fn()} reason="已有一份进行中的转生申请" reasonTestID="why" />);
    expect(screen.queryByTestId("why")).toBeNull();
  });
});

describe("initial password expiry", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  const inHours = (h: number) => new Date(now + h * 3_600_000).toISOString();
  const theme = themeFor(null, "dark");

  it("under 6 hours: warning colours AND the consequence, not only a colour change", () => {
    wrap(<ExpiryBox expiresAt={inHours(3.5)} now={now} />, null);
    const box = screen.getByTestId("expiry-box");
    expect(flat(box)).toMatchObject({ borderColor: theme.negStrong, backgroundColor: theme.negBg });
    expect(screen.getByText("剩余 3 小时 · 过期后须由官员重置")).toBeTruthy();
  });

  it("with time to spare: neutral box, hours left, no consequence line", () => {
    wrap(<ExpiryBox expiresAt={inHours(39.2)} now={now} />, null);
    const box = screen.getByTestId("expiry-box");
    expect(flat(box)).toMatchObject({ borderColor: theme.accent, backgroundColor: theme.s1 });
    expect(screen.getByText("剩余 39 小时")).toBeTruthy();
    expect(screen.queryByText(/官员重置/)).toBeNull();
  });
});

describe("a past life has no action in it", () => {
  it("sealed: no disclosure, no link into an application — even with a handler passed and can_appeal set", () => {
    const onOpen = jest.fn();
    wrap(
      <LifeSections
        sealed
        onOpenApplication={onOpen}
        onToggle={jest.fn()}
        life={life(0, { rebirth_applications: [application({ cycle: 0, status: "REJECTED", can_appeal: true })] }) as never}
      />
    );
    expect(screen.getByText("已驳回")).toBeTruthy();
    expect(screen.queryAllByRole("button")).toEqual([]);
  });

  it("the current life does link into its application (so the sealed case above is not vacuous)", () => {
    wrap(
      <LifeSections
        onOpenApplication={jest.fn()}
        life={life(1, { rebirth_applications: [application({ id: "a9" })] }) as never}
      />
    );
    expect(screen.getByTestId("life-open-a9")).toBeTruthy();
  });
});

describe("civilization skin", () => {
  it("the same component takes each civilization's accent", () => {
    const marks = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((civ) => {
      const { unmount } = wrap(<EnumBadge testID="b" namespace="soul_app.status" table={APPLICATION_BADGES} value="UNDER_REVIEW" />, civ);
      const color = flat(screen.getByTestId("b")).borderColor;
      unmount();
      return color;
    });
    expect(marks).toEqual(["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"].map((c) => themeFor(c, "dark").accent));
    expect(new Set(marks).size).toBe(4);
  });
});

describe("long labels", () => {
  it("a label over 18 characters puts the value on its own line; a short one stays beside it", () => {
    wrap(
      <>
        <DataRow testID="short" label="Cross-civilization">
          No
        </DataRow>
        <DataRow testID="long" label="Cross-civilisation transfer" mono>
          2026-09-09 16:40
        </DataRow>
      </>
    );
    expect(flat(screen.getByTestId("short")).flexDirection).toBe("row");
    expect(flat(screen.getByTestId("long")).flexDirection).toBe("column");
    // A mono value is never shortened.
    expect(screen.getByText("2026-09-09 16:40").props.numberOfLines).toBeUndefined();
  });
});
