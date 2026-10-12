/** 待办按类型筛选 (Design batch 28 O2): multi-select chips with counts, remembered on this phone. */
import { platform } from "@soulledger/core/platform";
import { fireEvent, screen } from "@testing-library/react-native";

import { TODO_FILTER_KEY, TodoTab } from "../screens/todo";
import { renderOfficer } from "./harness";

const mockTodo = jest.fn();
jest.mock("@soulledger/core/api/officer-app", () => ({
  ...jest.requireActual("@soulledger/core/api/officer-app"),
  officerAppApi: { todo: (...a: unknown[]) => mockTodo(...a) },
}));

const row = (kind: string, id: string) => ({ kind, id, title: `t-${id}`, created_at: "2026-10-09T01:00:00Z", target: { kind, id } });
const group = (items: object[]) => ({ count: items.length, items });
const DATA = {
  approvals: group([row("approval", "a1"), row("approval", "a2")]),
  reassignments: group([row("reassignment", "d1")]),
  cooldowns: group([]),
  rebirths: group([]),
  letters: group([]),
};

const mount = () => renderOfficer(<TodoTab highlight={null} onOpen={() => {}} />);
const chip = (kind: string) => screen.getByTestId(`todo-filter-${kind}`);

beforeEach(() => {
  jest.clearAllMocks();
  platform().persistent.remove(TODO_FILTER_KEY);
  mockTodo.mockResolvedValue({ data: DATA });
});

describe("the to-do type filter", () => {
  it("shows every group when nothing is chosen, with a count in each chip's label", async () => {
    mount();
    expect(await screen.findByTestId("todo-group-approval")).toBeTruthy();
    expect(screen.getByTestId("todo-group-reassignment")).toBeTruthy();
    expect(chip("approval").props.accessibilityLabel).toBe("审批节点 · 2");
    expect(chip("cooldown").props.accessibilityLabel).toBe("缩短冷却申请 · 0");
    expect(screen.getAllByTestId(/^todo-filter-/).length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByTestId("todo-filter-clear")).toBeNull();
  });

  it("choosing a kind narrows the list, choosing a second widens it again, and the chips say which are on", async () => {
    mount();
    await screen.findByTestId("todo-group-approval");
    fireEvent.press(chip("reassignment"));
    expect(screen.queryByTestId("todo-group-approval")).toBeNull();
    expect(screen.getByTestId("todo-group-reassignment")).toBeTruthy();
    expect(chip("reassignment").props.accessibilityState).toEqual({ selected: true });
    expect(chip("approval").props.accessibilityState).toEqual({ selected: false });
    fireEvent.press(chip("approval"));
    expect(screen.getByTestId("todo-group-approval")).toBeTruthy();
    expect(screen.getByTestId("todo-group-reassignment")).toBeTruthy();
    fireEvent.press(chip("approval"));
    fireEvent.press(chip("reassignment"));
    expect(screen.getByTestId("todo-group-approval")).toBeTruthy();
  });

  it("remembers the choice on this phone and restores it on the next mount; clearing forgets it", async () => {
    const first = mount();
    await screen.findByTestId("todo-group-approval");
    fireEvent.press(chip("reassignment"));
    expect(JSON.parse(platform().persistent.get(TODO_FILTER_KEY) ?? "null")).toEqual(["reassignment"]);
    first.unmount();

    mount();
    expect(await screen.findByTestId("todo-group-reassignment")).toBeTruthy();
    expect(screen.queryByTestId("todo-group-approval")).toBeNull();
    expect(chip("reassignment").props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(chip("reassignment"));
    expect(platform().persistent.get(TODO_FILTER_KEY)).toBeFalsy();
  });

  it("ignores a stored value it does not understand", async () => {
    platform().persistent.set(TODO_FILTER_KEY, JSON.stringify(["nope", 3]));
    mount();
    expect(await screen.findByTestId("todo-group-approval")).toBeTruthy();
  });

  it("a chosen kind shows a summary line (kinds joined with 、, then the rows shown) with a clear action; nothing chosen shows none", async () => {
    mount();
    await screen.findByTestId("todo-group-approval");
    expect(screen.queryByTestId("todo-filter-summary")).toBeNull();
    expect(screen.queryByTestId("todo-filter-clear")).toBeNull();
    fireEvent.press(chip("approval"));
    expect(screen.getByTestId("todo-filter-summary").props.children).toBe("审批节点 · 2 条");
    fireEvent.press(chip("reassignment"));
    expect(screen.getByTestId("todo-filter-summary").props.children).toBe("审批节点、移交 · 3 条");
    fireEvent.press(screen.getByTestId("todo-filter-clear"));
    expect(screen.queryByTestId("todo-filter-summary")).toBeNull();
    expect(screen.getByTestId("todo-group-reassignment")).toBeTruthy();
    expect(platform().persistent.get(TODO_FILTER_KEY)).toBeFalsy();
  });

  it("a chip whose count is 0 is shown and stays enabled", async () => {
    mount();
    await screen.findByTestId("todo-group-approval");
    expect(chip("cooldown").props.accessibilityLabel).toBe("缩短冷却申请 · 0");
    expect(chip("cooldown").props.accessibilityState).toEqual({ selected: false });
    expect(chip("cooldown").props.accessibilityState.disabled).toBeUndefined();
  });

  it("a choice with nothing in it shows the filtered-empty state with the kinds in its title and a clear button that restores the list", async () => {
    mount();
    await screen.findByTestId("todo-group-approval");
    fireEvent.press(chip("cooldown"));
    expect(screen.getByTestId("state-empty")).toBeTruthy();
    expect(screen.getByText("没有「缩短冷却申请」待办")).toBeTruthy();
    expect(screen.getByText("换个类型看看，或清除筛选。")).toBeTruthy();
    expect(screen.queryByText("这几类里没有待办")).toBeNull();
    expect(screen.queryByText("此刻没有轮到你的事")).toBeNull();
    expect(screen.queryByTestId("todo-group-approval")).toBeNull();
    // The chips stay, so the choice can be changed without clearing.
    expect(chip("cooldown").props.accessibilityState).toEqual({ selected: true });

    fireEvent.press(screen.getByTestId("todo-filter-clear-empty"));
    expect(screen.getByTestId("todo-group-approval")).toBeTruthy();
    expect(screen.queryByTestId("state-empty")).toBeNull();
    expect(screen.queryByTestId("todo-filter-summary")).toBeNull();
    expect(platform().persistent.get(TODO_FILTER_KEY)).toBeFalsy();
  });

  it("a list with nothing waiting at all keeps the plain empty state and draws no chips", async () => {
    mockTodo.mockResolvedValue({ data: { approvals: group([]), reassignments: group([]), cooldowns: group([]), rebirths: group([]), letters: group([]) } });
    mount();
    expect(await screen.findByText("此刻没有轮到你的事")).toBeTruthy();
    expect(screen.queryByTestId("todo-filter")).toBeNull();
    expect(screen.queryByTestId("todo-filter-clear")).toBeNull();
    expect(screen.queryByTestId("todo-filter-summary")).toBeNull();
  });
});
