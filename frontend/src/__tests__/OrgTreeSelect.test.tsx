/**
 * OrgTreeSelect(数据范围 B6):多选勾父即含子(展示),提交的仍是显式勾选的 id;
 * 搜索保留命中项及其上级;不止一个殿时按殿分组;单选是一组原生 radio。
 */
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Organization } from "@soulledger/core/api";
import { OrgTreeSelect } from "@/src/components/organizations/OrgTreeSelect";

jest.mock("@/src/contexts/I18nContext", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "zh-Hans", hydrated: true }),
}));

const ORGS: Organization[] = [
  { id: 1, name: "地府", code: "ROOT_CN", parent: null, level: 0, sort: 0, tenant: 1 },
  { id: 2, name: "第一殿", code: "D1", parent: 1, level: 1, sort: 0, tenant: 1 },
  { id: 3, name: "判官司", code: "D1J", parent: 2, level: 2, sort: 0, tenant: 1 },
  { id: 4, name: "第二殿", code: "D2", parent: 1, level: 1, sort: 1, tenant: 1 },
  { id: 9, name: "Hades", code: "ROOT_GR", parent: null, level: 0, sort: 0, tenant: 4 },
];

function Multi({ onChange, initial = [] }: { onChange: (_ids: number[]) => void; initial?: number[] }) {
  const [value, setValue] = useState<number[]>(initial);
  return (
    <OrgTreeSelect
      mode="multi"
      label="机构"
      organizations={ORGS}
      tenantNames={new Map([[1, "中国地府"], [4, "希腊冥界"]])}
      value={value}
      onChange={(ids) => {
        setValue(ids);
        onChange(ids);
      }}
    />
  );
}

const box = (name: RegExp) => screen.getByRole("checkbox", { name });

it("checking a parent shows its descendants as included, but only the parent is submitted", () => {
  const onChange = jest.fn();
  render(<Multi onChange={onChange} />);
  fireEvent.click(box(/第一殿/));
  expect(onChange).toHaveBeenLastCalledWith([2]);
  expect(box(/判官司/)).toBeChecked();
  expect(box(/判官司/)).toBeDisabled();
  expect(within(box(/判官司/).closest("label")!).getByText("org_select.implied")).toBeInTheDocument();
  // 平级与上级不受影响
  expect(box(/第二殿/)).not.toBeChecked();
  expect(box(/第二殿/)).toBeEnabled();
  expect(box(/^地府/)).not.toBeChecked();
});

it("checking an ancestor drops descendants that were checked explicitly; unchecking it frees them", () => {
  const onChange = jest.fn();
  render(<Multi onChange={onChange} initial={[3, 4]} />);
  fireEvent.click(box(/第一殿/));
  expect(onChange).toHaveBeenLastCalledWith([4, 2]);
  fireEvent.click(box(/第一殿/));
  expect(onChange).toHaveBeenLastCalledWith([4]);
  expect(box(/判官司/)).not.toBeChecked();
  expect(box(/判官司/)).toBeEnabled();
});

it("groups by hall when there is more than one", () => {
  render(<Multi onChange={jest.fn()} />);
  const cn = screen.getByRole("group", { name: "中国地府" });
  const gr = screen.getByRole("group", { name: "希腊冥界" });
  expect(within(cn).getByRole("checkbox", { name: /第二殿/ })).toBeInTheDocument();
  expect(within(cn).queryByRole("checkbox", { name: /Hades/ })).not.toBeInTheDocument();
  expect(within(gr).getByRole("checkbox", { name: /Hades/ })).toBeInTheDocument();
});

it("search keeps matches and their ancestors, drops the rest", () => {
  render(<Multi onChange={jest.fn()} />);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "判官" } });
  expect(box(/判官司/)).toBeInTheDocument();
  expect(box(/第一殿/)).toBeInTheDocument();
  expect(box(/^地府/)).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /第二殿/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: /Hades/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
  expect(screen.getByText("org_select.no_match")).toBeInTheDocument();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
});

it("single mode: radios in one group, no hall headers for one hall, 'none' only when offered", () => {
  const onChange = jest.fn();
  const oneHall = ORGS.filter((o) => o.tenant === 1);
  const { rerender } = render(
    <OrgTreeSelect mode="single" label="机构" organizations={oneHall} value={2} onChange={onChange} />,
  );
  expect(screen.getByRole("radio", { name: /第一殿/ })).toBeChecked();
  expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  // 只有外层 fieldset 一个组:一个殿不出分组
  expect(screen.getAllByRole("group")).toHaveLength(1);
  expect(screen.queryByRole("radio", { name: "无" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: /第二殿/ }));
  expect(onChange).toHaveBeenLastCalledWith(4);
  // 单选不推「含于上级」
  expect(screen.getByRole("radio", { name: /判官司/ })).toBeEnabled();
  rerender(<OrgTreeSelect mode="single" label="机构" organizations={oneHall} value={null} onChange={onChange} noneLabel="无" />);
  expect(screen.getByRole("radio", { name: "无" })).toBeChecked();
});
