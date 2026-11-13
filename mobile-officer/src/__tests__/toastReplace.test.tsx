/**
 * A decision retried: its new outcome replaces the toast of the last one (官员端真机 2026-11-14 — 「已取消」 stayed
 * on screen under the seal that succeeded), and a check the officer cancelled is a notice, not a failure to close.
 */
import { act, screen } from "@testing-library/react-native";
import { useEffect } from "react";

import { DECISION_TOAST, NotConfirmed, decisionFailureKind } from "../deviceCheck";
import { ToastProvider, useDismissToast, useToast } from "../shared";
import { renderOfficer as render } from "./harness";

function Say({ lines }: { lines: [string, "success" | "info" | "failure", string | undefined][] }) {
  const toast = useToast();
  useEffect(() => {
    for (const [m, k, key] of lines) toast(m, k, key);
  }, [toast, lines]);
  return null;
}

it("a toast with the same key replaces the shown one; without a key they stack", () => {
  render(
    <ToastProvider>
      <Say lines={[["已取消", "failure", DECISION_TOAST], ["已落印", "success", DECISION_TOAST]]} />
    </ToastProvider>
  );
  expect(screen.getByTestId("toast")).toHaveTextContent("已落印");
  expect(screen.queryByText("已取消")).toBeNull();
  expect(screen.queryByTestId("toast-earlier")).toBeNull();
  screen.unmount();

  render(
    <ToastProvider>
      <Say lines={[["一", "failure", undefined], ["二", "failure", undefined]]} />
    </ToastProvider>
  );
  expect(screen.getByTestId("toast-earlier")).toHaveTextContent("一");
  expect(screen.getByTestId("toast")).toHaveTextContent("二");
});

it("a cancelled check is a notice; a failed check and a server refusal are failures", () => {
  expect(decisionFailureKind(new NotConfirmed("cancelled"))).toBe("info");
  expect(decisionFailureKind(new NotConfirmed("failed"))).toBe("failure");
  expect(decisionFailureKind(new Error("409"))).toBe("failure");
});

it("a notice goes by itself", () => {
  jest.useFakeTimers();
  render(
    <ToastProvider>
      <Say lines={[["已取消", decisionFailureKind(new NotConfirmed("cancelled")), DECISION_TOAST]]} />
    </ToastProvider>
  );
  expect(screen.getByTestId("toast")).toHaveTextContent("已取消");
  act(() => jest.advanceTimersByTime(10_000));
  expect(screen.queryByText("已取消")).toBeNull();
  jest.useRealTimers();
});

function SayThenClear() {
  const toast = useToast();
  const dismiss = useDismissToast();
  useEffect(() => {
    toast("别的事", "info");
    toast("服务端拒绝", "failure", DECISION_TOAST);
    dismiss(DECISION_TOAST); // the swipe that then lands says nothing itself
  }, [toast, dismiss]);
  return null;
}

it("a silent success takes down the keyed failure and only that one", () => {
  render(
    <ToastProvider>
      <SayThenClear />
    </ToastProvider>
  );
  expect(screen.queryByText("服务端拒绝")).toBeNull();
  expect(screen.getByTestId("toast")).toHaveTextContent("别的事");
});
