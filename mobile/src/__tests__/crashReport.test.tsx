/**
 * What a crash report may carry. Every secret below is a distinctive string; the assertions look for
 * the STRING in the serialized event (absence), not for a field being missing.
 */
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { initCrashReporting, scrubBreadcrumb, scrubEvent, scrubString, setCrashUser } from "../crashReport";
import { RootErrorBoundary } from "../errorBoundary";
import { I18nProvider } from "../i18n";

const mockSdk = { init: jest.fn(), setTag: jest.fn(), setUser: jest.fn(), captureException: jest.fn() };
let mockLoaded = 0;
jest.mock("@sentry/react-native", () => {
  mockLoaded += 1;
  return mockSdk;
});

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
const SECRETS = [
  JWT, "hunter2-password", "654321-code", "JBSWY3DPEHPK3PXP-totp", "recov-AAAA-BBBB", "Dear-Mother-letter-body",
  "ask-about-my-past-life", "soul-ABCDEFGHIJ", "me@example.test", "Alice-Real-Name", "page=secret-query", "opaque-refresh-xyz",
  // A letter image (2026-10-10): its id, its local file, and the signed address it is fetched from.
  "img-secret-id", "file:///cache/secret.jpg", "sig-secret",
];

const dirty = () => ({
  event_id: "e1",
  message: `failed with Bearer ${JWT}`,
  user: { id: 7, username: "Alice-Real-Name", email: "me@example.test", ip_address: "1.2.3.4", soul_code: "soul-ABCDEFGHIJ" },
  request: {
    url: "https://api.test/me/chat/?page=secret-query",
    headers: { Authorization: `Bearer ${JWT}`, Cookie: "sid=1" },
    data: { password: "hunter2-password", otp: "654321-code" },
  },
  extra: {
    totp_secret: "JBSWY3DPEHPK3PXP-totp",
    recovery_codes: ["recov-AAAA-BBBB"],
    letter_body: "Dear-Mother-letter-body",
    letter_image: { id: "img-secret-id", uri: "file:///cache/secret.jpg" },
    image_url: "https://api.test/api/v1/chat-images/1/?t=sig-secret",
    outbox: { image: { imageId: "img-secret-id", uri: "file:///cache/secret.jpg" } },
    question: "ask-about-my-past-life",
    nested: { refresh_token: "opaque-refresh-xyz", access_token: JWT, harmless: "kept" },
  },
  contexts: { device: { name: "Alice-Real-Name", model: "iPhone15,2" } },
  tags: { app: "soul" },
  exception: { values: [{ type: "Error", value: `401 for Bearer ${JWT}` }] },
  breadcrumbs: [
    { category: "console", message: "Dear-Mother-letter-body" },
    { category: "ui.input", message: "hunter2-password" },
    { category: "fetch", data: { url: "https://api.test/me/?page=secret-query", status_code: 401, Authorization: `Bearer ${JWT}`, body: "ask-about-my-past-life" } },
  ],
});

test("no secret survives scrubEvent, and what is useful does", () => {
  const out = scrubEvent(dirty());
  const text = JSON.stringify(out);
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(out.user).toEqual({ id: "7" });
  expect(out.request).toBeUndefined();
  expect(out.exception.values[0].type).toBe("Error");
  expect(out.extra.nested.harmless).toBe("kept");
  expect(out.contexts.device.model).toBe("iPhone15,2");
  expect(out.breadcrumbs).toHaveLength(1);
  expect(out.breadcrumbs[0]?.data?.status_code).toBe(401);
});

test("it does not modify its input and tolerates an empty event", () => {
  const input = dirty();
  scrubEvent(input);
  expect(JSON.stringify(input)).toContain("hunter2-password");
  expect(() => scrubEvent({})).not.toThrow();
  expect(scrubEvent({ user: {} }).user).toBeUndefined();
});

test("breadcrumbs: console and typed input are dropped, the rest is scrubbed", () => {
  expect(scrubBreadcrumb({ category: "console", message: "x" })).toBeNull();
  expect(scrubBreadcrumb({ category: "ui.input", message: "x" })).toBeNull();
  expect(JSON.stringify(scrubBreadcrumb({ category: "navigation", data: { to: "Letters", token: JWT } }))).not.toContain(JWT);
});

test("scrubString removes tokens and query strings", () => {
  expect(scrubString(`GET https://a.test/x?code=1&b=2 Bearer ${JWT}`)).toBe("GET https://a.test/x Bearer [Filtered]");
});

describe("initialisation", () => {
  beforeEach(() => jest.clearAllMocks());

  test("without a DSN nothing starts and the SDK is never even mockLoaded", () => {
    expect(initCrashReporting(undefined, "soul")).toBe(false);
    expect(initCrashReporting("", "officer")).toBe(false);
    setCrashUser(3);
    expect(mockLoaded).toBe(0);
    expect(mockSdk.init).not.toHaveBeenCalled();
  });

  test("with a DSN it starts with the invasive options off and a scrubbing beforeSend", () => {
    expect(initCrashReporting("https://k@o0.ingest.test/1", "officer")).toBe(true);
    const opts = mockSdk.init.mock.calls[0][0];
    expect(opts).toMatchObject({ sendDefaultPii: false, tracesSampleRate: 0, attachScreenshot: false, attachViewHierarchy: false });
    expect(opts.integrations).toBeUndefined();
    expect(JSON.stringify(opts.beforeSend(dirty()))).not.toContain("hunter2-password");
    expect(opts.beforeBreadcrumb({ category: "console" })).toBeNull();
    setCrashUser(9);
    expect(mockSdk.setUser).toHaveBeenCalledWith({ id: "9" });
  });
});

describe("RootErrorBoundary", () => {
  function Boom(): never {
    throw new Error("render exploded");
  }
  const mount = (child: React.ReactNode) =>
    render(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <I18nProvider>
          <RootErrorBoundary>{child}</RootErrorBoundary>
        </I18nProvider>
      </SafeAreaProvider>
    );

  test("a render error shows the error screen, not a blank, and retry remounts", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    const Maybe = () => (fail ? <Boom /> : <Text testID="ok">ok</Text>);
    mount(<Maybe />);
    expect(screen.getByTestId("crash-screen")).toBeTruthy();
    fail = false;
    fireEvent.press(screen.getByText("重试"));
    expect(screen.getByTestId("ok")).toBeTruthy();
  });

  test("a healthy tree is untouched", () => {
    mount(<Text testID="ok">ok</Text>);
    expect(screen.queryByTestId("crash-screen")).toBeNull();
  });
});
