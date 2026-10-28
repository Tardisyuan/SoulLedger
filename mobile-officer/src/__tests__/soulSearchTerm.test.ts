import { soulSearchTerm } from "../screens/search";

describe("soulSearchTerm", () => {
  it("sends a dashed or spaced soul code compact and upper-case", () => {
    expect(soulSearchTerm("QU3-3Q9F-W5F")).toBe("QU33Q9FW5F");
    expect(soulSearchTerm("qu3 3q9f w5f")).toBe("QU33Q9FW5F");
    expect(soulSearchTerm("QU3－3Q9F－W5F")).toBe("QU33Q9FW5F");
  });

  it("leaves anything that is not a whole code alone", () => {
    expect(soulSearchTerm("孟婆")).toBe("孟婆");
    expect(soulSearchTerm("QU3-3Q9F")).toBe("QU3-3Q9F");
    expect(soulSearchTerm("DY-2026-0001")).toBe("DY-2026-0001");
  });
});
