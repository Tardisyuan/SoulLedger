/**
 * 灵魂详情身份栏:欧洲灵魂的受洗与否认灵魂不灭(E-2,2026-10-28 用户决定)。
 * 登记了才画;未登记(UNRECORDED / null)不画;别的文明即使字段有值也不画(编辑弹层同样只对欧洲)。
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Soul } from "@soulledger/core/api";
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: tZh,
    tf: (_k: string, f: string) => f,
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: string) => v,
    formatDateTime: (v: string) => v,
  }),
}));

import { SoulInfoCard } from "@/src/components/souls/detail/SoulInfoCard";

const SOUL = {
  id: "s1",
  name: "Virgil",
  civilization: "EUROPEAN",
  current_state: "JUDGING",
  birth_date: null,
  death_date: null,
  origin_location: "Mantua",
  origin_region: "",
  description: "",
  merit_score: 0,
  demerit_score: 0,
  date_problems: [],
  is_eval_identity: false,
  baptism: "UNRECORDED",
  denied_immortality: null,
} as unknown as Soul;

function card(soul: Partial<Soul>) {
  const client = new QueryClient();
  const ui: ReactNode = (
    <SoulInfoCard soul={{ ...SOUL, ...soul } as Soul} loading={false} birthDisplay={null} deathDisplay={null} />
  );
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("SoulInfoCard:受洗 / 否认灵魂不灭", () => {
  it("登记了的欧洲灵魂:两行都在,写的是词不是原值", () => {
    card({ baptism: "BEFORE_CHRIST", denied_immortality: true } as Partial<Soul>);
    expect(screen.getByTestId("soul-baptism")).toHaveTextContent("受洗生于基督之前");
    expect(screen.getByTestId("soul-denied-immortality")).toHaveTextContent("否认灵魂不灭是");
  });

  it("否认灵魂不灭登记为「否」也是登记了", () => {
    card({ denied_immortality: false } as Partial<Soul>);
    expect(screen.getByTestId("soul-denied-immortality")).toHaveTextContent("否认灵魂不灭否");
    expect(screen.queryByTestId("soul-baptism")).toBeNull();
  });

  it("未登记(UNRECORDED / null):两行都不画", () => {
    card({});
    expect(screen.queryByTestId("soul-baptism")).toBeNull();
    expect(screen.queryByTestId("soul-denied-immortality")).toBeNull();
    expect(screen.queryByText("受洗")).toBeNull();
  });

  it.each(["CHINESE", "GREEK", "EGYPTIAN"])("%s 灵魂即使字段有值也不画", (civilization) => {
    card({ civilization, baptism: "UNBAPTISED", denied_immortality: true } as Partial<Soul>);
    expect(screen.queryByTestId("soul-baptism")).toBeNull();
    expect(screen.queryByTestId("soul-denied-immortality")).toBeNull();
  });
});

describe("SoulInfoCard:中立者与过河(2026-10-28)", () => {
  it("欧洲灵魂登记了中立者:画一行,写词不写原值", () => {
    card({ neutral_in_life: true } as Partial<Soul>);
    expect(screen.getByTestId("soul-neutral-in-life")).toHaveTextContent("中立者是");
  });

  it("中立者未登记,或不是欧洲灵魂:不画", () => {
    card({ neutral_in_life: null } as Partial<Soul>);
    expect(screen.queryByTestId("soul-neutral-in-life")).toBeNull();
  });

  it("希腊灵魂未葬:画过河一行;已葬(空)不画", () => {
    card({ civilization: "GREEK", ferry_passage: "UNBURIED" } as Partial<Soul>);
    expect(screen.getByTestId("soul-ferry-passage")).toHaveTextContent("过河未葬");
    expect(screen.queryByText("UNBURIED")).toBeNull();
  });

  it("希腊灵魂已葬有渡资:不画", () => {
    card({ civilization: "GREEK", ferry_passage: "" } as Partial<Soul>);
    expect(screen.queryByTestId("soul-ferry-passage")).toBeNull();
  });
});
