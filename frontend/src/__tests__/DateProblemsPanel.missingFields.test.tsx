/**
 * 后端没给 `date_problems` / 记录列表时,面板按「没有问题」处理,不让灵魂详情页整页崩成 500
 * (2026-11-08:演示站一个旧 id 的灵魂缺这个字段,`undefined.map` 把页面打成错误页)。
 */
import { render, screen } from "@testing-library/react";
import { DateProblemsPanel } from "@/src/components/souls/DateProblemsPanel";

const mockI18n = { t: (key: string) => key, formatDateTime: (v: string) => v, locale: "zh-Hans" };
jest.mock("@/src/contexts/I18nContext", () => ({ useI18n: () => mockI18n }));
jest.mock("@/src/contexts/TenantContext", () => ({
  useTenant: () => ({ user: { id: 1, username: "g", role: "GUARDIAN", tenant: null, permissions: [] } }),
}));
jest.mock("@/src/contexts/ToastContext", () => ({ useToast: () => ({ showToast: jest.fn() }) }));

describe("DateProblemsPanel with missing fields", () => {
  it("renders nothing when both lists are missing", () => {
    const { container } = render(
      <DateProblemsPanel soulId="s" soulProblems={undefined} records={undefined} onChanged={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("still shows the records' problems when the soul's own list is missing", () => {
    render(
      <DateProblemsPanel
        soulId="s"
        soulProblems={undefined}
        records={[{ id: "r", category: "EVENT", date_problems: [{ code: "x", severity: "warning", message: "m" }] } as never]}
        onChanged={() => {}}
      />
    );
    expect(screen.getByText("souls.detail.date_problems.title")).toBeInTheDocument();
  });
});
