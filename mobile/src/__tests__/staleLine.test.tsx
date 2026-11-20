/**
 * Design v4 第六十一批 E6: data on screen and a refresh that failed say so in one line (the time of what is shown, and
 * 重试) -- defined once (`StaleLine`, ui.tsx) and placed under the head of every `useRemote` page. Never while the
 * offline bar already says why; gone once a refresh answers.
 */
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useCallback } from "react";
import { Text } from "react-native";

import { OnlineContext } from "../online";
import { StaleLine, useRemote } from "../ui";
import { renderSoul } from "./harness";

const AT = new Date(2026, 10, 21, 9, 42).getTime();

it("data, an error and a time: the line, with the time of what is shown and 重试", () => {
  const retry = jest.fn();
  jest.useFakeTimers({ now: new Date(2026, 10, 21, 15, 0) });
  try {
    renderSoul(<StaleLine state={{ data: {}, error: new Error("x"), at: AT }} onRetry={retry} />);
    expect(screen.getByText("↻ 显示的是 09:42 的内容 · 刷新没成功")).toBeTruthy();
    fireEvent.press(screen.getByTestId("stale-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

it("another day writes the date, the same rule as the web's 「数据截至」", () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 22, 8, 0) });
  try {
    renderSoul(<StaleLine state={{ data: {}, error: new Error("x"), at: AT }} onRetry={() => {}} />);
    expect(screen.getByText("↻ 显示的是 11-21 09:42 的内容 · 刷新没成功")).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it.each([
  ["no error", { data: {}, error: null, at: AT }],
  ["nothing on screen yet (the page's own error state says it)", { data: null, error: new Error("x"), at: null }],
])("no line with %s", (_label, state) => {
  renderSoul(<StaleLine state={state} onRetry={() => {}} />);
  expect(screen.queryByTestId("stale-line")).toBeNull();
});

it("no line while the offline bar shows", () => {
  renderSoul(
    <OnlineContext.Provider value={{ offline: true, back: 0 }}>
      <StaleLine state={{ data: {}, error: new Error("x"), at: AT }} onRetry={() => {}} />
    </OnlineContext.Provider>
  );
  expect(screen.queryByTestId("stale-line")).toBeNull();
});

it("useRemote: a failed refresh over data shows the line; the next refresh that answers takes it away", async () => {
  let fail = false;
  function Page() {
    const remote = useRemote(
      useCallback(() => (fail ? Promise.reject(new Error("down")) : Promise.resolve("v")), [])
    );
    return (
      <>
        <StaleLine state={remote} onRetry={() => void remote.reload()} />
        <Text testID="reload" onPress={() => void remote.reload()}>
          {String(remote.data)}
        </Text>
      </>
    );
  }
  renderSoul(<Page />);
  await screen.findByText("v");
  expect(screen.queryByTestId("stale-line")).toBeNull();
  fail = true;
  await act(async () => void fireEvent.press(screen.getByTestId("reload")));
  await screen.findByTestId("stale-line");
  expect(screen.getByText("v")).toBeTruthy(); // the old data stays
  fail = false;
  await act(async () => void fireEvent.press(screen.getByTestId("stale-retry")));
  await waitFor(() => expect(screen.queryByTestId("stale-line")).toBeNull());
});
