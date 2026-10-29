/** 城隍初审:解送 / 退回只给持 judgment.execute 的人画(后端 city_god_views 两个动作都要它;RBAC A6)。 */
import { screen } from "@testing-library/react-native";

import { CityGodCase } from "../screens/cityGod";
import { OFFICER, renderOfficer } from "./harness";

jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  cityGodCasesApi: {
    get: jest.fn(async () => ({
      data: {
        id: "cg-1", case_number: "CN-1", city_god_name: "城隍甲", soul_name: "李白", city_god_status: "PENDING", untimely: false,
        origin_location: "长安", soul_birth_year: 701, soul_death_year: 762, soul_fated_death_year: 762, registered_via: "MANUAL",
        created_at: "2026-10-09T01:00:00Z", can_act: true, returned_at: null, city_god_note: "",
      },
    })),
  },
}));

const view = (permissions: string[]) => renderOfficer(<CityGodCase id="cg-1" onSettled={() => {}} onDone={() => {}} />, { user: { ...OFFICER, permissions } });

it("without judgment.execute: the case, but no 解送 / 退回", async () => {
  view(["judgment.read"]);
  expect(await screen.findByTestId("city-god-case")).toBeTruthy();
  expect(screen.queryByTestId("city-god-send-on")).toBeNull();
  expect(screen.queryByTestId("city-god-return")).toBeNull();
});

it("with judgment.execute: both", async () => {
  view(["judgment.read", "judgment.execute"]);
  expect(await screen.findByTestId("city-god-send-on")).toBeTruthy();
  expect(screen.getByTestId("city-god-return")).toBeTruthy();
});
