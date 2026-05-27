/**
 * Tests for src/components/ui/Toast.tsx
 *
 * Toast is a pure-DOM module (no React rendering).
 * We test the exported showToast / dismissToast functions.
 */
import { showToast, dismissToast } from "@/src/components/ui/Toast";

// ── Helpers ──────────────────────────────────────────

/** Remove the toast container + keyframes style between tests. */
function cleanupToasts() {
  document.getElementById("toast-container")?.remove();
  document.getElementById("toast-keyframes")?.remove();
}

// ── Tests ────────────────────────────────────────────

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    cleanupToasts();
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    cleanupToasts();
  });

  // --- showToast ---

  it("should create a toast container in the DOM", () => {
    showToast("hello");
    const container = document.getElementById("toast-container");
    expect(container).not.toBeNull();
    expect(container!.tagName).toBe("DIV");
  });

  it("should render a toast element with role='alert'", () => {
    const id = showToast("Test message");
    const el = document.getElementById(`toast-${id}`);
    expect(el).not.toBeNull();
    expect(el!.getAttribute("role")).toBe("alert");
  });

  it("should display the correct message text", () => {
    showToast("Soul saved successfully");
    const alerts = document.querySelectorAll("[role='alert']");
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain("Soul saved successfully");
  });

  it("should render success icon for success type", () => {
    showToast("ok", "success");
    const alerts = document.querySelectorAll("[role='alert']");
    expect(alerts[0].textContent).toContain("✓"); // checkmark
  });

  it("should render error icon for error type", () => {
    showToast("fail", "error");
    const alerts = document.querySelectorAll("[role='alert']");
    expect(alerts[0].textContent).toContain("✕"); // cross
  });

  it("should default to info type", () => {
    showToast("fyi");
    const alerts = document.querySelectorAll("[role='alert']");
    expect(alerts[0].textContent).toContain("ℹ"); // info
  });

  // --- Multiple toasts ---

  it("should support multiple toasts simultaneously", () => {
    showToast("first");
    showToast("second");
    showToast("third");
    const alerts = document.querySelectorAll("[role='alert']");
    expect(alerts.length).toBe(3);
  });

  it("should assign unique IDs to each toast", () => {
    const id1 = showToast("a");
    const id2 = showToast("b");
    expect(id1).not.toBe(id2);
    expect(document.getElementById(`toast-${id1}`)).not.toBeNull();
    expect(document.getElementById(`toast-${id2}`)).not.toBeNull();
  });

  // --- Auto-dismiss ---

  it("should auto-dismiss after the specified duration", () => {
    const id = showToast("auto gone", "info", 2000);
    expect(document.getElementById(`toast-${id}`)).not.toBeNull();

    // Not yet dismissed
    jest.advanceTimersByTime(1999);
    expect(document.getElementById(`toast-${id}`)).not.toBeNull();

    // Now dismissed (timer fires + 200ms fade-out remove)
    jest.advanceTimersByTime(1);
    jest.advanceTimersByTime(200);
    expect(document.getElementById(`toast-${id}`)).toBeNull();
  });

  it("should use 5000ms as default duration", () => {
    const id = showToast("default duration");
    expect(document.getElementById(`toast-${id}`)).not.toBeNull();

    jest.advanceTimersByTime(5000);
    jest.advanceTimersByTime(200); // fade-out
    expect(document.getElementById(`toast-${id}`)).toBeNull();
  });

  // --- dismissToast ---

  it("should remove a toast immediately via dismissToast", () => {
    const id = showToast("dismiss me", "info", 60_000);
    expect(document.getElementById(`toast-${id}`)).not.toBeNull();

    dismissToast(id);
    // fade-out takes 200ms
    jest.advanceTimersByTime(200);
    expect(document.getElementById(`toast-${id}`)).toBeNull();
  });

  it("should remove the container when all toasts are dismissed", () => {
    const id = showToast("only one");
    expect(document.getElementById("toast-container")).not.toBeNull();

    dismissToast(id);
    jest.advanceTimersByTime(200);
    expect(document.getElementById("toast-container")).toBeNull();
  });

  it("should keep the container when only one of multiple toasts is dismissed", () => {
    showToast("stay");
    const id2 = showToast("go away");

    dismissToast(id2);
    jest.advanceTimersByTime(200);
    expect(document.getElementById("toast-container")).not.toBeNull();
  });

  // --- Close button ---

  it("should have a close button that dismisses the toast", () => {
    const id = showToast("closable");
    const closeBtn = document.getElementById(`toast-close-${id}`);
    expect(closeBtn).not.toBeNull();

    closeBtn!.click();
    jest.advanceTimersByTime(200);
    expect(document.getElementById(`toast-${id}`)).toBeNull();
  });
});
