/**
 * Design v4 第六十一批 四: the three new rebirth application states on the web -- their tones and where they sit in the
 * filter row (the flow's order), with copy in all three bundles.
 */
import egy from "@soulledger/core/messages/egy.json";
import en from "@soulledger/core/messages/en.json";
import zh from "@soulledger/core/messages/zh-Hans.json";
import { REBIRTH_FILTERS, rebirthTone } from "@/src/components/soul-accounts/soulAccountsView";

const statuses = (bundle: { soul_accounts: { rebirth_status: Record<string, string> } }) => bundle.soul_accounts.rebirth_status;

it("异常处理中 is warn, 复议中 is 审批中's neutral, 已终止 is neutral -- never 已驳回's error", () => {
  expect(rebirthTone("EXCEPTION")).toBe("warning");
  expect(rebirthTone("RECONSIDERING")).toBe(rebirthTone("UNDER_REVIEW"));
  expect(rebirthTone("TERMINATED")).toBe("neutral");
  expect(rebirthTone("TERMINATED")).not.toBe(rebirthTone("REJECTED"));
  expect(rebirthTone("TERMINATED")).not.toBe(rebirthTone("APPEAL_REJECTED"));
});

it("the filters follow the flow: 全部 · 审批中 · 复议中 · 异常处理中 · 申诉中 · 已批准 · 已驳回 · 申诉被驳回 · 已终止", () => {
  expect(REBIRTH_FILTERS).toEqual([
    "",
    "UNDER_REVIEW",
    "RECONSIDERING",
    "EXCEPTION",
    "APPEALING",
    "APPROVED",
    "REJECTED",
    "APPEAL_REJECTED",
    "TERMINATED",
  ]);
});

it("every filter has its label in zh, en and egy (Design's words)", () => {
  const members = REBIRTH_FILTERS.filter(Boolean);
  for (const bundle of [zh, en, egy]) expect(members.filter((m) => !statuses(bundle)[m])).toEqual([]);
  expect([statuses(zh).RECONSIDERING, statuses(zh).EXCEPTION, statuses(zh).TERMINATED]).toEqual(["复议中", "异常处理中", "已终止"]);
  // 复议 is not the soul's 申诉: the two never share a label.
  expect(statuses(zh).RECONSIDERING).not.toBe(statuses(zh).APPEALING);
  expect(statuses(en).RECONSIDERING).not.toBe(statuses(en).APPEALING);
});
