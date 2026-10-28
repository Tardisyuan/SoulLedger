/**
 * 地府审判台的罪目与枉死城(Design 第五十七批 D-1、D-2、D-2b)。Real QueryClient; HTTP and copy are stubbed —
 * `t` echoes the key and its params, so an assertion names the key it expects rather than a translation.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { wangsiApi, type Judgment } from "@soulledger/core/api";
import { OffenceField, WangsiPanel, untimelyLine } from "@/src/components/judgment/DiyuCaseFields";

jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  judgmentApi: { update: jest.fn() },
  wangsiApi: { fileGrievance: jest.fn(), decideGrievance: jest.fn() },
}));
const t = (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k);
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({
    t: (k: string, p?: Record<string, string>) => (p ? `${k}|${JSON.stringify(p)}` : k),
    locale: "zh-Hans",
    hydrated: true,
    formatDate: (v: string) => `D(${v})`,
    formatDateTime: (v: string) => `DT(${v})`,
  }),
}));

const decide = wangsiApi.decideGrievance as jest.Mock;

const judgment = (over: Partial<Judgment> = {}) =>
  ({
    id: "j-1",
    soul_name: "钱谦益",
    civilization: "CHINESE",
    untimely: true,
    held_until: "2999-11-03",
    offence: "",
    wrongful_death_cause: "",
    grievance_level: "",
    grievance_status: "",
    grievance_plea: "",
    grievance_note: "",
    grievance_decided_at: null,
    ...over,
  }) as Judgment;

function renderIt(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => jest.resetAllMocks());

describe("罪目 (D-1)", () => {
  it("选了罪目:浅底块写送哪一殿、殿王,狱名小字", () => {
    renderIt(<OffenceField judgment={judgment({ offence: "MURDER" })} editable />);
    const route = screen.getByTestId("desk-offence-route");
    expect(route).toHaveTextContent("judgment.offence_field.routes_to");
    expect(route).toHaveTextContent("workflow.court.court_9 · judgment.offence_field.kings.9");
    expect(route).toHaveTextContent("judgment.offence_field.hells.9");
    expect(screen.getByRole("combobox")).toHaveValue("judgment.offences.MURDER");
  });

  it("未填:占位写在控件里,不另起一行", () => {
    renderIt(<OffenceField judgment={judgment()} editable />);
    expect(screen.getByRole("combobox")).toHaveAttribute("placeholder", "judgment.offence_field.placeholder");
    expect(screen.queryByTestId("desk-offence-route")).toBeNull();
  });

  it("只读:一行纯文字,没有控件也没有提示", () => {
    renderIt(<OffenceField judgment={judgment({ offence: "MURDER" })} editable={false} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByTestId("desk-offence")).toHaveTextContent("workflow.court.court_9");
    expect(screen.queryByTestId("desk-offence-route")).toBeNull();
  });
});

describe("枉死城 (D-2 / D-2b)", () => {
  it("块头与页头同一句;冤情是分段", () => {
    const j = judgment({ grievance_level: "MINOR" });
    renderIt(<WangsiPanel judgment={j} editable />);
    expect(screen.getByTestId("wangsi-head-line")).toHaveTextContent(untimelyLine(j, t as never, ((v: string) => `D(${v})`) as never));
    const level = screen.getByRole("radiogroup", { name: "judgment.wangsi.level" });
    expect(within(level).getAllByRole("radio")).toHaveLength(4);
    expect(within(level).getByRole("radio", { name: "judgment.grievance_levels.MINOR" })).toHaveAttribute("aria-checked", "true");
  });

  it("冤情不到「重」:属实按钮置灰,原因写在按钮下", () => {
    renderIt(<WangsiPanel judgment={judgment({ grievance_level: "MINOR", grievance_status: "FILED" })} editable />);
    fireEvent.change(screen.getByRole("textbox", { name: "judgment.wangsi.decision_note" }), { target: { value: "查实" } });
    expect(screen.getByTestId("wangsi-uphold")).toBeDisabled();
    expect(screen.getByTestId("wangsi-release-gate")).toHaveTextContent("judgment.wangsi.release_gate");
  });

  it("属实要二次确认,确认后才发出", async () => {
    decide.mockResolvedValue({});
    renderIt(<WangsiPanel judgment={judgment({ grievance_level: "MAJOR", grievance_status: "FILED" })} editable />);
    expect(screen.queryByTestId("wangsi-release-gate")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "judgment.wangsi.decision_note" }), { target: { value: "查实" } });
    fireEvent.click(screen.getByTestId("wangsi-uphold"));
    expect(decide).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("judgment.wangsi.release_irreversible");
    fireEvent.click(within(dialog).getByRole("button", { name: "judgment.wangsi.uphold" }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith("j-1", true, "查实", false));
  });

  it("判不实后回到可提交,上一条记录灰字留在提交框下面", () => {
    renderIt(
      <WangsiPanel
        judgment={judgment({ grievance_level: "MAJOR", grievance_status: "REJECTED", grievance_plea: "死于他人设局", grievance_decided_at: "2026-10-27T10:00:00Z" })}
        editable
      />,
    );
    const plea = screen.getByRole("textbox", { name: "judgment.wangsi.plea" });
    const last = screen.getByTestId("wangsi-grievance-status");
    expect(plea.compareDocumentPosition(last) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(last.className).toContain("ink-subtle");
  });

  it("提前释放后那一行改成「枉死 · 日期 已提前释放」", () => {
    const line = untimelyLine(
      judgment({ grievance_status: "UPHELD", grievance_decided_at: "2026-10-28T09:00:00Z" }),
      t as never,
      ((v: string) => `D(${v})`) as never,
    );
    expect(line).toBe('judgment.wangsi.released_line|{"date":"D(2026-10-28T09:00:00Z)"}');
  });
});
