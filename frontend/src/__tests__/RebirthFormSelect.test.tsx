/**
 * Tests for the 六道 picker (src/components/souls/RebirthFormSelect.tsx).
 *
 * The gap this component closes: app/souls/[id]/page.tsx posted a hardcoded
 * `rebirth_form: "HUMAN"`, so every rebirth the product performed went into
 * 人道 regardless of the six paths the backend enum offers. These pin the
 * three things that can silently regress it — all six paths offered, the
 * legacy OTHER value never offered, and the existing `reincarnation.forms.*`
 * message keys actually asked for rather than re-invented.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { I18nProvider } from "@/src/contexts/I18nContext";
import {
  RebirthFormSelect,
  SIX_PATHS,
  THREE_GOOD_PATHS,
  THREE_EVIL_PATHS,
  DEFAULT_REBIRTH_FORM,
  type RebirthFormValue,
} from "@/src/components/souls/RebirthFormSelect";

/**
 * No provider, deliberately. The i18n context's DEFAULT `t` echoes every key
 * back — the same answer the real one gives for a key no bundle has — so `tf`
 * takes its fallback branch here and every option renders as its raw enum
 * name. That is what lets the assertions below name `SIX_PATHS` directly
 * instead of locale copy. The one case that needs real translations mounts a
 * real `I18nProvider`; nothing in this file re-implements `tf`.
 */
function renderSelect(
  overrides: Partial<React.ComponentProps<typeof RebirthFormSelect>> = {}
) {
  const onChange = jest.fn();
  const utils = render(
    <RebirthFormSelect
      value={DEFAULT_REBIRTH_FORM}
      onChange={onChange}
      {...overrides}
    />
  );
  return { onChange, ...utils };
}

