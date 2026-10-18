/**
 * 手动发起审批的弹层(Design 第三十七批 W-11b / W-11c)。
 *
 * 守:灵魂 → 案件类型 → 模板的依赖;模板「默认 / 只有一个 / 下拉」三态(默认取后端 `_resolve_template`
 * 会取的那个:本殿、已启用、文明相符、有节点、同类型,列表次序的第一个);「跟随模板」时请求里没有 priority;
 * 每一种拒绝映射到哪句话、哪一格加粗,改了那一格提示就消失;只有 duplicate 带「去看那条」;
 * 理由为空不出提示条;成功跳到新审批并报 toast。
 *
 * `t` 回显键,带参数时写成 `key(值,值)`,所以断言里看得到插进去的是什么。枚举名(文明、案件类型)例外:
 * `resolveEnumDisplay` 把「回显键」当作没译,会给出 `common.value.unrecognized`,所以这几个键给真译名 ——
 * 断言因此也守住了「插进去的是译名,不是原值」。
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Soul } from "@soulledger/core/api";
import { StartWorkflowDialog, startWorkflowRefusal } from "@/src/components/workflow/StartWorkflowDialog";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush }) }));

const mockToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: mockToast }) }));

const mockLabels: Record<string, string> = {
  "souls.civilizations.CHINESE": "中国",
  "workflow.case_types.ROUTINE": "常规审判",
  "workflow.case_types.SPECIAL": "特案审判",
};
const mockT = (key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(",")})` : (mockLabels[key] ?? key);
jest.mock("@/src/contexts/I18nContext", () => ({
  ...jest.requireActual("@/src/contexts/I18nContext"),
  useI18n: () => ({ t: mockT, tf: (_k: string, f: string) => f, locale: "en", hydrated: true }),
}));

const mockStart = jest.fn();
const mockCaseTypes = jest.fn();
const mockTemplates = jest.fn();
const mockSoulsList = jest.fn();
const mockJudgments = jest.fn();
const mockPreview = jest.fn();
jest.mock("@soulledger/core/api", () => ({
  ...jest.requireActual("@soulledger/core/api"),
  workflowApi: {
    start: (...a: unknown[]) => mockStart(...a),
    caseTypes: (...a: unknown[]) => mockCaseTypes(...a),
    templates: { list: (...a: unknown[]) => mockTemplates(...a) },
    flowPreview: (...a: unknown[]) => mockPreview(...a),
  },
  soulsApi: { list: (...a: unknown[]) => mockSoulsList(...a) },
  judgmentApi: { list: (...a: unknown[]) => mockJudgments(...a) },
}));

const mockSoulDetail = jest.fn();
jest.mock("@soulledger/core/hooks/useSouls", () => ({
  ...jest.requireActual("@soulledger/core/hooks/useSouls"),
  useSoul: (id: string) => ({ data: id ? mockSoulDetail(id) : undefined }),
}));

const SOUL = {
  id: "soul-1",
  name: "周阿满",
  civilization: "CHINESE",
  tenant_code: "CN_DIYU",
  tenant: 1,
} as unknown as Soul;

const tpl = (over: Record<string, unknown>) => ({
  id: "t1",
  name: "转生复核（三审）",
  description: "",
  civilization: "CHINESE",
  case_type: "ROUTINE",
  priority: 0,
  is_active: true,
  created_at: "2026-10-01T00:00:00Z",
  node_count: 3,
  tenant: 1,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockCaseTypes.mockResolvedValue({ data: [{ value: "ROUTINE", builtin: true }, { value: "SPECIAL", builtin: false }] });
  mockTemplates.mockResolvedValue({ data: [] });
  mockJudgments.mockResolvedValue({ data: { count: 0, results: [] } });
  mockSoulsList.mockResolvedValue({ data: { count: 1, results: [SOUL] } });
  mockSoulDetail.mockReturnValue(SOUL);
  mockStart.mockResolvedValue({ data: { id: "wf-new" } });
  mockPreview.mockResolvedValue({
    data: {
      name: "十殿审判流程",
      stations: [
        { node_order: 1, node_name: "分流", court_code: "一殿", approver: "秦广王", approver_role: null, is_required: false },
        { node_order: 2, node_name: "复核", court_code: "三殿", approver: "宋帝王", approver_role: null, is_required: false },
        { node_order: 3, node_name: "终审", court_code: "十殿", approver: "转轮王", approver_role: null, is_required: true },
      ],
      foreign: [],
    },
  });
});

function renderDialog(props: { lockedSoul?: Soul } = { lockedSoul: SOUL }) {
  const onClose = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <StartWorkflowDialog isOpen onClose={onClose} {...props} />
    </QueryClientProvider>
  );
  return { onClose };
}

const caseTypeSelect = () => screen.getByLabelText(/workflow\.detail\.case_type/) as HTMLSelectElement;
const reasonBox = () => screen.getByLabelText(/^workflow\.start\.reason\*?$/) as HTMLTextAreaElement;
/** 第 1 步「下一步」(W-1a:选站是第 2 步),再「发起」。理由为空时停在第 1 步,不点第二下。 */
const submit = () => {
  const next = screen.queryByRole("button", { name: "workflow.pick.next" });
  if (next) fireEvent.click(next);
  const go = screen.queryByRole("button", { name: "workflow.start.submit" });
  if (go) fireEvent.click(go);
};

