/**
 * 页面单键快捷键(src/lib/hotkeys.ts):审判台的 1–4 / ⌘⏎、审判队列的 Q。
 *
 * 要守的是「不抢打字」:焦点在文本框里时单键不接,⌘⏎ 例外;单选框不算打字。
 * 每条都断言了反面 —— 只断「按了会触发」的测试,在一个什么键都接的实现上也是绿的。
 */
import { fireEvent, render } from "@testing-library/react";
import { hotkeyOf, isTypingTarget, useHotkeys } from "@/src/lib/hotkeys";

function Harness({ handlers, enabled = true }: { handlers: Record<string, () => void>; enabled?: boolean }) {
  useHotkeys(handlers, enabled);
  return (
    <div>
      <textarea aria-label="notes" />
      <input aria-label="search" type="search" />
      <input aria-label="verdict" type="radio" name="v" />
      <button type="button">plain</button>
    </div>
  );
}

function setup(enabled = true) {
  const one = jest.fn();
  const q = jest.fn();
  const submit = jest.fn();
  const utils = render(<Harness handlers={{ "1": one, q, "mod+Enter": submit }} enabled={enabled} />);
  return { one, q, submit, ...utils };
}

describe("useHotkeys", () => {
  it("fires a single key when focus is on the page", () => {
    const { one, q } = setup();
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Q" });
    expect(one).toHaveBeenCalledTimes(1);
    expect(q).toHaveBeenCalledTimes(1);
  });

  it("does not take single keys while the operator is typing", () => {
    const { one, q, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("notes"), { key: "1" });
    fireEvent.keyDown(getByLabelText("search"), { key: "q" });
    expect(one).not.toHaveBeenCalled();
    expect(q).not.toHaveBeenCalled();
  });

  it("still takes digits on a focused radio — it does not take text", () => {
    const { one, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("verdict"), { key: "1" });
    expect(one).toHaveBeenCalledTimes(1);
  });

  it("takes ⌘⏎ / Ctrl⏎ even inside the textarea, and plain Enter nowhere", () => {
    const { submit, getByLabelText } = setup();
    fireEvent.keyDown(getByLabelText("notes"), { key: "Enter", metaKey: true });
    fireEvent.keyDown(document.body, { key: "Enter", ctrlKey: true });
    expect(submit).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(getByLabelText("notes"), { key: "Enter" });
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it("lets modified single keys through to the browser (⌘1 switches tabs)", () => {
    const { one } = setup();
    fireEvent.keyDown(document.body, { key: "1", metaKey: true });
    fireEvent.keyDown(document.body, { key: "1", altKey: true });
    expect(one).not.toHaveBeenCalled();
  });

  it("ignores auto-repeat and does nothing when disabled", () => {
    const a = setup();
    fireEvent.keyDown(document.body, { key: "1", repeat: true });
    expect(a.one).not.toHaveBeenCalled();
    a.unmount();

    const b = setup(false);
    fireEvent.keyDown(document.body, { key: "1" });
    fireEvent.keyDown(document.body, { key: "Enter", metaKey: true });
    expect(b.one).not.toHaveBeenCalled();
    expect(b.submit).not.toHaveBeenCalled();
  });
});

describe("hotkeyOf / isTypingTarget", () => {
  it("names keys the way handlers are registered", () => {
    expect(hotkeyOf(new KeyboardEvent("keydown", { key: "Q" }))).toBe("q");
    expect(hotkeyOf(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }))).toBe("mod+Enter");
    expect(hotkeyOf(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true }))).toBeNull();
  });

  it("counts text fields as typing and choice controls as not", () => {
    const make = (tag: string, type?: string) => {
      const el = document.createElement(tag);
      if (type) (el as HTMLInputElement).type = type;
      return el;
    };
    expect(isTypingTarget(make("textarea"))).toBe(true);
    expect(isTypingTarget(make("input", "text"))).toBe(true);
    expect(isTypingTarget(make("select"))).toBe(true);
    expect(isTypingTarget(make("input", "radio"))).toBe(false);
    expect(isTypingTarget(make("input", "checkbox"))).toBe(false);
    expect(isTypingTarget(make("button"))).toBe(false);
  });
});
