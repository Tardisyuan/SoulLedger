/**
 * Tests for src/components/ui/Toast.tsx
 *
 * Toast is a pure-DOM module (no React rendering).
 * We test the exported showToast / dismissToast functions.
 */
import { showToast, dismissToast } from "@/src/components/ui/Toast";

// ── Helpers ──────────────────────────────────────────

/** Remove the toast container between tests. */
function cleanupToasts() {
  document.getElementById("toast-container")?.remove();
  // `toast-keyframes` used to be a <style> node this module appended at import
  // time. The keyframes are in `app/globals.css` now, so there is nothing left
  // to remove — the line stays as a no-op only if the id ever comes back.
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

  it("carries a live-region role — `status` by default, see the tiering block below", () => {
    // 曾断言恒为 `alert`。现在按类型分档:success / info 用 `status`,
    // 只有 error 用 assertive 的 `alert` —— 一条保存成功不该打断读屏正在读的
    // 句子,而 76 个调用点里 22 个是 success。分档本身有自己的测试。
    const id = showToast("Test message");
    const el = document.getElementById(`toast-${id}`);
    expect(el).not.toBeNull();
    expect(el!.getAttribute("role")).toBe("status");
  });

  it("should display the correct message text", () => {
    showToast("Soul saved successfully");
    const alerts = document.querySelectorAll(".toast");
    expect(alerts.length).toBe(1);
    expect(alerts[0].textContent).toContain("Soul saved successfully");
  });

  it("should render success icon for success type", () => {
    showToast("ok", "success");
    const alerts = document.querySelectorAll(".toast");
    expect(alerts[0].textContent).toContain("✓"); // checkmark
  });

  it("should render error icon for error type", () => {
    showToast("fail", "error");
    const alerts = document.querySelectorAll(".toast");
    expect(alerts[0].textContent).toContain("✕"); // cross
  });

  it("should default to info type", () => {
    showToast("fyi");
    const alerts = document.querySelectorAll(".toast");
    expect(alerts[0].textContent).toContain("ℹ"); // info
  });

  // --- Multiple toasts ---

  it("should support multiple toasts simultaneously", () => {
    showToast("first");
    showToast("second");
    showToast("third");
    const alerts = document.querySelectorAll(".toast");
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

/**
 * 三件此前没有的事:样式在 token 层、role 分档、关闭按钮有名字。
 */
describe("Toast 回到设计系统里", () => {
  beforeEach(() => {
    cleanupToasts();
    jest.useFakeTimers();
  });
  afterEach(() => {
    cleanupToasts();
    jest.useRealTimers();
  });

  it("元素上不带内联样式表,只带类名和一个 token 引用", () => {
    const id = showToast("hello", "error");
    const el = document.getElementById(`toast-${id}`)!;

    expect(el.className).toBe("toast");
    // 唯一允许留在元素上的内联,而且是**token 名字**不是颜色值 —— 三种状态色
    // 因此仍然来自 :root、仍然跟着主题走。
    expect(el.style.getPropertyValue("--toast-accent")).toBe("var(--color-status-error)");
    // 缺席断言,这是这条的要害:五处绕过设计系统的决定就写在这里面
    // (两个 border-radius、一个裸 0.25s 加第三条缓动、一份私有 font-family)。
    expect(el.getAttribute("style")).not.toContain("border-radius");
    expect(el.getAttribute("style")).not.toContain("font-family");
    expect(el.getAttribute("style")).not.toContain("animation");
  });

  it("成功和信息用 status,只有错误用 assertive 的 alert", () => {
    const ok = showToast("saved", "success");
    const info = showToast("fyi", "info");
    const bad = showToast("boom", "error");

    expect(document.getElementById(`toast-${ok}`)!.getAttribute("role")).toBe("status");
    expect(document.getElementById(`toast-${info}`)!.getAttribute("role")).toBe("status");
    // 76 个 showToast 调用点里 22 个传 success。`alert` 会打断读屏正在读的
    // 句子 —— 一条保存成功不值得打断,一条错误值得。
    expect(document.getElementById(`toast-${bad}`)!.getAttribute("role")).toBe("alert");
  });

  it("关闭按钮有名字,也有 type", () => {
    const id = showToast("hello");
    const btn = document.getElementById(`toast-close-${id}`) as HTMLButtonElement;

    // 它是挂在 document.body 上的真 tab 站,此前读作「× button」。
    expect(btn.getAttribute("aria-label")).toBeTruthy();
    expect(btn.getAttribute("aria-label")).not.toBe("×");
    // toast 可能从表单里弹出来,而默认 <button> 会提交表单。
    expect(btn.type).toBe("button");
  });

  it("图标对读屏隐藏 —— role 已经说过一遍了", () => {
    const id = showToast("saved", "success");
    const icon = document.getElementById(`toast-${id}`)!.querySelector(".toast-icon");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("aria-hidden")).toBe("true");
    // 但图标还在,视觉上没被拿掉。
    expect(icon!.textContent).toBe("✓");
  });

  it("离场用一个类,而不是三条内联样式", () => {
    const id = showToast("bye");
    dismissToast(id);

    const el = document.getElementById(`toast-${id}`)!;
    expect(el.className).toContain("toast-leaving");
    // 200ms 曾是第四个裸时长,现在在 .toast-leaving 里走 state 档。
    expect(el.getAttribute("style") ?? "").not.toContain("transition");
  });

  it("模块导入时不再往 head 里插 <style>", () => {
    // 一张在 import 时被塞进去的样式表是另一种「在 token 层之外」:
    // 没有东西扫得到它,而它的时长和缓动是裸 0.25s 加第三条曲线。
    expect(document.getElementById("toast-keyframes")).toBeNull();
  });
});
