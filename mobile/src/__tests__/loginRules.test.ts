/**
 * The decisions behind the sign-in page (第二十批), as rules: what the number box does with what is typed, which
 * notice a refusal means, when the system prompt opens by itself, when the question is due, and how a failed read
 * of the credential is told apart.
 */
import {
  canSubmitLogin,
  classifyCredentialError,
  lapseOfReason,
  shouldAskBio,
  shouldAutoPrompt,
  logoutBody,
  soulCodeStep, credentialReadFailure } from "../loginRules";

describe("soulCodeStep: the box holds the raw characters; the step says what was typed", () => {
  it("appended text is the typing: upper-cased, separators skipped", () => {
    expect(soulCodeStep("QU3", "QU3-3q 9")).toEqual({ value: "QU33Q9", problem: null });
  });

  it("a refused character does not go in, and the box says which kind it was", () => {
    expect(soulCodeStep("QU", "QUO")).toEqual({ value: "QU", problem: { kind: "bad_char", char: "O" } });
    expect(soulCodeStep("QU", "QU#")).toEqual({ value: "QU", problem: { kind: "bad_symbol", char: "#" } });
    // several characters at once with one bad among them: the whole paste is refused
    expect(soulCodeStep("", "QU3 O")).toEqual({ value: "", problem: { kind: "bad_paste", char: "O" } });
  });

  it("deleting is a prefix: no problem; a paste over a selection is read as a paste into an empty box", () => {
    expect(soulCodeStep("QU33", "QU3")).toEqual({ value: "QU3", problem: null });
    expect(soulCodeStep("QU33", "AB2")).toEqual({ value: "AB2", problem: null });
    expect(soulCodeStep("QU33", "AB0")).toEqual({ value: "QU33", problem: { kind: "bad_paste", char: "0" } });
  });

  it("never more than ten", () => {
    expect(soulCodeStep("QU33Q9FW5", "QU33Q9FW5FF").value).toBe("QU33Q9FW5F");
  });
});

describe("canSubmitLogin", () => {
  it("needs all ten characters and a password, and no request out", () => {
    expect(canSubmitLogin("QU33Q9FW5F", "p", false)).toBe(true);
    expect(canSubmitLogin("QU33Q9FW5", "p", false)).toBe(false);
    expect(canSubmitLogin("QU33Q9FW5F", "", false)).toBe(false);
    expect(canSubmitLogin("QU33Q9FW5F", "p", true)).toBe(false);
  });
});

describe("lapseOfReason: the server's reason picks one of the four notices", () => {
  it.each([
    ["password_changed", "pw_changed"],
    ["password_reset_by_officer", "reset"],
    ["account_reincarnated", "reborn"],
    // closed from elsewhere, or a reason this App has not heard of: the phone's own, the biometric one
    ["turned_off", "bio_changed"],
    ["something_new", "bio_changed"],
    [null, "bio_changed"],
  ] as const)("%s -> %s", (reason, lapse) => {
    expect(lapseOfReason(reason)).toBe(lapse);
  });
});

describe("shouldAutoPrompt: the system prompt opens by itself once, on a cold start, and never over a notice", () => {
  const on = { enabled: true, coldStart: true, cancelled: false, lapsed: null } as const;
  it("opens", () => expect(shouldAutoPrompt(on)).toBe(true));
  it.each([
    ["off", { enabled: false }],
    ["not a cold start (back from the background)", { coldStart: false }],
    ["the soul cancelled it", { cancelled: true }],
    ["a notice is up", { lapsed: "reset" as const }],
  ])("not when %s", (_name, over) => expect(shouldAutoPrompt({ ...on, ...over })).toBe(false));
});

describe("shouldAskBio: the question after the first sign-in", () => {
  const due = { hasPassword: true, enrolled: true, enabled: false, asked: false, welcomePending: false };
  it("is due", () => expect(shouldAskBio(due)).toBe(true));
  it.each([
    ["no password in memory (a restored session)", { hasPassword: false }],
    ["nothing enrolled on the phone", { enrolled: false }],
    ["already on", { enabled: true }],
    ["already answered", { asked: true }],
    ["the welcome has not ended", { welcomePending: true }],
  ])("not when %s", (_name, over) => expect(shouldAskBio({ ...due, ...over })).toBe(false));
});

describe("credentialReadFailure: an iOS lockout reads like a miss but comes back at once", () => {
  const ios = { code: "ERR_KEY_CHAIN", message: "KeyChainException: Authentication failed. Provided passphrase/PIN is incorrect or there is no user authentication method configured for this device." };
  it("is locked when iOS answers without scanning", () => {
    expect(credentialReadFailure(ios, 40, "ios")).toBe("locked");
  });
  it("is a miss when the scan took its time, or off iOS", () => {
    expect(credentialReadFailure(ios, 3000, "ios")).toBe("failed");
    expect(credentialReadFailure(ios, 40, "android")).toBe("failed");
  });
  it("reads a cancel from iOS's own miss sheet (after a scan) as the miss", () => {
    expect(credentialReadFailure(new Error("User canceled the operation."), 4000, "ios")).toBe("failed");
    expect(credentialReadFailure(new Error("User canceled the operation."), 4000, "android")).toBe("cancelled");
  });
  it("leaves a fast cancel or invalidation alone", () => {
    expect(credentialReadFailure(new Error("User canceled the operation."), 40, "ios")).toBe("cancelled");
    expect(credentialReadFailure(new Error("Key permanently invalidated"), 40, "ios")).toBe("invalidated");
  });
});

describe("classifyCredentialError", () => {
  it.each([
    [new Error("User canceled the operation."), "cancelled"],
    [{ code: "ERR_SECURESTORE", message: "Authentication was cancelled" }, "cancelled"],
    [new Error("KeyPermanentlyInvalidatedException: Key permanently invalidated"), "invalidated"],
    [new Error("The key is no longer usable after a biometric enrolment"), "invalidated"],
    [{ code: "ERR_AUTHENTICATION", message: "Could not Authenticate the user: Lockout. 操作过于频繁，请稍后再试" }, "locked"],
    [new Error("Too many attempts. Try again later."), "locked"],
    [new Error("Authentication failed"), "failed"],
    ["something else", "failed"],
    [null, "failed"],
  ] as const)("%j -> %s", (error, kind) => {
    expect(classifyCredentialError(error)).toBe(kind);
  });

  it("reads one wrong letter as a letter even when the field sends its text back in lower case", () => {
    expect(soulCodeStep("QU33Q", "qu33qo")).toEqual({ value: "QU33Q", problem: { kind: "bad_char", char: "O" } });
    expect(soulCodeStep("QU33Q", "qu33q9")).toEqual({ value: "QU33Q9", problem: null });
    expect(soulCodeStep("QU33Q", "qu33")).toEqual({ value: "QU33", problem: null });
  });

  it("the sign-out sheet says what the next sign-in takes: the password, or the face / finger", () => {
    expect(logoutBody(null)).toEqual({ key: "soul_app.logout.body", bioKey: null });
    expect(logoutBody("face")).toEqual({ key: "soul_app.logout.body_bio", bioKey: "soul_app.bio.face" });
    expect(logoutBody("finger")).toEqual({ key: "soul_app.logout.body_bio", bioKey: "soul_app.bio.finger" });
  });
});