describe("RebirthFormSelect", () => {
  it("offers all six paths and nothing else", () => {
    renderSelect();
    const options = screen.getAllByRole("radio");
    expect(options).toHaveLength(6);
    expect(options.map((o) => o.textContent)).toEqual([...SIX_PATHS]);
  });

  it("never offers OTHER — it is a legacy stored value, not a seventh path", () => {
    renderSelect();
    // Belt and braces: the constant must not contain it, and nothing rendered
    // may say it. The backend rejects OTHER on write, so an option for it
    // would only manufacture 400s.
    expect(SIX_PATHS).not.toContain("OTHER");
    expect(screen.queryByText(/OTHER/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(SIX_PATHS.length);
  });

  it("groups the six as 三善道 / 三恶道 in doctrinal order", () => {
    // docs/07_六道轮回详解.md §一: 天道/人道/阿修罗道, then 畜生道/饿鬼道/地狱道.
    expect([...THREE_GOOD_PATHS]).toEqual(["DIVINE", "HUMAN", "ASURA"]);
    expect([...THREE_EVIL_PATHS]).toEqual(["ANIMAL", "HUNGRY_GHOST", "HELL_BEING"]);
    renderSelect();
    expect(screen.getByText("三善道")).toBeInTheDocument();
    expect(screen.getByText("三恶道")).toBeInTheDocument();
  });

  it("asks for the message keys that already exist, not new ones", () => {
    // Was a spy on a `tf` prop, counting the key strings it was handed. The
    // prop is gone — `tf` comes off the i18n context now — and a spy would in
    // any case only have proved which strings were passed to a double. This
    // mounts the REAL provider over the REAL bundle: a key this component
    // invented finds nothing, falls back, and shows the raw enum name.
    render(
      <I18nProvider initialLocale="zh-Hans">
        <RebirthFormSelect value={DEFAULT_REBIRTH_FORM} onChange={() => {}} />
      </I18nProvider>
    );
    const labels = screen.getAllByRole("radio").map((o) => o.textContent);
    expect(labels).toEqual(SIX_PATHS.map((form) => zh.reincarnation.forms[form]));
    // Absence, twice over. 未分类 is the copy for the legacy OTHER value, which
    // is not a seventh path; and no option fell through to its raw enum name,
    // which is precisely what a made-up key would look like on screen.
    expect(screen.queryByText(zh.reincarnation.forms.OTHER)).not.toBeInTheDocument();
    for (const form of SIX_PATHS) {
      expect(labels).not.toContain(form);
    }
  });

  it("marks the current value checked and reports a new one", async () => {
    const { onChange } = renderSelect({ value: "HUMAN" });

    expect(screen.getByRole("radio", { name: "HUMAN" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "HELL_BEING" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "HELL_BEING" }));
    expect(onChange).toHaveBeenCalledWith("HELL_BEING");
  });

  it("defaults to 人道 — the ordinary case, now a default rather than the only outcome", () => {
    const value: RebirthFormValue = DEFAULT_REBIRTH_FORM;
    expect(value).toBe("HUMAN");
    renderSelect();
    expect(screen.getByRole("radio", { name: "HUMAN" })).toBeChecked();
  });

  it("does not report a change while an action is in flight", async () => {
    const { onChange } = renderSelect({ disabled: true });
    fireEvent.click(screen.getByRole("radio", { name: "ASURA" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("tints the selected option at no more than 10%", () => {
    // Same cap as src/__tests__/dataGridToneContract.test.ts: the light-mode
    // --color-status-* tokens were re-measured for AA against a 0.1 fill, so a
    // deeper tint here would invalidate them just as it did in the data grid.
    renderSelect({ value: "DIVINE" });
    for (const el of screen.getAllByRole("radio")) {
      for (const [, alpha] of el.className.matchAll(
        /bg-\[hsl\(var\(--color-status-[\w-]+\)\/([\d.]+)\)\]/g
      )) {
        expect(Number(alpha)).toBeLessThanOrEqual(0.1);
      }
    }
  });
});

/**
 * `role="radiogroup"` 承诺的键盘契约。
 *
 * 一个 radio group 是**一个** tab 站加方向键选择。改动前这里是六个按钮全都是
 * tab 站,而方向键什么都不做 —— 选择是能用的,`aria-checked` 也是真的,所以
 * 没有东西够不着;错的是**宣告的导航模型不是实现的导航模型**。和 2026-09-01
 * 那轮修的两个 `role="menu"` 是同一类。
 */
describe("六道 picker:radiogroup 的键盘契约", () => {
  const radios = () => screen.getAllByRole("radio");

  it("整组只有一个 tab 站,而且是选中的那个", () => {
    render(<RebirthFormSelect value={SIX_PATHS[2]} onChange={() => {}} />);

    const stops = radios().filter((el) => el.getAttribute("tabindex") === "0");
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAttribute("aria-checked", "true");
    // 缺席断言:其余五个必须是 -1。只断言「有一个是 0」在六个都是 0 的实现下
    // 同样会绿 —— 那正是改动前的样子。
    expect(radios().filter((el) => el.getAttribute("tabindex") === "-1")).toHaveLength(
      SIX_PATHS.length - 1
    );
  });

  it("value 不在六道里时,组仍然够得着", () => {
    // `selectedIndex` 回落到 0。没有这一条,一个陈旧的 OTHER 值会让整组
    // 六个 tabIndex 全是 -1 —— 键盘再也进不去。
    render(<RebirthFormSelect value={"OTHER" as RebirthFormValue} onChange={() => {}} />);
    expect(radios().filter((el) => el.getAttribute("tabindex") === "0")).toHaveLength(1);
  });

  it("方向键在六道之间移动,并且跨过分组边界", () => {
    const onChange = jest.fn();
    // 三善道的最后一个 —— 下一个方向键要落到三恶道的第一个。
    render(<RebirthFormSelect value={THREE_GOOD_PATHS[2]} onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("radio", { name: THREE_GOOD_PATHS[2] }), {
      key: "ArrowRight",
    });

    // 分组是一个选择的视觉分组,不是三个选择。
    expect(onChange).toHaveBeenCalledWith(THREE_EVIL_PATHS[0]);
  });

  it("首尾回绕,Home / End 直达两端", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <RebirthFormSelect value={SIX_PATHS[0]} onChange={onChange} />
    );

    fireEvent.keyDown(screen.getByRole("radio", { name: SIX_PATHS[0] }), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(SIX_PATHS[SIX_PATHS.length - 1]);

    rerender(<RebirthFormSelect value={SIX_PATHS[3]} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole("radio", { name: SIX_PATHS[3] }), { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(SIX_PATHS[0]);

    fireEvent.keyDown(screen.getByRole("radio", { name: SIX_PATHS[3] }), { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(SIX_PATHS[SIX_PATHS.length - 1]);
  });

  it("禁用时方向键不改值", () => {
    const onChange = jest.fn();
    render(<RebirthFormSelect value={DEFAULT_REBIRTH_FORM} onChange={onChange} disabled />);

    fireEvent.keyDown(screen.getByRole("radio", { name: DEFAULT_REBIRTH_FORM }), {
      key: "ArrowRight",
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("组名不被读两遍", () => {
    // 可见标题和组的 aria-label 是同一串字。没有 aria-hidden,读屏会连着读
    // 两次同样的词。
    const { container } = render(
      <RebirthFormSelect value={DEFAULT_REBIRTH_FORM} onChange={() => {}} />
    );
    const group = screen.getByRole("radiogroup");
    const heading = container.querySelector("p[aria-hidden='true']");
    expect(heading).not.toBeNull();
    expect(heading!.textContent).toBe(group.getAttribute("aria-label"));
  });
});
