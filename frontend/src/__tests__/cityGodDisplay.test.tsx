/**
 * 城隍初审(第五十三批)的两条纯规则:出身地里标出决定归属的地名;编辑抽屉的拒绝按 `code` 取句子。
 */
import { render } from "@testing-library/react";
import { MatchedOrigin, cityGodCaseRefusalMessage, cityGodFieldMessage, cityGodFieldRefusal } from "@/src/components/city-gods/cityGodDisplay";
import { tZh } from "./support/zhBundle";

const marked = (location: string, region: string | null) =>
  Array.from(render(<MatchedOrigin location={location} region={region} />).container.querySelectorAll("[data-matched-region]")).map(
    (el) => el.textContent
  );

describe("MatchedOrigin", () => {
  it("marks the last occurrence of the matched region, and nothing else", () => {
    expect(marked("杭州府杭州县", "杭州")).toEqual(["杭州"]);
    const { container } = render(<MatchedOrigin location="杭州府杭州县" region="杭州" />);
    expect(container.textContent).toBe("杭州府杭州县");
    expect(container.querySelector("[data-matched-region]")?.previousSibling?.textContent).toBe("杭州府");
  });

  it("marks nothing for a default city god's case, and writes a dash for no place", () => {
    expect(marked("四川成都", null)).toEqual([]);
    expect(render(<MatchedOrigin location="  " region={null} />).container.textContent).toBe("—");
  });
});

describe("refusals", () => {
  it("reads the field refusal the serializer writes and names the place and the city god", () => {
    const err = { response: { status: 400, data: { regions: { code: "region_taken", region: "钱塘", regions: ["钱塘"], city_god: "杭州府城隍" } } } };
    const refusal = cityGodFieldRefusal(err);
    expect(refusal?.code).toBe("region_taken");
    expect(cityGodFieldMessage(refusal!, tZh)).toBe("「钱塘」已归杭州府城隍管，一个地名只能属于一位城隍");
    expect(cityGodFieldRefusal({ response: { data: { name: ["This field is required."] } } })).toBeNull();
  });

  it("maps a case refusal by code and falls back for the rest", () => {
    expect(cityGodCaseRefusalMessage({ response: { data: { code: "not_pending" } } }, tZh)).toBe(tZh("cityGodCases.error.not_pending"));
    expect(cityGodCaseRefusalMessage({ response: { data: { code: "something_new" } } }, tZh)).toBe(tZh("judgment.claim.refused.generic"));
  });
});