async function pickCaseType(value = "ROUTINE") {
  await waitFor(() => expect(within(caseTypeSelect()).getAllByRole("option").length).toBeGreaterThan(1));
  fireEvent.change(caseTypeSelect(), { target: { value } });
}

async function fillAndSubmit() {
  await pickCaseType();
  fireEvent.change(reasonBox(), { target: { value: "复核" } });
  submit();
}

describe("StartWorkflowDialog — 灵魂与依赖", () => {
  it("从灵魂详情打开:灵魂锁定(没有搜索框),写出文明与殿", async () => {
    renderDialog();
    expect(screen.queryByRole("combobox", { name: /workflow\.start\.soul/ })).not.toBeInTheDocument();
    expect(screen.getByText("周阿满")).toBeInTheDocument();
    const placeText = document.querySelector("[data-soul-place]");
    expect(placeText).toHaveTextContent("中国 · plaque.office.court.cn");
    expect(within(placeText as HTMLElement).getByTitle("CHINESE")).toHaveTextContent("中国");
    await waitFor(() => expect(mockCaseTypes).toHaveBeenCalledWith({ soul: "soul-1" }));
  });

  it("没选灵魂时案件类型不可用,写「先选灵魂」;选了灵魂才按它取案件类型", async () => {
    renderDialog({});
    expect(caseTypeSelect()).toBeDisabled();
    expect(within(caseTypeSelect()).getByRole("option", { name: "workflow.start.case_type_placeholder" })).toBeInTheDocument();
    expect(mockCaseTypes).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/workflow\.start\.soul/), { target: { value: "周" } });
    await waitFor(() => expect(mockSoulsList).toHaveBeenCalledWith({ page: 1, search: "周" }));
    const option = await screen.findByRole("option", { name: "周阿满 · 中国 · plaque.office.court.cn" });
    fireEvent.click(option);

    await waitFor(() => expect(mockCaseTypes).toHaveBeenCalledWith({ soul: "soul-1" }));
    await waitFor(() => expect(caseTypeSelect()).toBeEnabled());
    expect(within(caseTypeSelect()).getByRole("option", { name: "常规审判" })).toBeInTheDocument();
  });

  it("关联审判只列这个灵魂的;已有审批的置灰并标「已有审批」", async () => {
    mockJudgments.mockResolvedValue({
      data: {
        count: 2,
        results: [
          { id: "j1", case_number: "CN-2026-0001", workflow: null },
          { id: "j2", case_number: "CN-2026-0002", workflow: "wf-old" },
        ],
      },
    });
    renderDialog();
    await waitFor(() => expect(mockJudgments).toHaveBeenCalledWith({ soul: "soul-1" }));
    const select = screen.getByLabelText(/workflow\.start\.judgment$/);
    const free = await within(select).findByRole("option", { name: "CN-2026-0001" });
    const taken = within(select).getByRole("option", { name: "CN-2026-0002 · workflow.start.judgment_taken" });
    expect(free).not.toBeDisabled();
    expect(taken).toBeDisabled();
  });
});

