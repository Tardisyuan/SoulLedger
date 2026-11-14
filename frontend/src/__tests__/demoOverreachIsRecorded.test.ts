/**
 * 「试一下越权」(作品集建议 A4) shows the server's refusal as recorded. It is only true while the recordings hold it: the
 * judge was refused this endpoint, and the administrator was not. A re-recording that changes either breaks the example,
 * and this says so before a visitor sees `OverreachProbe` fall back to 「重录之后这个例子失效了」.
 */
// Through `recording`, the loader the probe uses, not a static import: a typed import of a 3–7 MB recording is a cost
// every typecheck would pay.
import { hallOf } from "@/demo/inside";
import { type DemoLang, type Recording, overreachRecording, read, recording } from "@/demo/store";

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

// 「越权四连」: the other three requests. The lateral one is the judge asking for the EU hall's first soul by id
// (`recordInside`); the soul-token and no-token ones are in `data/overreach.<lang>.json` (the soul section of the recorder).
it.each(["zh", "en"] as DemoLang[])("the %s recordings hold the lateral 404, the wrong door's 403 and the anonymous 401", async (lang) => {
  const probe = hallOf(await recording("judge", lang), await recording("judge_eu", lang)).probe;
  expect(probe?.status).toBe(404);
  const answers = (await overreachRecording(lang))?.answers;
  expect(answers?.door).toEqual({ path: "/souls/", s: 403, b: expect.objectContaining({ status: 403 }) });
  expect(answers?.anon).toEqual({ path: "/souls/", s: 401, b: expect.objectContaining({ status: 401 }) });
});
