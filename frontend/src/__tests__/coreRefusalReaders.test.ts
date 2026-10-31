/**
 * @jest-environment node
 */
/**
 * How core reads a refusal, and what core sends — for the readers and request builders no screen test reaches.
 *
 * Each reader turns a failed request into one decision a screen makes (which sentence, which dialog, whether to
 * offer a handover). The branch that matters is usually the one that says "not this refusal": a 409 with another
 * code, a 400 where a 409 was meant, a body without the field. A reader that answers for the wrong refusal shows
 * the wrong dialog; one that throws on a network error shows none. Both apps and the web share these.
 */
import { AxiosError, AxiosHeaders } from "axios";

jest.mock("@soulledger/core/api/client", () => ({
  ...jest.requireActual("@soulledger/core/api/client"),
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));

import { api } from "@soulledger/core/api/client";
import {
  handoverApi,
  handoverProblemsOf,
  officerRefusalOf,
  openWorkOf,
  userImportFileErrorOf,
  usersApi,
} from "@soulledger/core/api/users";
import {
  quotaIsFull,
  rebirthBlockedOf,
  rebirthQuotaFullOf,
  rebirthReasonRequiredOf,
  rebirthTermEndOf,
  soupNotTakenOf,
  soupRefusalOf,
} from "@soulledger/core/api/reincarnation";
import { judgmentApi } from "@soulledger/core/api/judgment";
import { soulChatErrorCode, soulChatImageErrorCode, soulChatRetryAt } from "@soulledger/core/api/soul-chat";
import { branchRegion, isAutoRouteBranches, originRegionLabel, originRegionMember, routedRegion } from "@soulledger/core/domain/originRegion";
import { latestLostEvent, lostSinceLabel } from "@soulledger/core/domain/lost";
import type { ApprovalNode, ConditionClause } from "@soulledger/core/api/workflow";

const mocked = api as unknown as Record<"get" | "post" | "patch" | "delete", jest.Mock>;

/** A real AxiosError, so `axios.isAxiosError` answers as it does in production. */
function axiosFailure(status: number | undefined, data?: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("refused", "ERR_BAD_RESPONSE", config, null,
    status === undefined ? undefined : { status, statusText: "", headers: {}, config, data });
}
/** The plain `{response: {status, data}}` shape the `responseCode` readers accept. */
const plain = (status: number, data: Record<string, unknown>) => ({ response: { status, data } });

beforeEach(() => {
  for (const fn of Object.values(mocked)) fn.mockReset().mockResolvedValue({ data: {} });
});

describe("users: the refusals of import, invite, handover and deactivate", () => {
  it("reads a whole-file import error from a 400 with a code, and nothing else", () => {
    expect(userImportFileErrorOf(axiosFailure(400, { code: "too_many_rows", max_rows: 500 }))).toEqual({ code: "too_many_rows", max_rows: 500 });
    expect(userImportFileErrorOf(axiosFailure(400, { rows: [] }))).toBeNull();
    expect(userImportFileErrorOf(axiosFailure(400))).toBeNull();
    expect(userImportFileErrorOf(axiosFailure(409, { code: "too_many_rows" }))).toBeNull();
    expect(userImportFileErrorOf(plain(400, { code: "empty_file" }))).toBeNull(); // not an axios error
  });

  it("reads the invite/handover refusal code and field on any status; no answer is no refusal", () => {
    expect(officerRefusalOf(axiosFailure(400, { code: "email_taken", field: "email" }))).toEqual({ code: "email_taken", field: "email" });
    expect(officerRefusalOf(axiosFailure(400, { error: "bad" }))).toBeNull();
    expect(officerRefusalOf(axiosFailure(undefined))).toBeNull();
    expect(officerRefusalOf(new Error("x"))).toBeNull();
  });

  it("reads handover problems only from a 409 that carries a list", () => {
    expect(handoverProblemsOf(axiosFailure(409, { problems: ["target_cannot_judge"] }))).toEqual(["target_cannot_judge"]);
    expect(handoverProblemsOf(axiosFailure(409, { problems: "target_cannot_judge" }))).toBeNull();
    expect(handoverProblemsOf(axiosFailure(400, { problems: ["target_cannot_judge"] }))).toBeNull();
  });

  it("reads open work only from 409 officer_has_open_work, so another 409 does not offer a handover", () => {
    const work = { "7": { judgments: 2, appeals: 0, appeals_returned_to_pool: 0, city_gods: [], letters: 1 } };
    expect(openWorkOf(axiosFailure(409, { code: "officer_has_open_work", open_work: work }))).toEqual(work);
    expect(openWorkOf(axiosFailure(409, { code: "handover_blocked", open_work: work }))).toBeNull();
    expect(openWorkOf(axiosFailure(409, { code: "officer_has_open_work" }))).toBeNull();
    expect(openWorkOf(axiosFailure(400, { code: "officer_has_open_work", open_work: work }))).toBeNull();
  });

  it("sends a handover target and a second factor only when given", async () => {
    await usersApi.deactivate("5");
    expect(mocked.post).toHaveBeenLastCalledWith("/users/5/deactivate/", {});
    await usersApi.deactivate("5", 9, { mfa_method: "totp", mfa_code: "123456" });
    expect(mocked.post).toHaveBeenLastCalledWith("/users/5/deactivate/", { handover_to: 9, mfa_method: "totp", mfa_code: "123456" });

    await usersApi.delete("5");
    expect(mocked.delete).toHaveBeenLastCalledWith("/users/5/", undefined);
    await usersApi.delete("5", { mfa_method: "recovery", mfa_code: "abcd-efgh" });
    expect(mocked.delete).toHaveBeenLastCalledWith("/users/5/", { data: { mfa_method: "recovery", mfa_code: "abcd-efgh" } });

    await usersApi.resetPassword(5);
    expect(mocked.post).toHaveBeenLastCalledWith("/users/5/reset_password/", {});
  });

  it("asks for the hall's officers with a tenant only when one is named, and counts without a target", async () => {
    await handoverApi.officers();
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/handover/officers/", { params: {} });
    await handoverApi.officers(3);
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/handover/officers/", { params: { tenant: 3 } });
    await handoverApi.preview(4);
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/handover/preview/", { from: 4 });
    await handoverApi.preview(4, 8);
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/handover/preview/", { from: 4, to: 8 });
  });
});

describe("reincarnation: why a rebirth was refused", () => {
  it("reads a full path from 409 rebirth_quota_full, numbers coerced; anything else is not a full path", () => {
    expect(rebirthQuotaFullOf(plain(409, { code: "rebirth_quota_full", rebirth_form: "HUMAN", limit: "3", used: 3 }))).toEqual({
      code: "rebirth_quota_full", rebirth_form: "HUMAN", limit: 3, used: 3,
    });
    expect(rebirthQuotaFullOf(plain(409, { code: "rebirth_quota_full" }))).toBeNull();
    expect(rebirthQuotaFullOf(plain(400, { code: "rebirth_quota_full", rebirth_form: "HUMAN" }))).toBeNull();
    expect(rebirthQuotaFullOf(plain(409, { code: "eternal_sentence", rebirth_form: "HUMAN" }))).toBeNull();
  });

  it("names each business block, and a block code on another status is not one", () => {
    for (const code of ["plan_in_progress", "eternal_sentence", "rebirth_not_approved", "term_not_served", "disposition_not_executed", "origin_flow_open"]) {
      expect(rebirthBlockedOf(plain(409, { code }))).toBe(code);
    }
    expect(rebirthBlockedOf(plain(400, { code: "plan_in_progress" }))).toBeNull();
    expect(rebirthBlockedOf(plain(409, { code: "soup_not_taken" }))).toBeNull();
    expect(soupNotTakenOf(plain(409, { code: "soup_not_taken" }))).toBe(true);
    expect(soupNotTakenOf(plain(400, { code: "soup_not_taken" }))).toBe(false);
  });

  it("reads the term end of term_not_served only, the wished path of a 400 reason_required, and the soup refusals", () => {
    const end = { year: 2031, month: 3, day: null };
    expect(rebirthTermEndOf(plain(409, { code: "term_not_served", term_end: end }))).toEqual(end);
    expect(rebirthTermEndOf(plain(409, { code: "term_not_served" }))).toBeNull();
    expect(rebirthTermEndOf(plain(409, { code: "eternal_sentence", term_end: end }))).toBeNull();

    expect(rebirthReasonRequiredOf(plain(400, { code: "rebirth_form_reason_required", desired_form: "DEVA" }))).toBe("DEVA");
    expect(rebirthReasonRequiredOf(plain(400, { code: "rebirth_form_reason_required" }))).toBe("");
    expect(rebirthReasonRequiredOf(plain(409, { code: "rebirth_form_reason_required" }))).toBeNull();

    for (const code of ["not_diyu", "not_reincarnating", "soup_already_taken"]) expect(soupRefusalOf(plain(409, { code }))).toBe(code);
    expect(soupRefusalOf(plain(409, { code: "soup_not_taken" }))).toBeNull();
    expect(soupRefusalOf(plain(400, { code: "not_diyu" }))).toBeNull();
  });

  it("calls a path full at its limit, a limit of 0 full from day one, and no limit never full", () => {
    expect(quotaIsFull({ limit: 3, used: 3 })).toBe(true);
    expect(quotaIsFull({ limit: 3, used: 2 })).toBe(false);
    expect(quotaIsFull({ limit: 0, used: 0 })).toBe(true);
    expect(quotaIsFull({ limit: null, used: 99 } as never)).toBe(false);
    expect(quotaIsFull(undefined)).toBe(false);
  });
});

describe("judgment: the queue cursor and the claim routes", () => {
  it("repeats skip, sends at / after / include_deferred only when set, and an empty query is no '?'", async () => {
    await judgmentApi.next();
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/next/");
    await judgmentApi.next({ skip: ["a", "b"], at: "j1", after: "j0", includeDeferred: true });
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/next/?skip=a&skip=b&at=j1&after=j0&include_deferred=true");
    await judgmentApi.previous({ at: "j1" });
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/previous/?at=j1");
    await judgmentApi.previous({ at: "j1", skip: ["a"], includeDeferred: true });
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/previous/?at=j1&skip=a&include_deferred=true");
  });

  it("puts a reason in the body only when one was written", async () => {
    await judgmentApi.release("j1");
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/release/", {});
    await judgmentApi.release("j1", "换人");
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/release/", { reason: "换人" });
    await judgmentApi.reassign("j1", 4);
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/reassign/", { to: 4 });
    await judgmentApi.reassign("j1", 4, "休假");
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/reassign/", { to: 4, reason: "休假" });
    await judgmentApi.undefer("j1");
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/undefer/", {});
    await judgmentApi.requestReassign("j1", "忙");
    expect(mocked.post).toHaveBeenLastCalledWith("/judgment/j1/request-reassign/", { reason: "忙" });
  });

  it("asks for precedents with a limit only when given", async () => {
    await judgmentApi.precedents("j1");
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/j1/precedents/", { params: undefined });
    await judgmentApi.precedents("j1", 5);
    expect(mocked.get).toHaveBeenLastCalledWith("/judgment/j1/precedents/", { params: { limit: 5 } });
  });

  it("reports upload progress as a fraction capped at 1, 0 when the size is unknown, and no handler when none asked", async () => {
    mocked.post.mockResolvedValue({ data: { id: "a1" } });
    const seen: number[] = [];
    await judgmentApi.uploadAttachment("j1", {} as FormData, { onProgress: (f) => seen.push(f) });
    const { onUploadProgress } = mocked.post.mock.calls[0][2];
    onUploadProgress({ loaded: 50, total: 200 });
    onUploadProgress({ loaded: 300, total: 200 });
    onUploadProgress({ loaded: 10, total: 0 });
    expect(seen).toEqual([0.25, 1, 0]);

    await judgmentApi.uploadAttachment("j1", {} as FormData);
    expect(mocked.post.mock.calls[1][2].onUploadProgress).toBeUndefined();
  });
});

describe("soul chat: the code of a refused send", () => {
  it("knows its own codes, ignores another feature's and a non-axios error", () => {
    expect(soulChatErrorCode(axiosFailure(409, { code: "self_conversation" }))).toBe("self_conversation");
    expect(soulChatErrorCode(axiosFailure(409, { code: "too_large" }))).toBeNull();
    expect(soulChatErrorCode(plain(409, { code: "self_conversation" }))).toBeNull();
    expect(soulChatImageErrorCode(axiosFailure(400, { code: "too_large" }))).toBe("too_large");
    expect(soulChatImageErrorCode(axiosFailure(400, { code: "self_conversation" }))).toBeNull();
    expect(soulChatImageErrorCode(new Error("x"))).toBeNull();
  });

  it("reads retry_at only when it is a string", () => {
    expect(soulChatRetryAt(axiosFailure(429, { retry_at: "2026-10-31T10:00:00Z" }))).toBe("2026-10-31T10:00:00Z");
    expect(soulChatRetryAt(axiosFailure(429, { retry_at: 60 }))).toBeNull();
    expect(soulChatRetryAt(axiosFailure(undefined))).toBeNull();
    expect(soulChatRetryAt(null)).toBeNull();
  });
});

describe("origin region (第四十五批 自动分流)", () => {
  const clause = (over: Partial<ConditionClause>) => ({ fact: "origin_region", op: "in", value: ["EUROPE"], ...over }) as ConditionClause;

  it("reads a stored value as a member, everything unknown as UNKNOWN, and labels it", () => {
    expect(originRegionMember("ASIA")).toBe("ASIA");
    expect(originRegionMember("")).toBe("UNKNOWN");
    expect(originRegionMember(null)).toBe("UNKNOWN");
    expect(originRegionLabel((k) => k, "EUROPE")).toBe("souls.origin_region.EUROPE");
  });

  it("recognises a branch only in the one shape the router writes", () => {
    expect(branchRegion([clause({})])).toBe("EUROPE");
    expect(branchRegion(undefined)).toBeNull();
    expect(branchRegion([clause({}), clause({})])).toBeNull();
    expect(branchRegion([clause({ fact: "civilization" as never })])).toBeNull();
    expect(branchRegion([clause({ op: "eq" as never })])).toBeNull();
    expect(branchRegion([clause({ value: ["EUROPE", "ASIA"] })])).toBeNull();
    expect(branchRegion([clause({ value: ["UNKNOWN"] })])).toBeNull();
  });

  it("calls a NOTIFY step with an origin-region branch an auto route, and nothing else", () => {
    expect(isAutoRouteBranches("NOTIFY", [{ when: [clause({})] }])).toBe(true);
    expect(isAutoRouteBranches("APPROVAL", [{ when: [clause({})] }])).toBe(false);
    expect(isAutoRouteBranches("NOTIFY", [{}])).toBe(false);
    expect(isAutoRouteBranches("NOTIFY", null)).toBe(false);
  });

  it("reads which way the routing went from the stations reached, the default as UNKNOWN, nothing before it ran", () => {
    const router = {
      status: "TRAVERSED",
      branches_json: [{ when: [clause({ value: ["EUROPE"] })], target: "aeacus" }, { when: [clause({ value: ["ASIA"] })], target: "rhada" }],
      on_pass: "minos",
    } as unknown as ApprovalNode;
    const st = (id: string, status: string) => ({ id, status, node_name: id }) as ApprovalNode;
    expect(routedRegion(router, [st("aeacus", "PENDING"), st("rhada", "APPROVED"), st("minos", "PENDING")])).toEqual({
      region: "ASIA", target: st("rhada", "APPROVED"),
    });
    // The current station counts as reached even though it is still PENDING.
    expect(routedRegion(router, [st("aeacus", "PENDING")], "aeacus")?.region).toBe("EUROPE");
    expect(routedRegion(router, [st("aeacus", "SKIPPED"), st("minos", "APPROVED")])).toEqual({ region: "UNKNOWN", target: st("minos", "APPROVED") });
    expect(routedRegion({ ...router, on_pass: null } as ApprovalNode, [])).toEqual({ region: "UNKNOWN", target: null });
    expect(routedRegion({ ...router, status: "PENDING" } as ApprovalNode, [])).toBeNull();
  });
});

describe("the lost banner (第五十批)", () => {
  it("takes the latest change to LOST, ignores other states and malformed payloads", () => {
    const ev = (create_time: string, payload: unknown, event_type = "STATE_CHANGED") => ({ event_type, payload, create_time });
    const older = ev("2026-10-01T00:00:00Z", { new_state: "LOST" });
    const newer = ev("2026-10-20T00:00:00Z", { new_state: "LOST" });
    expect(latestLostEvent([older, ev("2026-10-25T00:00:00Z", { new_state: "JUDGED" }), newer, ev("2026-10-26T00:00:00Z", null)])).toBe(newer);
    expect(latestLostEvent([ev("2026-10-26T00:00:00Z", { new_state: "LOST" }, "RECORD_ADDED")])).toBeNull();
    expect(latestLostEvent([])).toBeNull();
  });

  it("labels the time as MM-DD HH:mm in local time", () => {
    const local = new Date(2026, 9, 4, 7, 5).toISOString();
    expect(lostSinceLabel(local)).toBe("10-04 07:05");
  });
});
