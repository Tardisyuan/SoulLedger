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
