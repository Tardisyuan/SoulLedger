import { workflowTitle } from "@/src/components/workflow/workflowTitle";
import { tZh } from "./support/zhBundle";

const wf = { workflow_name: "转生申请: YX39MP69VW", case_type: "REBIRTH_APPLICATION", soul_name: "李四" };

describe("workflowTitle", () => {
  it("writes 「转生申请 · 名」 from the soul, not the stored 「转生申请: 码」", () => {
    expect(workflowTitle(wf, tZh)).toBe("转生申请 · 李四");
  });
  it("an appeal has its own wording", () => {
    expect(workflowTitle({ ...wf, is_appeal: true }, tZh)).toBe("转生申请申诉 · 李四");
  });
  it("other case types and a missing soul name keep the stored name", () => {
    expect(workflowTitle({ ...wf, case_type: "ROUTINE", workflow_name: "常规" }, tZh)).toBe("常规");
    expect(workflowTitle({ ...wf, soul_name: undefined }, tZh)).toBe("转生申请: YX39MP69VW");
  });
});