describe("StartWorkflowDialog — 模板", () => {
  it("没有可用的存好的模板:只写一行 template_only,名字是案件类型,不出下拉", async () => {
    renderDialog();
    await pickCaseType();
    expect(screen.getByText("workflow.start.template_only(常规审判)")).toBeInTheDocument();
    expect(screen.queryByLabelText(/workflow\.detail\.template/)).not.toBeInTheDocument();
  });

  it("恰好一个可用:只写那一个的名字", async () => {
    mockTemplates.mockResolvedValue({ data: [tpl({})] });
    renderDialog();
    await pickCaseType();
    expect(await screen.findByText("workflow.start.template_only(转生复核（三审）)")).toBeInTheDocument();
  });

  it("多个可用:下拉,默认一项写第一个的名字;别殿、停用、别的文明、空节点、别的类型都不列", async () => {
    mockTemplates.mockResolvedValue({
      data: [
        tpl({ id: "a", name: "甲流程" }),
        tpl({ id: "b", name: "乙流程" }),
        tpl({ id: "x1", name: "别殿", tenant: 2 }),
        tpl({ id: "x2", name: "停用", is_active: false }),
        tpl({ id: "x3", name: "欧洲", civilization: "EUROPEAN" }),
        tpl({ id: "x4", name: "空", node_count: 0 }),
        tpl({ id: "x5", name: "别类", case_type: "SPECIAL" }),
      ],
    });
    renderDialog();
    await pickCaseType();
    const select = (await screen.findByLabelText(/workflow\.detail\.template/)) as HTMLSelectElement;
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "workflow.start.template_default(甲流程)",
      "甲流程",
      "乙流程",
    ]);
    expect(select.value).toBe("");
  });

  it("留在默认:请求带 case_type 不带 template;换了模板:只带 template", async () => {
    mockTemplates.mockResolvedValue({ data: [tpl({ id: "a", name: "甲" }), tpl({ id: "b", name: "乙" })] });
    renderDialog();
    await fillAndSubmit();
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][0]).toEqual({ soul: "soul-1", case_type: "ROUTINE", reason: "复核" });

    mockStart.mockClear();
    fireEvent.change(screen.getByLabelText(/workflow\.detail\.template/), { target: { value: "b" } });
    submit();
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][0]).toEqual({ soul: "soul-1", template: "b", reason: "复核" });
  });
});

describe("StartWorkflowDialog — 优先级与理由", () => {
  it("默认「跟随模板」:请求里没有 priority;选了特急就是 2", async () => {
    renderDialog();
    const follow = screen.getByRole("button", { name: "workflow.start.priority_template" });
    expect(follow).toHaveAttribute("aria-pressed", "true");
    await fillAndSubmit();
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][0]).not.toHaveProperty("priority");

    mockStart.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "workflow.detail.critical" }));
    submit();
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][0]).toMatchObject({ priority: 2 });
  });

  it("字数计数跟着理由走,上限 1000", async () => {
    renderDialog();
    expect(screen.getByText("workflow.start.reason_count(0)")).toBeInTheDocument();
    fireEvent.change(reasonBox(), { target: { value: "一二三" } });
    expect(screen.getByText("workflow.start.reason_count(3)")).toBeInTheDocument();
    expect(reasonBox()).toHaveAttribute("maxLength", "1000");
  });

  it("理由为空:不发请求,不出提示条,只在理由框下写 reason_required", async () => {
    renderDialog();
    await pickCaseType();
    submit();
    expect(await screen.findByText("workflow.start.errors.reason_required")).toBeInTheDocument();
    expect(mockStart).not.toHaveBeenCalled();
    expect(document.querySelector("form > [role=alert]")).toBeNull();
  });
});

