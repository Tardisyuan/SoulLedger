/**
 * 城隍编辑抽屉的「下属诸司」(Design 第五十七批 D-3):7 组默认收起、组头「已选 / 共有」、按级别预设,
 * 会替换现有勾选时先确认。`t` echoes the key and its params.
 */
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CITY_GOD_BUREAU_PRESETS } from "@soulledger/core/domain/cityGods";
import { BureauPicker } from "@/src/components/city-gods/CityGodEditor";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k), locale: "zh-Hans", hydrated: true }),
}));

let latest: string[] = [];
function Harness({ rank, initial }: { rank: string; initial: string[] }) {
  const [bureaus, setBureaus] = useState(initial);
  latest = bureaus;
  return <BureauPicker rank={rank} bureaus={bureaus} onChange={setBureaus} />;
}

it("seven groups start closed; each head says selected / total", () => {
  render(<Harness rank="COUNTY" initial={["GONGCAO", "JIBU"]} />);
  const heads = screen.getAllByRole("button", { expanded: false });
  expect(heads).toHaveLength(7);
  expect(document.querySelectorAll("[data-bureau]")).toHaveLength(0);
  const personnel = heads.find((b) => b.getAttribute("data-ministry") === "PERSONNEL")!;
  expect(within(personnel).getByTestId("ministry-count")).toHaveTextContent('"selected":"2","total":"4"');
  fireEvent.click(personnel);
  expect(personnel).toHaveAttribute("aria-expanded", "true");
  expect(document.querySelectorAll("[data-bureau]")).toHaveLength(4);
});

it("the preset ticks the rank's bureaus straight away when nothing is ticked", () => {
  render(<Harness rank="COUNTY" initial={[]} />);
  fireEvent.click(screen.getByTestId("city-god-bureau-preset"));
  expect([...latest].sort()).toEqual([...CITY_GOD_BUREAU_PRESETS.COUNTY].sort());
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("replacing ticks the officer made asks first", async () => {
  render(<Harness rank="PREFECTURE" initial={["CIJI"]} />);
  fireEvent.click(screen.getByTestId("city-god-bureau-preset"));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent('cityGods.bureaus_preset_confirm|{"n":"1"}');
  expect(latest).toEqual(["CIJI"]);
  fireEvent.click(within(dialog).getAllByRole("button").find((b) => b.textContent?.startsWith("cityGods.bureaus_preset"))!);
  expect(latest).toHaveLength(23);
});

it("no rank, no preset button", () => {
  render(<Harness rank="" initial={[]} />);
  expect(screen.queryByTestId("city-god-bureau-preset")).toBeNull();
});
