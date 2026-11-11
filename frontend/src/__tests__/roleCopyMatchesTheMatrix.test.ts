/**
 * @jest-environment node
 *
 * Copy that names who may do something has to name a holder that exists in the default matrix
 * (backend/apps/perm/models.py). Audit 2026-11-11 consistency.
 */
import zh from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";

describe("C-07: who may reopen a judgment on a cancelled approval flow", () => {
  // `judgment.assign` is ADMIN-only since 2026-11-07 (MODERATOR is the social-feed moderator); there is
  // no 殿主 / hall-lead role any more. The help article words it as「持改派权限的人」.
  const zhText = zh.disposition.flow_waiting.approval_cancelled;
  const enText = en.disposition.flow_waiting.approval_cancelled;

  it("names the permission, not the retired 殿主 / hall-lead role", () => {
    expect(zhText).not.toMatch(/殿主/);
    expect(enText).not.toMatch(/hall lead/i);
    expect(zhText).toContain("改派");
    expect(enText).toMatch(/reassign/);
  });
});

describe("C-09: the demo's judge description", () => {
  // JUDGE holds disposition.read / export only; creating or executing a disposition needs
  // disposition.execute (ADMIN). What a judge does decide is the sentence (发落) when concluding.
  it("does not promise to issue dispositions", () => {
    expect(zh.demo.role_judge_desc).not.toMatch(/出处置/);
    expect(en.demo.role_judge_desc).not.toMatch(/issue dispositions?/i);
    expect(zh.demo.role_judge_desc).toContain("结案");
  });
});
