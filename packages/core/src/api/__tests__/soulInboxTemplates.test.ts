/**
 * Reply templates are filled on the client (`renderTemplate`): the template never
 * reaches Synapse, the filled text does. Only the two names the backend accepts
 * (`TEMPLATE_PLACEHOLDERS`) are replaced.
 */
import { describe, expect, it } from "vitest";
import { TEMPLATE_PLACEHOLDERS, renderTemplate } from "../soul-inbox";

const values = { soul_name: "张三", hall_name: "第五殿" };

describe("renderTemplate", () => {
  it("fills both names, with or without inner spaces, every time they occur", () => {
    expect(renderTemplate("{{soul_name}}:{{ hall_name }}已收悉。{{soul_name}}", values)).toBe("张三:第五殿已收悉。张三");
  });

  it("leaves anything else as written — the server will not have stored it, and guessing is worse", () => {
    expect(renderTemplate("{{soul_code}} {soul_name} {{soul_name", values)).toBe("{{soul_code}} {soul_name} {{soul_name");
  });

  it("does not treat a name inside the values as a placeholder again", () => {
    expect(renderTemplate("{{soul_name}}", { soul_name: "{{hall_name}}", hall_name: "x" })).toBe("{{hall_name}}");
  });

  it("names the same two placeholders the backend accepts", () => {
    expect([...TEMPLATE_PLACEHOLDERS]).toEqual(["soul_name", "hall_name"]);
  });
});
