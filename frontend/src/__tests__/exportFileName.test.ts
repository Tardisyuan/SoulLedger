import { exportFileName } from "@/src/lib/exportFileName";

describe("exportFileName", () => {
  it("is page-hall-YYYYMMDD-HHmm in the local time zone", () => {
    expect(exportFileName("移交", "酆都 · 第十殿", new Date(2026, 0, 2, 3, 4))).toBe("移交-酆都 · 第十殿-20260102-0304.csv");
  });

  it("replaces characters a file system rejects, and drops a missing hall", () => {
    expect(exportFileName('a/b\\c:d*e?f"g<h>i|j\u0007k', undefined, new Date(2026, 11, 31, 23, 59))).toBe(
      "a_b_c_d_e_f_g_h_i_j_k-20261231-2359.csv"
    );
  });
});
