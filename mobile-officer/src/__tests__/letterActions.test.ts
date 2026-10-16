/** O-04: which rows the ⋯ menu offers, when a letter wears 由我来回, and who the picker lists. */
import { assignableOthers, isUnassigned, menuActions } from "../letterActions";

describe("menuActions", () => {
  it("an assigned open letter: hand over, put back, archive", () => {
    expect(menuActions({ archived: false, closed: false, assigned: true })).toEqual(["assign", "unassign", "archive"]);
  });

  it("an unassigned letter has nothing to put back", () => {
    expect(menuActions({ archived: false, closed: false, assigned: false })).toEqual(["assign", "archive"]);
  });

  it("an archived letter offers only 取消归档", () => {
    expect(menuActions({ archived: true, closed: false, assigned: true })).toEqual(["unarchive"]);
  });

  it("a closed thread cannot be handed over (409 closed) but can be put back and archived", () => {
    expect(menuActions({ archived: false, closed: true, assigned: true })).toEqual(["unassign", "archive"]);
  });
});

describe("isUnassigned", () => {
  it("only an open, unarchived letter nobody holds", () => {
    expect(isUnassigned({ assigned: false, closed: false, archived: false })).toBe(true);
    expect(isUnassigned({ assigned: true, closed: false, archived: false })).toBe(false);
    expect(isUnassigned({ assigned: false, closed: true, archived: false })).toBe(false);
    expect(isUnassigned({ assigned: false, closed: false, archived: true })).toBe(false);
  });
});

describe("assignableOthers", () => {
  const people = [
    { user_id: 1, display_name: "崔判官" },
    { user_id: 2, display_name: "钟书吏" },
    { user_id: 3, display_name: "Lin" },
  ];

  it("never lists the caller", () => {
    expect(assignableOthers(people, 1, "").map((p) => p.user_id)).toEqual([2, 3]);
  });

  it("filters by the search text, ignoring case and surrounding spaces", () => {
    expect(assignableOthers(people, 1, " lin ").map((p) => p.user_id)).toEqual([3]);
    expect(assignableOthers(people, 1, "钟").map((p) => p.user_id)).toEqual([2]);
    expect(assignableOthers(people, 1, "无此人")).toEqual([]);
  });
});