describe("StartWorkflowDialog — 结果", () => {
  it("成功:报 done,关弹层,跳到新审批", async () => {
    const { onClose } = renderDialog();
    await fillAndSubmit();
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/workflow/wf-new"));
    expect(mockToast).toHaveBeenCalledWith("workflow.start.done", "success");
    expect(onClose).toHaveBeenCalled();
  });

  it("duplicate:提示条写类型与编号,案件类型加粗,「去看那条」关弹层并跳过去;值不丢", async () => {
    mockStart.mockRejectedValue({
      response: {
        status: 409,
        data: { code: "workflow_in_progress", workflow: "abcdef12-3456-4789-8abc-def012345678", status: "IN_PROGRESS", case_type: "ROUTINE" },
      },
    });
    const { onClose } = renderDialog();
    await fillAndSubmit();
    const alert = await screen.findByText("workflow.start.errors.duplicate(常规审判,abcdef12)");
    expect(reasonBox().value).toBe("复核");
    expect(caseTypeSelect().value).toBe("ROUTINE");
    expect(caseTypeSelect().closest("[data-field]")?.className).toContain("[&_select]:border-2");
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(within(alert.parentElement as HTMLElement).getByRole("button", { name: "workflow.start.errors.duplicate_view" }));
    expect(onClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith("/workflow/abcdef12-3456-4789-8abc-def012345678");
  });

  it("改了出错的那一格,提示条就消失", async () => {
    mockStart.mockRejectedValue({
      response: { status: 409, data: { code: "workflow_in_progress", workflow: "w2", case_type: "ROUTINE" } },
    });
    renderDialog();
    await fillAndSubmit();
    await screen.findByText(/workflow\.start\.errors\.duplicate\(/);
    fireEvent.change(caseTypeSelect(), { target: { value: "SPECIAL" } });
    expect(screen.queryByText(/workflow\.start\.errors\.duplicate\(/)).not.toBeInTheDocument();
  });

  it("其他拒绝没有「去看那条」", async () => {
    mockStart.mockRejectedValue({ response: { status: 403, data: { detail: "nope" } } });
    renderDialog();
    await fillAndSubmit();
    expect(await screen.findByText("workflow.start.errors.forbidden")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "workflow.start.errors.duplicate_view" })).not.toBeInTheDocument();
  });
});

describe("startWorkflowRefusal — 每个错误码对应哪句话、哪一格", () => {
  const refusal = (status: number, data: Record<string, unknown>) => startWorkflowRefusal({ response: { status, data } }, mockT);

  it.each([
    [404, { code: "soul_not_found" }, "workflow.start.errors.soul_not_found", "soul"],
    [404, { code: "template_not_found" }, "workflow.start.errors.template_invalid", "template"],
    [404, { code: "judgment_not_found" }, "workflow.start.errors.judgment_mismatch", "judgment"],
    [409, { code: "judgment_has_workflow" }, "workflow.start.errors.judgment_taken", "judgment"],
    [403, { detail: "x" }, "workflow.start.errors.forbidden", null],
    [500, {}, "workflow.start.errors.failed", null],
    [400, { reason: ["This field is required."] }, "workflow.start.errors.failed", null],
  ])("%s %j → %s", (status, data, message, field) => {
    const r = refusal(status, data);
    expect(r).toEqual({ message, field });
    expect(r).not.toHaveProperty("viewId");
  });

  it("400 invalid_case_type → case_type_civ,插的是文明的名字(需要调用方给出灵魂的文明)", () => {
    const r = startWorkflowRefusal({ response: { status: 400, data: { code: "invalid_case_type" } } }, mockT, "CHINESE");
    expect(r).toEqual({ message: "workflow.start.errors.case_type_civ(中国)", field: "case_type" });
  });

  it("没有响应(网络断了)→ failed", () => {
    expect(startWorkflowRefusal(new Error("Network Error"), mockT)).toEqual({ message: "workflow.start.errors.failed", field: null });
  });

  it("只有 workflow_in_progress 带 viewId", () => {
    const r = refusal(409, { code: "workflow_in_progress", workflow: "w9", case_type: "SPECIAL" });
    expect(r.viewId).toBe("w9");
    expect(r.field).toBe("case_type");
  });

  it("duplicate 的编号写审批编号(WF-0582);没带编号的老后端才退回 uuid 前 8 位", () => {
    const withNumber = refusal(409, {
      code: "workflow_in_progress", workflow: "abcdef12-3456-4789-8abc-def012345678", number: "WF-0582", case_type: "ROUTINE",
    });
    expect(withNumber.message).toBe("workflow.start.errors.duplicate(常规审判,WF-0582)");
    expect(withNumber.message).not.toContain("abcdef12");
    // 跳转仍用 id:编号只给人读。
    expect(withNumber.viewId).toBe("abcdef12-3456-4789-8abc-def012345678");
  });
});

describe("StartWorkflowDialog — 审批编号", () => {
  it("提示条里写 409 带回来的审批编号", async () => {
    mockStart.mockRejectedValue({
      response: { status: 409, data: { code: "workflow_in_progress", workflow: "w-uuid-0001", number: "WF-0582", case_type: "ROUTINE" } },
    });
    renderDialog();
    await fillAndSubmit();
    expect(await screen.findByText("workflow.start.errors.duplicate(常规审判,WF-0582)")).toBeInTheDocument();
  });
});

describe("StartWorkflowDialog — 第 2 步选站(第四十三批 W-1a)", () => {
  async function toStations() {
    renderDialog();
    await pickCaseType();
    fireEvent.change(reasonBox(), { target: { value: "复核" } });
    fireEvent.click(screen.getByRole("button", { name: "workflow.pick.next" }));
    return screen.findByTestId("station-picker");
  }

  it("按灵魂与案件类型取本域的站;终审勾灰点不动,不发请求就不算选站", async () => {
    await toStations();
    expect(mockPreview).toHaveBeenCalledWith({ soul: "soul-1", case_type: "ROUTINE" });
    const final = await screen.findByRole("checkbox", { name: /3 · 终审/ });
    expect(final).toBeChecked();
    expect(final).toBeDisabled();
    fireEvent.click(final);
    expect(final).toBeChecked();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("取消勾选的站以站序送进 skip_node_orders;全选时请求里没有这一项", async () => {
    await toStations();
    fireEvent.click(await screen.findByRole("checkbox", { name: /1 · 分流/ }));
    fireEvent.click(screen.getByRole("button", { name: "workflow.start.submit" }));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart.mock.calls[0][0]).toMatchObject({ skip_node_orders: [1] });
    expect(mockStart.mock.calls[0][0].skip_node_orders).not.toContain(3);
  });

  it("「上一步」回到表单,已填的不丢", async () => {
    await toStations();
    fireEvent.click(screen.getByRole("button", { name: "workflow.pick.back" }));
    expect(screen.queryByTestId("station-picker")).not.toBeInTheDocument();
    expect(reasonBox().value).toBe("复核");
  });
});
