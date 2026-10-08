/**
 * The one code box of A12 (`src/components/auth/CodeInput.tsx`): paste strips spaces and
 * dashes, six digits auto-submit exactly once, the label / hint / error wiring is the
 * accessible kind, and the recovery variant lower-cases, drops the dash and never auto-submits.
 */
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CodeInput, normalizeCode } from "@/src/components/auth/CodeInput";

function paste(el: HTMLElement, text: string) {
  fireEvent.paste(el, { clipboardData: { getData: () => text } });
}

describe("normalizeCode", () => {
  it("strips spaces and every dash shape, keeps digits only for totp, caps at six", () => {
    expect(normalizeCode("123 456", "totp")).toBe("123456");
    expect(normalizeCode("123-456", "totp")).toBe("123456");
    expect(normalizeCode("123–456", "totp")).toBe("123456");
    expect(normalizeCode("1234567", "totp")).toBe("123456");
    expect(normalizeCode("12a3", "totp")).toBe("123");
  });
  it("lower-cases a recovery code and makes the dash optional", () => {
    expect(normalizeCode("ABCD-EFGH", "recovery")).toBe("abcdefgh");
    expect(normalizeCode("abcd efgh", "recovery")).toBe("abcdefgh");
    expect(normalizeCode("abcdefghij", "recovery")).toBe("abcdefgh");
  });
});

describe("CodeInput (totp)", () => {
  function setup(over: Partial<React.ComponentProps<typeof CodeInput>> = {}) {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const ref = createRef<HTMLInputElement>();
    const { rerender } = render(
      <CodeInput ref={ref} kind="totp" label="动态码" hint="六位" value="" onChange={onChange} onComplete={onComplete} {...over} />
    );
    return { onChange, onComplete, ref, rerender };
  }

  it("is a single numeric one-time-code input, labelled and described", () => {
    setup();
    const input = screen.getByLabelText("动态码") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.maxLength).toBe(6);
    expect(screen.getByText("六位").id).toBe(input.getAttribute("aria-describedby"));
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(1);
  });

  it("paste strips spaces and dashes and auto-submits once at six digits", () => {
    const { onChange, onComplete } = setup();
    paste(screen.getByLabelText("动态码"), "123 456");
    expect(onChange).toHaveBeenLastCalledWith("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("does not auto-submit before six digits", () => {
    const { onChange, onComplete } = setup();
    fireEvent.change(screen.getByLabelText("动态码"), { target: { value: "12345" } });
    expect(onChange).toHaveBeenLastCalledWith("12345");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("marks itself invalid when the owner passes an error, and exposes the ref for focus + select", () => {
    const { ref } = setup({ error: "wrong", value: "123456" });
    const input = screen.getByLabelText("动态码") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(ref.current).toBe(input);
  });
});

describe("CodeInput (recovery)", () => {
  it("lower-cases, drops the dash, allows letters and never auto-submits", () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    render(<CodeInput kind="recovery" label="恢复码" value="" onChange={onChange} onComplete={onComplete} />);
    const input = screen.getByLabelText("恢复码") as HTMLInputElement;
    expect(input.getAttribute("inputmode")).toBe("text");
    paste(input, "ABCD-EFGH");
    expect(onChange).toHaveBeenLastCalledWith("abcdefgh");
    expect(onComplete).not.toHaveBeenCalled();
  });
});
