/**
 * 第四十六批「补录出身地域」(components/souls/SoulRegionBackfillDialog.tsx,入口在 app/souls/page.tsx)。
 *
 * Pinned: the toolbar button is there with `soul.update` and absent without it (and is not the import
 * dialog); the preview's 灵魂 cell is an inline IdentifierChip followed by the name; a not_found row shows
 * the chip and a missing-value dash for name and values, no name; a row that clears a value is bold and
 * the clears are counted on their own line — and neither appears when nothing clears; confirm is
 * disabled with the reason under the counts when nothing can be updated (and the reason is absent
 * otherwise); the done page offers 「下载跳过的行」 before the template link, and not at all when nothing
 * was skipped; the skipped-rows CSV keeps the file's identifier column plus a reason; file-level codes map
 * to text; the template is `soul_id,origin_region`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import SoulsPage from "@/app/souls/page";
import {
  REGION_BACKFILL_TEMPLATE,
  SoulRegionBackfillDialog,
  regionFileErrorText,
  skippedRowsCsv,
} from "@/src/components/souls/SoulRegionBackfillDialog";
import type { SoulRegionUpdateRow } from "@soulledger/core/api";

const A = "1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed";
const B = "6ec0bd7f-11c0-43da-975e-2a8ad9ebae0b";
const NONE = "00000000-0000-0000-0000-000000000000";

function row(over: Partial<SoulRegionUpdateRow>): SoulRegionUpdateRow {
  return {
    row: 2,
    status: "ok",
    values: { soul_id: A, origin_region: "europe" },
    old: "",
    new: "EUROPE",
    clears_value: false,
    duplicate_of: null,
    identifier: A,
    soul_name: "Achilles",
    ...over,
  };
}
const OK = row({});
const CLEAR = row({ row: 3, identifier: B, values: { soul_id: B, origin_region: "" }, old: "ASIA", new: "", clears_value: true, soul_name: "Memnon" });
const SAME = row({ row: 4, status: "unchanged", old: "ASIA", new: "ASIA", soul_name: "Hector" });
const LOST = row({ row: 5, status: "not_found", identifier: NONE, values: { soul_id: NONE, origin_region: "ASIA" }, old: null, new: null, soul_name: null });
const BAD = row({ row: 6, status: "invalid_origin_region", values: { soul_id: A, origin_region: "AFRICA" }, old: "EUROPE", new: null, soul_name: "Odysseus" });
const DUP = row({ row: 7, status: "duplicate_in_file", old: null, new: null, duplicate_of: 2, soul_name: "Achilles" });

const SKIP = new Set(["missing_identifier", "not_found", "duplicate_in_file", "invalid_origin_region"]);
const preview = (rows: SoulRegionUpdateRow[]) => ({
  total: rows.length,
  changed_count: rows.filter((r) => r.status === "ok").length,
  unchanged_count: rows.filter((r) => r.status === "unchanged").length,
  skipped_count: rows.filter((r) => SKIP.has(r.status)).length,
  clears_count: rows.filter((r) => r.clears_value).length,
  max_rows: 1000,
  rows,
});

const mockPreview = jest.fn();
const mockCommit = jest.fn();
const mockImportPreview = jest.fn();
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  useSoulRegionUpdatePreview: () => ({ mutate: (...a: unknown[]) => mockPreview(...a), isPending: false }),
  useSoulRegionUpdateCommit: () => ({ mutate: (...a: unknown[]) => mockCommit(...a), isPending: false }),
  useSoulImportPreview: () => ({ mutate: (...a: unknown[]) => mockImportPreview(...a), isPending: false }),
  useSoulImportCommit: () => ({ mutate: jest.fn(), isPending: false }),
  useSouls: () => ({
    data: { results: [], count: 0 },
    isLoading: false,
    isError: false,
    isPlaceholderData: false,
    refetch: jest.fn(),
  }),
  useSoul: () => ({ isLoading: false, isError: false }),
  useCreateSoul: () => ({ mutateAsync: jest.fn() }),
  useBatchRecycleSouls: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  PAGE_SIZE: 20,
  soulsApi: { list: jest.fn().mockResolvedValue({ data: { count: 0, results: [] } }), exportCsv: jest.fn() },
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
const mockSave = jest.fn();
jest.mock("@/src/lib/saveBlob", () => ({ saveBlob: (...args: unknown[]) => mockSave(...args) }));
let mockUser: Record<string, unknown> = { role: "OPERATOR", permissions: ["soul.read", "soul.update"] };
jest.mock("@/src/contexts/TenantContext", () => ({ useTenant: () => ({ user: mockUser }) }));
const t = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${Object.values(params).join(",")}` : key;
jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t, locale: "zh-Hans", hydrated: true }),
}));

const CSV = new File(["soul_id,origin_region\n"], "regions.csv", { type: "text/csv" });

function axiosError(status: number, data: unknown) {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError("x", "ERR_BAD_REQUEST", config, null, { status, statusText: "", headers: {}, config, data });
}

function choose(answer: { rows?: SoulRegionUpdateRow[]; error?: unknown }) {
  mockPreview.mockImplementation((_form: FormData, opts: { onSuccess: (_p: unknown) => void; onError: (_e: unknown) => void }) =>
    answer.rows ? opts.onSuccess(preview(answer.rows)) : opts.onError(answer.error),
  );
  render(<SoulRegionBackfillDialog isOpen onClose={jest.fn()} />);
  fireEvent.change(screen.getByLabelText("souls.import.choose_file"), { target: { files: [CSV] } });
}

const commitButton = () => screen.getByRole("button", { name: /^souls\.region_backfill\.commit/ });
const rowOf = (n: number) =>
  [...document.querySelectorAll<HTMLElement>("tbody tr")].find((tr) => tr.querySelector("td")?.textContent === String(n)) as HTMLElement;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { role: "OPERATOR", permissions: ["soul.read", "soul.update"] };
});

describe("入口", () => {
  function renderPage() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SoulsPage />
      </QueryClientProvider>,
    );
  }

  it("有 soul.update 就有按钮,点开的是自己的弹层(第 1 步),不是导入", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "souls.region_backfill.button" }));
    expect(screen.getByText("souls.region_backfill.title:1")).toBeInTheDocument();
    expect(screen.getByText("souls.region_backfill.id_hint")).toBeInTheDocument();
    expect(screen.queryByText("souls.import.title")).not.toBeInTheDocument();
  });

  it("没有 soul.update 就没有按钮(只有 soul.create 也没有)", async () => {
    mockUser = { role: "OPERATOR", permissions: ["soul.read", "soul.create"] };
    renderPage();
    expect(await screen.findByRole("button", { name: "souls.import.button" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "souls.region_backfill.button" })).not.toBeInTheDocument();
  });
});

describe("预览", () => {
  it("灵魂一格:inline 标识芯片 + 名字;找不到的行芯片照常、名字与值是缺值", () => {
    choose({ rows: [OK, LOST] });
    expect(screen.getByText("souls.region_backfill.title:2")).toBeInTheDocument();

    const ok = rowOf(2);
    const chip = within(ok).getByRole("button", { name: "common.value.copy_id" });
    expect(chip).toHaveAttribute("data-identifier-variant", "inline");
    expect(chip).toHaveAttribute("title", A);
    expect(within(ok).getByText("Achilles")).toHaveAttribute("title", "Achilles");
    expect(ok).toHaveTextContent("souls.origin_region.UNKNOWN → souls.origin_region.EUROPE");
    expect(ok).toHaveTextContent("souls.region_backfill.status.update");

    const lost = rowOf(5);
    expect(within(lost).getByRole("button", { name: "common.value.copy_id" })).toHaveAttribute("title", NONE);
    expect(lost.querySelectorAll("[data-missing='unrecorded']")).toHaveLength(2); // 名字、值
    expect(lost).not.toHaveTextContent("Achilles");
    expect(lost).not.toHaveTextContent("→");
    expect(lost).toHaveTextContent("souls.region_backfill.status.not_found");
  });

  it("取值不对:原值 →「原文」;重复:第 N 行、值是缺值;无变化只写一个值", () => {
    choose({ rows: [OK, SAME, BAD, DUP] });
    expect(rowOf(6)).toHaveTextContent("souls.origin_region.EUROPE → 「AFRICA」");
    expect(rowOf(6)).toHaveTextContent("Odysseus");
    expect(rowOf(6)).toHaveTextContent("souls.region_backfill.status.bad_value");
    expect(rowOf(7)).toHaveTextContent("souls.region_backfill.status.duplicate:2");
    expect(rowOf(7).querySelectorAll("[data-missing='unrecorded']")).toHaveLength(1);
    expect(rowOf(4)).toHaveTextContent("souls.origin_region.ASIA");
    expect(rowOf(4)).not.toHaveTextContent("→");
  });

  it("改回不详的行加粗,并单独数出来;其余行不加粗", () => {
    choose({ rows: [OK, CLEAR] });
    const bold = document.querySelectorAll("[data-clears]");
    expect(bold).toHaveLength(1);
    expect(bold[0].closest("tr")).toBe(rowOf(3));
    expect(bold[0].className).toContain("font-semibold");
    expect(rowOf(2).querySelector("[data-clears]")).toBeNull();
    expect(screen.getByText("souls.region_backfill.to_unknown:1,souls.origin_region.UNKNOWN")).toBeInTheDocument();
  });

  it("没有改回不详时不出那一行", () => {
    choose({ rows: [OK] });
    expect(screen.queryByText(/souls\.region_backfill\.to_unknown/)).not.toBeInTheDocument();
  });

  it("有问题的行不拦确认:有可更新的行就能点", () => {
    choose({ rows: [OK, LOST, BAD] });
    expect(commitButton()).toBeEnabled();
    expect(commitButton()).toHaveTextContent("souls.region_backfill.commit:1");
    expect(screen.queryByText("souls.region_backfill.nothing_title")).not.toBeInTheDocument();
  });

  it("没有能更新的行:确认变灰,计数下面说原因,表格照常列出", () => {
    choose({ rows: [SAME, LOST] });
    expect(commitButton()).toBeDisabled();
    expect(commitButton()).toHaveTextContent("souls.region_backfill.commit:0");
    expect(screen.getByText("souls.region_backfill.nothing_title")).toBeInTheDocument();
    expect(screen.getByText("souls.region_backfill.nothing_body")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
    fireEvent.click(commitButton());
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("写入失败:留在第 2 步,说没有改动任何灵魂", () => {
    choose({ rows: [OK] });
    mockCommit.mockImplementation((_f: FormData, opts: { onError: (_e: unknown) => void }) => opts.onError(new Error("x")));
    fireEvent.click(commitButton());
    expect(screen.getByRole("alert")).toHaveTextContent("souls.region_backfill.failed");
    expect(screen.getByText("souls.region_backfill.title:2")).toBeInTheDocument();
  });
});

describe("完成", () => {
  function finish(skipped: SoulRegionUpdateRow[]) {
    choose({ rows: [OK, ...skipped] });
    mockCommit.mockImplementation((_f: FormData, opts: { onSuccess: (_r: unknown) => void }) =>
      opts.onSuccess({ updated: 1, unchanged: 0, skipped: skipped.length, rows: skipped }),
    );
    fireEvent.click(commitButton());
  }

  it("先给「下载跳过的行」,模板链接排在后面;下载的是跳过的行", () => {
    finish([LOST, BAD]);
    expect(screen.getByText("souls.region_backfill.title:3")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("souls.region_backfill.done:1,0,2");
    const links = within(screen.getByTestId("region-done-links")).getAllByRole("button");
    expect(links.map((b) => b.textContent)).toEqual(["souls.region_backfill.download_skipped", "souls.import.template"]);
    expect(screen.getByText("souls.region_backfill.skipped_file_note")).toBeInTheDocument();
    fireEvent.click(links[0]);
    const [csv, name] = mockSave.mock.calls[0];
    expect(name).toBe("souls_origin_region_skipped.csv");
    expect(csv).toContain(`${NONE},ASIA,souls.region_backfill.status.not_found`);
    expect(csv).toContain(`${A},AFRICA,souls.region_backfill.status.bad_value`);
    expect(csv).not.toContain("Achilles");
  });

  it("没有跳过的行就只有模板链接", () => {
    finish([]);
    const links = within(screen.getByTestId("region-done-links")).getAllByRole("button");
    expect(links.map((b) => b.textContent)).toEqual(["souls.import.template"]);
    expect(screen.queryByText("souls.region_backfill.skipped_file_note")).not.toBeInTheDocument();
  });
});

describe("文件", () => {
  it("跳过的行沿用文件里那一种标识列,另加一列原因(列名按界面语言)", () => {
    const code = row({ status: "not_found", values: { soul_code: "ABC2345678", origin_region: "亚洲" }, identifier: "ABC2345678", soul_name: null });
    const csv = skippedRowsCsv(t, [code]);
    expect(csv.split("\n")[0]).toBe("﻿soul_code,origin_region,souls.region_backfill.skipped_reason_column");
    expect(csv).not.toContain("soul_id");
  });

  it("模板只有 soul_id, origin_region 两列", async () => {
    render(<SoulRegionBackfillDialog isOpen onClose={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "souls.import.template" }));
    await waitFor(() => expect(mockSave).toHaveBeenCalledTimes(1));
    expect(mockSave.mock.calls[0][0]).toBe(REGION_BACKFILL_TEMPLATE);
    expect(REGION_BACKFILL_TEMPLATE).toBe("﻿soul_id,origin_region\n");
    expect(REGION_BACKFILL_TEMPLATE).not.toContain("soul_code");
  });

  it.each([
    [{ code: "mixed_id_columns", columns: ["soul_id", "soul_code"] }, "souls.region_backfill.file_codes.mixed_id_columns"],
    [{ code: "missing_id_column", columns: ["soul_id", "soul_code"] }, "souls.import.file_codes.missing_columns:soul_id / soul_code"],
    [{ code: "missing_columns", columns: ["origin_region"] }, "souls.import.file_codes.missing_columns:origin_region,"],
    [{ code: "too_many_rows", max_rows: 1000 }, "souls.import.file_codes.too_many_rows:,1000"],
    [{ code: "bad_encoding_gbk" }, "souls.import.file_codes.bad_encoding_gbk:,"],
    [{ code: "something_new" }, "souls.import.file_codes.unknown:,"],
  ])("文件级错误 %j → 文案", (error, text) => {
    expect(regionFileErrorText(t, error)).toBe(text);
  });

  it("文件出错停在第 1 步,错误写在下面,不进预览", () => {
    choose({ error: axiosError(400, { code: "mixed_id_columns", columns: ["soul_id", "soul_code"] }) });
    expect(screen.getByRole("alert")).toHaveTextContent("souls.region_backfill.file_codes.mixed_id_columns");
    expect(screen.getByText("souls.region_backfill.title:1")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
