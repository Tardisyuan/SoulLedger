/**
 * 第二十八批 S4 in the officer app, as in the soul app (mobile layout.test): a list row's identifiers / times /
 * statuses keep to one line (cut with …, long-press for the whole), and above 1.5× text a "text left, value
 * right" row becomes two lines. Rendered with a controlled window.
 */
import { fireEvent, screen, within } from "@testing-library/react-native";
import { Alert } from "react-native";

import { Row } from "../kit";
import { renderOfficer } from "./harness";

const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

afterEach(() => {
  Object.assign(mockWindow, { fontScale: 1 });
  jest.restoreAllMocks();
});

describe("Row lines", () => {
  it("a `{ one }` line is one line and a long press reads it whole; a plain line may wrap", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    renderOfficer(<Row testID="r" title="请求转生" lines={["一句可以折行的说明", { one: "SL-0000-0000-0000 · 2026-10-12 08:02" }]} />);
    const one = screen.getByText("SL-0000-0000-0000 · 2026-10-12 08:02");
    expect(one.props.numberOfLines).toBe(1);
    expect(one.props.ellipsizeMode).toBe("tail");
    expect(screen.getByText("一句可以折行的说明").props.numberOfLines).toBeUndefined();
    fireEvent(one, "longPress");
    expect(alert).toHaveBeenCalledWith("SL-0000-0000-0000 · 2026-10-12 08:02");
  });

  it("a press on the one-line text still opens the row; a gone row's does not", () => {
    const onPress = jest.fn();
    const { unmount } = renderOfficer(<Row testID="r" title="请求转生" lines={[{ one: "2026-10-12 08:02" }]} onPress={onPress} />);
    fireEvent.press(screen.getByText("2026-10-12 08:02"));
    expect(onPress).toHaveBeenCalledTimes(1);
    unmount();

    renderOfficer(<Row testID="r" title="请求转生" lines={[{ one: "2026-10-12 08:02" }]} onPress={onPress} gone />);
    fireEvent.press(screen.getByText("2026-10-12 08:02"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("Row value", () => {
  it("at 1×, beside the title on one line", () => {
    renderOfficer(<Row testID="r" title="通知类别" value="已关 2 类" />);
    const value = screen.getByTestId("r-value");
    expect(value.props.numberOfLines).toBe(1);
    // Not inside the title's column: a sibling of it in the row.
    expect(within(screen.getByTestId("r-text")).queryByTestId("r-value")).toBeNull();
  });

  it("at 1.5×, under the title -- still one line", () => {
    Object.assign(mockWindow, { fontScale: 1.5 });
    renderOfficer(<Row testID="r" title="通知类别" value="已关 2 类" />);
    const value = screen.getByTestId("r-value");
    expect(value.props.numberOfLines).toBe(1);
    expect(within(screen.getByTestId("r-text")).getByTestId("r-value")).toBeTruthy();
  });

  it("just under 1.5× it stays beside", () => {
    Object.assign(mockWindow, { fontScale: 1.49 });
    renderOfficer(<Row testID="r" title="通知类别" value="已关 2 类" />);
    expect(within(screen.getByTestId("r-text")).queryByTestId("r-value")).toBeNull();
  });
});
