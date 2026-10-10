/**
 * The crash screen says "已自动报告。" only after the server accepted the report, and offers 回到首页
 * beside 重试. Nothing about the error itself is shown. The SDK is faked at the one seam that carries
 * the outcome: the client's `afterSendEvent` hook (see `captureCrash`).
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { initCrashReporting } from "../crashReport";
import { RootErrorBoundary } from "../errorBoundary";
import { I18nProvider } from "../i18n";

type Listener = (event: { event_id?: string }, response: unknown) => void;
const mockListeners: Listener[] = [];
// What the next captureException does after queuing: emit a response for its own id, another id, or nothing.
let mockOutcome: ((id: string) => void) | null = null;
let mockSeq = 0;
const mockSdk = {
  init: jest.fn(),
  setTag: jest.fn(),
  setUser: jest.fn(),
  getClient: jest.fn(() => ({
    on: (_hook: string, cb: Listener) => {
      mockListeners.push(cb);
      return () => {
        mockListeners.splice(mockListeners.indexOf(cb), 1);
      };
    },
  })),
  captureException: jest.fn(() => {
    const id = `ev${++mockSeq}`;
    const outcome = mockOutcome;
    if (outcome) void Promise.resolve().then(() => outcome(id));
    return id;
  }),
};
jest.mock("@sentry/react-native", () => mockSdk, { virtual: true });

const emit = (event_id: string, response: unknown) => [...mockListeners].forEach((l) => l({ event_id }, response));

function Boom(): never {
  throw new Error("render exploded: secret-detail");
}
let fail = true;
const Maybe = () => (fail ? <Boom /> : <Text testID="ok">ok</Text>);

const mount = () =>
  render(
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
      <I18nProvider>
        <RootErrorBoundary>
          <Maybe />
        </RootErrorBoundary>
      </I18nProvider>
    </SafeAreaProvider>
  );

const REPORTED = "已自动报告。";
const settle = () => act(async () => {});

beforeEach(() => {
  fail = true;
  mockOutcome = null;
  mockSdk.captureException.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// This one must run first: reporting has not been started in this module yet.
test("no DSN: nothing was sent, so the screen does not say it was", async () => {
  mount();
  await settle();
  expect(screen.getByTestId("crash-screen")).toBeTruthy();
  expect(screen.queryByText(REPORTED)).toBeNull();
  expect(mockSdk.captureException).not.toHaveBeenCalled();
});

describe("with reporting on", () => {
  beforeAll(() => {
    expect(initCrashReporting("https://k@o0.ingest.test/1", "soul")).toBe(true);
  });

  test("accepted by the server (2xx): the line appears", async () => {
    mockOutcome = (id) => emit(id, { statusCode: 200 });
    mount();
    await settle();
    expect(screen.getByText(REPORTED)).toBeTruthy();
  });

  test.each([
    ["the server refused it (429)", (id: string) => emit(id, { statusCode: 429 })],
    ["the send failed (an error object, no status)", (id: string) => emit(id, new Error("Network request failed"))],
    ["the answer was for another event", (id: string) => emit(`${id}-other`, { statusCode: 200 })],
  ])("%s: the line is absent", async (_name, outcome) => {
    jest.useFakeTimers();
    mockOutcome = outcome;
    mount();
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(screen.getByTestId("crash-screen")).toBeTruthy();
    expect(screen.queryByText(REPORTED)).toBeNull();
  });

  test("the SDK dropped the event (nothing is ever sent): the line is absent after the wait", async () => {
    jest.useFakeTimers();
    mockOutcome = null;
    mount();
    await settle();
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(mockSdk.captureException).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(REPORTED)).toBeNull();
    expect(mockListeners).toHaveLength(0); // the hook is released, not leaked
  });

  test("a client without the hook cannot prove delivery: the line is absent", async () => {
    mockSdk.getClient.mockReturnValueOnce({} as never);
    mount();
    await settle();
    expect(screen.queryByText(REPORTED)).toBeNull();
  });
});

describe("the screen", () => {
  beforeAll(() => {
    initCrashReporting("https://k@o0.ingest.test/1", "soul");
  });

  test("shows no error text, and 回到首页 remounts the tree beside 重试", async () => {
    mockOutcome = (id) => emit(id, { statusCode: 200 });
    mount();
    await settle();
    expect(screen.queryByText(/render exploded|secret-detail/)).toBeNull();
    expect(screen.getByText("重试")).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByText("回到首页"));
    expect(screen.getByTestId("ok")).toBeTruthy();
    expect(screen.queryByTestId("crash-screen")).toBeNull();
  });

  test("a second crash starts without the line: it is not carried over from the first", async () => {
    mockOutcome = (id) => emit(id, { statusCode: 200 });
    mount();
    await settle();
    expect(screen.getByText(REPORTED)).toBeTruthy();
    mockOutcome = null; // the second report never goes out
    fireEvent.press(screen.getByText("重试")); // still failing: Boom throws again
    await settle();
    expect(screen.getByTestId("crash-screen")).toBeTruthy();
    expect(screen.queryByText(REPORTED)).toBeNull();
  });
});
