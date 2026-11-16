/**
 * 「最近用过」的驳回理由(D8;Design 第五十二批 F1、第五十六批):每位官员自己的三条,只在这台浏览器里,
 * 读写都兜住。点一行填进空框,框里有字就另起一行加在后面。
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { readReasons, rememberReason, withReason } from "@/src/lib/recentRejectReasons";
import { RecentReasons } from "@/src/components/approval/RecentReasons";
import { tZh } from "./support/zhBundle";

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ actual: true, zh: "stable", locale: "zh-Hans", hydrated: true }));

beforeEach(() => window.localStorage.clear());

describe("the store", () => {
  it("keeps the newest three, once each, per officer", () => {
    for (const r of ["一", "二", "三", "四"]) rememberReason(7, r);
    rememberReason(7, " 二 ");
    expect(readReasons(7)).toEqual(["二", "四", "三"]);
    // Another officer on the same browser reads nothing of these.
    expect(readReasons(8)).toEqual([]);
  });

  it("does not remember without an officer, nor a blank reason", () => {
    rememberReason(undefined, "无主");
    rememberReason(7, "   ");
    expect(window.localStorage.length).toBe(0);
    expect(readReasons(undefined)).toEqual([]);
  });

  it("drops what it did not write and survives storage that throws", () => {
    window.localStorage.setItem("soulledger.reject.recent.7", JSON.stringify(["好", 3, "", "x".repeat(2001)]));
    expect(readReasons(7)).toEqual(["好"]);
    window.localStorage.setItem("soulledger.reject.recent.7", "{not json");
    expect(readReasons(7)).toEqual([]);
    const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => rememberReason(7, "写不进")).not.toThrow();
    spy.mockRestore();
  });

  it("fills an empty box and adds under what is there", () => {
    expect(withReason("", "材料不全")).toBe("材料不全");
    expect(withReason("  ", "材料不全")).toBe("材料不全");
    expect(withReason("先说一句", "材料不全")).toBe("先说一句\n材料不全");
    expect(withReason("ab", "cd", 4)).toBe("ab\nc");
  });
});

function Box({ userId }: { userId: number }) {
  const [value, setValue] = useState("");
  return (
    <>
      <RecentReasons userId={userId} value={value} onChange={setValue} />
      <textarea aria-label="reason" value={value} readOnly />
    </>
  );
}

describe("the rows", () => {
  it("draw nothing when there is nothing remembered", () => {
    render(<Box userId={7} />);
    expect(screen.queryByTestId("recent-reasons")).toBeNull();
  });

  it("one tap fills, a second adds on a new line, and the row stays", () => {
    rememberReason(7, "旧理由");
    rememberReason(7, "新理由");
    render(<Box userId={7} />);
    expect(screen.getByText(tZh("officer_app.confirm.recent_reasons"))).toBeInTheDocument();
    const rows = screen.getAllByRole("button");
    expect(rows.map((b) => b.textContent)).toEqual(["↺新理由", "↺旧理由"]);
    fireEvent.click(screen.getByRole("button", { name: tZh("officer_app.confirm.recent_aria", { text: "新理由" }) }));
    expect(screen.getByLabelText("reason")).toHaveValue("新理由");
    fireEvent.click(screen.getByTestId("recent-reason-1"));
    expect(screen.getByLabelText("reason")).toHaveValue("新理由\n旧理由");
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("are outlined, radius 4, full width (第五十六批)", () => {
    rememberReason(7, "理由");
    render(<Box userId={7} />);
    expect(screen.getByTestId("recent-reason-0").className).toEqual(expect.stringContaining("rounded-control"));
    expect(screen.getByTestId("recent-reason-0").className).toEqual(expect.stringContaining("w-full"));
    expect(screen.getByTestId("recent-reason-0").className).toEqual(expect.stringContaining("border"));
  });
});
