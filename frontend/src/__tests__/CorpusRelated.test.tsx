/**
 * 语料页「相关条目」(src/components/judgment/CorpusRelated.tsx):同门 / 同圈 / 同台阶,
 * 纯前端从 payload 推导。钉住的:只在同一部语料里比;自己不算自己;没有分组的语料
 * 什么都不显示;圈的总条与它的环 / 囊按圈号归到一起。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Statute } from "@soulledger/core/api";
import { CorpusRelated, relatedStatutes } from "@/src/components/judgment/CorpusRelated";
import { I18nProvider } from "@/src/contexts/I18nContext";

const S = (id: string, corpus: string, payload_json: Record<string, unknown>, civilization = "CHINESE") =>
  ({ id, code: id, corpus, civilization, ordinal: 1, payload_json, display_title: `title-${id}` }) as unknown as Statute;

const ALL = [
  S("g1", "GONGGUOGE", { gate: "救濟門", gate_ordinal: 1 }),
  S("g2", "GONGGUOGE", { gate: "救濟門", gate_ordinal: 2 }),
  S("g3", "GONGGUOGE", { gate: "口業門", gate_ordinal: 1 }),
  S("c7", "INFERNO", { circle: 7, parent_code: null }, "EUROPEAN"),
  S("c7r1", "INFERNO", { circle: 7, parent_code: "EU-INF-C7" }, "EUROPEAN"),
  S("c8", "INFERNO", { circle: 8, parent_code: null }, "EUROPEAN"),
  S("t1", "DEADLY_SIN", { terrace_realm_code: "EU_PURGATORY_T1_PRIDE" }, "EUROPEAN"),
  S("t1b", "DEADLY_SIN", { terrace_realm_code: "EU_PURGATORY_T1_PRIDE" }, "EUROPEAN"),
  S("t2", "DEADLY_SIN", { terrace_realm_code: "EU_PURGATORY_T2_ENVY" }, "EUROPEAN"),
  S("gr", "GORGIAS", { stephanus: "523a" }, "GREEK"),
];
const byId = (id: string) => ALL.find((s) => s.id === id)!;
const ids = (id: string) => relatedStatutes(byId(id), ALL)?.rows.map((s) => s.id);

it("same gate, same circle (the circle's article and its rings together), same terrace", () => {
  expect(relatedStatutes(byId("g1"), ALL)?.relation).toBe("gate");
  expect(ids("g1")).toEqual(["g2"]);
  expect(ids("c7r1")).toEqual(["c7"]);
  expect(relatedStatutes(byId("c7"), ALL)?.relation).toBe("circle");
  expect(ids("t1")).toEqual(["t1b"]);
  expect(relatedStatutes(byId("t1"), ALL)?.relation).toBe("terrace");
});

it("nothing when alone in its group, or when the corpus has no grouping", () => {
  expect(relatedStatutes(byId("g3"), ALL)).toBeNull();
  expect(relatedStatutes(byId("c8"), ALL)).toBeNull();
  expect(relatedStatutes(byId("gr"), ALL)).toBeNull();
});

it("renders the caption and opens a related article", () => {
  const onChoose = jest.fn();
  render(
    <I18nProvider>
      <CorpusRelated statute={byId("c7")} all={ALL} onChoose={onChoose} />
    </I18nProvider>
  );
  const box = screen.getByTestId("corpus-related");
  expect(box).toHaveTextContent("同圈");
  // Only the ring: not the article itself, not another circle's.
  expect(within(box).getAllByRole("button")).toHaveLength(1);
  expect(within(box).queryByText("title-c8")).toBeNull();
  fireEvent.click(within(box).getByRole("button", { name: /title-c7r1/ }));
  expect(onChoose).toHaveBeenCalledWith("c7r1");
});
