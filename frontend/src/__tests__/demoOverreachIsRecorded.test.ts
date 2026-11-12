/**
 * 「试一下越权」(作品集建议 A4) shows the server's refusal as recorded. It is only true while the recordings hold it: the
 * judge was refused this endpoint, and the administrator was not. A re-recording that changes either breaks the example,
 * and this says so before a visitor sees `OverreachProbe` fall back to 「重录之后这个例子失效了」.
 */
import admin from "@/demo/data/admin.zh.json";
import judge from "@/demo/data/judge.zh.json";
import judgeEn from "@/demo/data/judge.en.json";
import { type Recording, read } from "@/demo/store";

const ask = (rec: unknown) => read(rec as Recording, "/perm/permissions/", new URLSearchParams());

it.each([
  ["zh", judge],
  ["en", judgeEn],
])("the judge's %s recording holds the server's 403 for the permission catalogue", (_lang, rec) => {
  const answer = ask(rec);
  expect(answer.status).toBe(403);
  expect(answer.data).toEqual({ detail: expect.any(String) });
});

it("the administrator's recording reads the same endpoint, so the 403 is the judge's and not the path's", () => {
  const answer = ask(admin);
  expect(answer.status).toBe(200);
  expect(Array.isArray(answer.data) || typeof answer.data === "object").toBe(true);
});
