/**
 * 提交被拒之后,焦点去哪。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 审计说「13 个表单里只有 1 个移动焦点」。数目对,推论不对 —— 记在这里。
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 实际查过之后:那 13 个里有 10 个把错误报成 **toast**(`UserModal` 一个文件
 * 里就有五处 `showToast(..., "error")`),而不是逐字段的错误。它们不移动焦点,
 * 是因为**没有可以移过去的字段**。toast 自带 live region,读屏听得到。
 *
 * 真正有逐字段错误、因而真的欠一次移焦的,是三处:
 *
 *   app/dispatch/propose      早就做了,但带着一张手写的字段名清单
 *   app/(auth)/login          `useFormValidation` → `Field` → aria-invalid
 *   两个 permissions modal    只有**表单级**一条消息,所以退回到消息本身
 *
 * 这个套件测的是这三处共用的那个模块。剩下十个的问题是「错误只走 toast」,
 * 那是另一件事,不在这次改动里 —— 写出来,而不是让人以为它被覆盖了。
 */
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useRef, useState } from "react";

import { focusFirstInvalid, useSubmitErrorFocus } from "@/src/lib/submitErrorFocus";

describe("focusFirstInvalid", () => {
  it("按 DOM 顺序取第一个 invalid 控件,而不是按声明顺序", () => {
    const { container } = render(
      <form>
        <input aria-label="a" />
        <input aria-label="b" aria-invalid="true" />
        <input aria-label="c" aria-invalid="true" />
      </form>
    );

    expect(focusFirstInvalid(container.firstChild as HTMLElement)).toBe(true);
    // DOM 顺序即视觉顺序 —— 这正是它取代那张 `order = [...]` 手写清单的理由:
    // 清单要和表单结构保持同步,而没有任何东西会在它们分岔时报红。
    expect(screen.getByLabelText("b")).toHaveFocus();
  });

  it("aria-invalid 挂在包裹层上时,取它里面第一个能聚焦的", () => {
    const { container } = render(
      <form>
        <div aria-invalid="true">
          <span>not focusable</span>
          <input aria-label="inner" />
        </div>
      </form>
    );

    expect(focusFirstInvalid(container.firstChild as HTMLElement)).toBe(true);
    expect(screen.getByLabelText("inner")).toHaveFocus();
  });

  it("没有 invalid 时返回 false —— 调用方据此决定要不要退回别处", () => {
    const { container } = render(
      <form>
        <input aria-label="a" />
      </form>
    );

    // 返回值不是装饰:两个 permissions modal 靠它才知道该去聚焦那条表单级消息。
    expect(focusFirstInvalid(container.firstChild as HTMLElement)).toBe(false);
    expect(screen.getByLabelText("a")).not.toHaveFocus();
  });

  it("root 为 null 时不炸", () => {
    expect(focusFirstInvalid(null)).toBe(false);
  });
});

describe("useSubmitErrorFocus", () => {
  /** 逐字段错误的表单 —— login 的形状。 */
  function PerField() {
    const [bad, setBad] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);
    useSubmitErrorFocus(bad, formRef);
    return (
      <form ref={formRef}>
        <input aria-label="name" aria-invalid={bad ? "true" : undefined} />
        <button type="button" onClick={() => setBad(true)}>
          submit
        </button>
      </form>
    );
  }

  /** 只有一条表单级消息的表单 —— 两个 permissions modal 的形状。 */
  function FormLevel() {
    const [bad, setBad] = useState(false);
    const formRef = useRef<HTMLFormElement>(null);
    const errorRef = useRef<HTMLParagraphElement>(null);
    useSubmitErrorFocus(bad, formRef, errorRef);
    return (
      <form ref={formRef}>
        {bad && (
          <p ref={errorRef} tabIndex={-1} role="alert">
            codename already taken
          </p>
        )}
        <input aria-label="codename" />
        <button type="button" onClick={() => setBad(true)}>
          submit
        </button>
      </form>
    );
  }

  it("有逐字段错误时,焦点从提交按钮移到那个字段", async () => {
    render(<PerField />);
    const submit = screen.getByText("submit");
    submit.focus();
    expect(submit).toHaveFocus();

    await act(async () => {
      fireEvent.click(submit);
    });

    // 缺陷版本里焦点留在按钮上 —— 而在 `BaseModal` 的可滚动正文里,错误可能
    // 就在焦点位置的视野之外:按了一下,什么都没变,变了的那部分看不见。
    expect(screen.getByLabelText("name")).toHaveFocus();
  });

  it("只有表单级消息时,焦点落在消息上而不是任何字段上", async () => {
    render(<FormLevel />);
    const submit = screen.getByText("submit");
    submit.focus();

    await act(async () => {
      fireEvent.click(submit);
    });

    expect(screen.getByRole("alert")).toHaveFocus();
    // 缺席断言:字段不许被聚焦,因为这条错误不是关于哪一个字段的。
    // 原先的实现把这条消息挂在**每个** input 的 aria-invalid 上,于是一次
    // 码名冲突会告诉读屏用户 name 和 category 也是坏的。
    expect(screen.getByLabelText("codename")).not.toHaveFocus();
  });

  it("没有错误时什么都不动", async () => {
    render(<PerField />);
    const submit = screen.getByText("submit");
    submit.focus();

    // 不点提交:effect 的条件是 hasError,不是「渲染了」。
    expect(submit).toHaveFocus();
  });
});
