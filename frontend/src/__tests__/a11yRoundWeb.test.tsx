/** Screen-reader basics: the grid search box is named, and each language option is read in its own language. */
import { render, screen } from "@testing-library/react";
import { FilterBar } from "@/src/components/ui/FilterChip";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LOCALE_LABELS } from "@soulledger/core/config/locale";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@soulledger/core/config/locale"),
  useI18n: () => ({ locale: "zh-Hans", setLocale: jest.fn(), hydrated: true, t: (k: string) => k }),
}));

it("the FilterBar's dimension select has an accessible name (its visible 「状态 ·」 is aria-hidden)", () => {
  render(
    <FilterBar
      selects={[{ label: "状态", value: "", options: [{ value: "", label: "全部" }], onChange: jest.fn(), clearLabel: "清除状态筛选" }]}
    />
  );
  expect(screen.getAllByRole("combobox", { name: "状态" }).length).toBeGreaterThan(0);
});

it("LanguageSwitcher options carry lang (Kemet's text is English, so en)", () => {
  render(<LanguageSwitcher />);
  const lang = (name: string) => screen.getByRole("option", { name }).getAttribute("lang");
  expect([lang(LOCALE_LABELS["zh-Hans"]), lang(LOCALE_LABELS.en), lang(LOCALE_LABELS.egy)]).toEqual(["zh-Hans", "en", "en"]);
});

it("only the egy option says it is a demonstration language, not real ancient Egyptian", () => {
  render(<LanguageSwitcher />);
  const title = (name: string) => screen.getByRole("option", { name }).getAttribute("title");
  expect([title(LOCALE_LABELS["zh-Hans"]), title(LOCALE_LABELS.en), title(LOCALE_LABELS.egy)]).toEqual([null, null, "nav.language_egy_note"]);
  expect(screen.getByRole("combobox")).toHaveAttribute("title", "nav.language_egy_note");
});
