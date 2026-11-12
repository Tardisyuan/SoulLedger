/**
 * 「试一下越权」(作品集建议 A4) shows the server's refusal as recorded. It is only true while the recordings hold it: the
 * judge was refused this endpoint, and the administrator was not. A re-recording that changes either breaks the example,
 * and this says so before a visitor sees `OverreachProbe` fall back to 「重录之后这个例子失效了」.
 */
// Through `recording`, the loader the probe uses, not a static import: a typed import of a 3–7 MB recording is a cost
// every typecheck would pay.
import { type DemoLang, type Recording, read, recording } from "@/demo/store";

const ask = (rec: Recording) => read(rec, "/perm/permissions/", new URLSearchParams());

it.each(["zh", "en"] as DemoLang[])("the judge's %s recording holds the server's 403 for the permission catalogue", async (lang) => {
  const answer = ask(await recording("judge", lang));
  expect(answer.status).toBe(403);
  expect(answer.data).toEqual({ detail: expect.any(String) });
});

it("the administrator's recording reads the same endpoint, so the 403 is the judge's and not the path's", async () => {
  const answer = ask(await recording("admin", "zh"));
  expect(answer.status).toBe(200);
  expect(Array.isArray(answer.data) || typeof answer.data === "object").toBe(true);
});
