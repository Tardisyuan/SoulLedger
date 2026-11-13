/**
 * 「系统怎么保护自己」(作品集建议 A3): the administrator gets the second tour only when the home page's second entrance
 * asked for it, and a sign-in leaves that request alone (it is cleared by the next way in, `useEnter`).
 */
import type { Recording } from "@/demo/store";
import { clearVisitorState } from "@/demo/store";
import { GUARD_STEPS, guardRequested, requestGuard, tourOf } from "@/demo/tour";

const rec = (role: Recording["role"]): Recording => ({
  role,
  lang: "zh",
  recordedAt: "2026-11-12T00:00:00Z",
  login: { user: { id: 1, tenant: role === "admin" ? null : { code: "CN_DIYU" } } },
  lists: {},
  docs: {},
});

afterEach(() => sessionStorage.clear());

it("is off for the administrator unless asked for, and then walks the seven safeguards", () => {
  expect(tourOf(rec("admin"))).toBeNull();
  requestGuard(true);
  const tour = tourOf(rec("admin"));
  expect(tour?.skin).toBe("guard");
  expect(tour?.steps.map((s) => s.route)).toEqual(["/tenants", "/permissions", "/permissions", "/permissions", "/audit", "/recycle-bin", "/admin/assistant"]);
  expect(tour?.steps.filter((s) => s.probe).map((s) => s.n)).toEqual([3]);
  expect(tour?.steps.filter((s) => s.assist).map((s) => s.n)).toEqual([7]);
  requestGuard(false);
  expect(tourOf(rec("admin"))).toBeNull();
});

it("does not reach a judge or the moderator", () => {
  requestGuard(true);
  expect(tourOf(rec("judge"))?.skin).toBe("cn");
  expect(tourOf(rec("moderator"))).toBeNull();
});

it("survives the sign-in's clearing of visitor state", () => {
  requestGuard(true);
  clearVisitorState();
  expect(guardRequested()).toBe(true);
});

it("numbers its steps 1..7, the keys its copy is read under", () => {
  expect(GUARD_STEPS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
});
