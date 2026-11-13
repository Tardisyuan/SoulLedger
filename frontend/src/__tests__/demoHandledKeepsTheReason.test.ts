/**
 * The demo's 隐藏 / 删除 through a report writes a 「已处理」 row. The page sends the picked reason as `reason_code`
 * (and `reason_note` with 其他), the note box as `note` — the server stores the first of note, reason_note, reason_code
 * (moderation.py::stored_reason). Reading `note` alone left the row's reason at 「—」 whenever only a reason was picked.
 */
import { type Recording, recording, resetOverlay, rowsNow } from "@/demo/store";
import { write } from "@/demo/writes";

let rec: Recording;
beforeAll(async () => {
  rec = await recording("moderator", "zh");
});
beforeEach(() => resetOverlay());

const openPostReport = () => rowsNow(rec, "/social-moderation/reports/").find((r) => r.status === "OPEN" && r.post)!;
const resolve = (id: unknown, body: Record<string, unknown>) =>
  write(rec, "POST", `/social-moderation/reports/${id}/resolve/`, new URLSearchParams(), body);
const handledReason = (post: unknown) => rowsNow(rec, "/social-moderation/handled/").find((h) => h.id === post)?.reason;

it.each([
  [{ resolution: "HIDE", note: "", reason_code: "SPAM" }, "SPAM"],
  [{ resolution: "DELETE", note: "", reason_code: "OTHER", reason_note: "冒充判官" }, "冒充判官"],
  [{ resolution: "HIDE", note: "官员备注", reason_code: "ABUSE" }, "官员备注"],
])("a handled row keeps the reason the officer gave (%o)", (body, reason) => {
  const report = openPostReport();
  expect(report).toBeDefined();
  expect(resolve(report.id, body).status).toBe(200);
  expect(handledReason(report.post)).toBe(reason);
});
