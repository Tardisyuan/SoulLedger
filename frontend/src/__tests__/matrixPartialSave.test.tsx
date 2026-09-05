/**
 * 保存在中途失败时,**已经写进服务器的那几个角色必须被说出来**。
 *
 * `useMatrixSave.runSave` 是逐角色串行 PUT 的,第 k 个失败就 `return`。而前
 * k-1 个已经落库了 —— 服务器上的授权已经变了。那份记录着「之前 → 之后」的
 * `summaries` 此前只在**全部成功**的路径上被显示,失败路径连同它一起丢掉。
 *
 * 于是屏幕上是一句泛用的「保存失败」,而服务器上有一半角色已经改了。
 * **这不是少说了一句话,是让操作员对已经发生的事实产生错误认知** —— 他下一步
 * 很可能整体重试,而重试会把已经成功的那几个按旧版本号再 PUT 一遍,撞 409,
 * 而 409 的横幅说的是「别人改过」,并不是。
 */
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { useMatrixSave } from "@/src/components/permissions/useMatrixSave";
import { permApi, type Permission, type Role } from "@soulledger/core/api";

jest.mock("@soulledger/core/api", () => ({
  permApi: { assign: jest.fn() },
}));

const mockShowToast = jest.fn();
jest.mock("@/src/contexts/ToastContext", () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({
    // 参数原样拼进来,这样断言看得见 role/before/after 三个值。
    t: (key: string, params?: Record<string, string>) =>
      params ? `${key}:${Object.values(params).join(",")}` : key,
    locale: "en",
    hydrated: true,
  }),
}));

const mockAssign = permApi.assign as jest.Mock;

const PERMS: Record<number, Permission> = {
  1: { id: 1, codename: "soul.read", name: "读灵魂", category: "soul" } as Permission,
  2: { id: 2, codename: "soul.update", name: "改灵魂", category: "soul" } as Permission,
};

const ROLE_META: Record<string, Role> = {
  JUDGE: { id: 1, name: "JUDGE", display_name: "判官", version: 3 } as Role,
  CLERK: { id: 2, name: "CLERK", display_name: "书记", version: 5 } as Role,
};

/** 两个角色各加一条授权 —— 纯新增,tier 1,`handleSaveClick` 直接跑,不弹确认框。 */
function setup() {
  const baseline = { JUDGE: new Set<number>(), CLERK: new Set<number>() };
  const checked = { JUDGE: new Set<number>([1]), CLERK: new Set<number>([2]) };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () =>
      useMatrixSave({
        checked,
        setChecked: jest.fn(),
        baseline,
        roleNames: ["JUDGE", "CLERK"],
        permsById: PERMS,
        roleMeta: ROLE_META,
      }),
    { wrapper }
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("矩阵保存中途失败", () => {
  it("把已经落库的角色交出来,而不是跟着 return 一起丢掉", async () => {
    // 第一个成功,第二个 500。
    mockAssign
      .mockResolvedValueOnce({ data: { version: 4 } })
      .mockRejectedValueOnce({ response: { status: 500 } });

    const { result } = setup();
    await act(async () => {
      result.current.handleSaveClick();
    });

    // 两个都发出去了,第一个真的落库了。
    expect(mockAssign).toHaveBeenCalledTimes(2);
    expect(result.current.savedBeforeFailure).toHaveLength(1);
    // 内容是「角色 之前 → 之后」,不是一句泛泛的「有些成功了」——
    // 操作员要知道的是**哪一个**。
    expect(result.current.savedBeforeFailure[0]).toContain("判官");
    // 失败仍然被报出来,两件事各说各的。
    expect(mockShowToast).toHaveBeenCalledWith("permissions.matrix.save_error", "error");
  });

  it("409 也一样 —— 冲突横幅说不出前面那些已经成功了", async () => {
    mockAssign
      .mockResolvedValueOnce({ data: { version: 4 } })
      .mockRejectedValueOnce({
        response: { status: 409, data: { expected_version: 5, current_version: 6 } },
      });

    const { result } = setup();
    await act(async () => {
      result.current.handleSaveClick();
    });

    expect(result.current.conflict).toMatchObject({ role: "CLERK" });
    // 两条同时在场:冲突说「这一个没成」,部分保存说「那一个成了」。
    expect(result.current.savedBeforeFailure).toHaveLength(1);
    expect(result.current.savedBeforeFailure[0]).toContain("判官");
  });

  it("全部成功时清单是空的 —— 它只描述「中途停下」这一种情况", async () => {
    mockAssign
      .mockResolvedValueOnce({ data: { version: 4 } })
      .mockResolvedValueOnce({ data: { version: 6 } });

    const { result } = setup();
    await act(async () => {
      result.current.handleSaveClick();
    });

    // 缺席断言:成功路径此前就会把 summaries 弹成一条 success toast,
    // 那条路径不变,这个横幅不许在那里出现。
    expect(result.current.savedBeforeFailure).toEqual([]);
    expect(mockShowToast).toHaveBeenCalledWith(expect.stringContaining("判官"), "success");
  });

  it("第一个角色就失败时,清单是空的 —— 没有东西落库", async () => {
    mockAssign.mockRejectedValueOnce({ response: { status: 500 } });

    const { result } = setup();
    await act(async () => {
      result.current.handleSaveClick();
    });

    expect(mockAssign).toHaveBeenCalledTimes(1);
    expect(result.current.savedBeforeFailure).toEqual([]);
  });

  it("下一次保存会清掉上一次留下的清单", async () => {
    mockAssign
      .mockResolvedValueOnce({ data: { version: 4 } })
      .mockRejectedValueOnce({ response: { status: 500 } });

    const { result } = setup();
    await act(async () => {
      result.current.handleSaveClick();
    });
    expect(result.current.savedBeforeFailure).toHaveLength(1);

    mockAssign
      .mockResolvedValueOnce({ data: { version: 4 } })
      .mockResolvedValueOnce({ data: { version: 6 } });
    await act(async () => {
      result.current.handleSaveClick();
    });

    // 上一次失败的清单不属于这一次。
    expect(result.current.savedBeforeFailure).toEqual([]);
  });
});
