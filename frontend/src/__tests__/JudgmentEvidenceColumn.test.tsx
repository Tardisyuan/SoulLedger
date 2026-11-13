/**
 * 事实一栏的编号(Design 第三十七批第 3 条):中文写 一、二、三,别的语言写 1. 2. 3.;分节标 丙 在别的语言里是 C。
 */
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/src/contexts/I18nContext";
import { JudgmentEvidenceColumn } from "@/src/components/judgment/JudgmentEvidenceColumn";

const evidence = { a: "one", b: "two", c: "three" };
const numbers = () => screen.getAllByRole("listitem").map((li) => li.firstElementChild?.textContent);

describe("JudgmentEvidenceColumn numbering", () => {
  it("zh-Hans: 一 二 三 and 丙", () => {
    const { container } = render(
      <I18nProvider initialLocale="zh-Hans">
        <JudgmentEvidenceColumn evidence={evidence} />
      </I18nProvider>
    );
    expect(numbers()).toEqual(["一", "二", "三"]);
    expect(container.querySelector("h2")?.textContent).toMatch(/^丙 · /);
  });

  it.each(["en", "egy"] as const)("%s: 1. 2. 3. and C, no Han", (locale) => {
    const { container } = render(
      <I18nProvider initialLocale={locale}>
        <JudgmentEvidenceColumn evidence={evidence} />
      </I18nProvider>
    );
    expect(numbers()).toEqual(["1.", "2.", "3."]);
    expect(container.querySelector("h2")?.textContent).toMatch(/^C · /);
    expect(numbers().join("")).not.toMatch(/[一二三]/);
  });
});
