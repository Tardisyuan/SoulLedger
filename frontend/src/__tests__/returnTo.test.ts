/**
 * `src/lib/returnTo.ts` (W1): the page a session expired on, back after sign-in — and nowhere else.
 * The refusals are the point: `?redirect=` is attacker-writable, so every way a string can leave the
 * origin (or land on a page with nothing to return to) is listed, absence asserted next to presence.
 */
import { RETURN_TO_KEY, clearReturnTo, rememberReturnTo, safeReturnTo, takeReturnTo } from "@/src/lib/returnTo";

beforeEach(() => sessionStorage.clear());

describe("safeReturnTo", () => {
  it.each(["/souls", "/souls/42?tab=events", "/desk#case-7", "/judgment/queue?status=PENDING&page=2"])(
    "keeps a same-origin path: %s",
    (path) => expect(safeReturnTo(path)).toBe(path)
  );

  it.each([
    ["protocol-relative", "//evil.example/x"],
    ["backslash host", "/\\evil.example"],
    ["absolute URL", "https://evil.example/"],
    ["scheme inside", "/x?next=https://evil.example"],
    ["javascript:", "javascript:alert(1)"],
    ["no leading slash", "souls"],
    ["tab the browser strips", "/\t/evil.example"],
    ["newline", "/\n/evil.example"],
    ["space", "/ /evil.example"],
    ["the login page", "/login"],
    ["the login page with a query", "/login?redirect=/souls"],
    ["the two-step page", "/login/verify"],
    ["goodbye", "/goodbye"],
    ["goodbye with a query", "/goodbye?x=1"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_label, path) => expect(safeReturnTo(path)).toBeNull());
});

describe("remember / take / clear", () => {
  it("take reads once and deletes", () => {
    rememberReturnTo("/souls?q=1");
    expect(takeReturnTo()).toBe("/souls?q=1");
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(takeReturnTo()).toBeNull();
  });

  it("an unsafe path is not stored, and does not overwrite a safe one", () => {
    rememberReturnTo("/desk");
    rememberReturnTo("//evil.example");
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe("/desk");
  });

  it("a value written behind its back is validated again on the way out", () => {
    sessionStorage.setItem(RETURN_TO_KEY, "https://evil.example/");
    expect(takeReturnTo()).toBeNull();
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it("clear forgets it (explicit sign-out)", () => {
    rememberReturnTo("/desk");
    clearReturnTo();
    expect(takeReturnTo()).toBeNull();
  });
});
