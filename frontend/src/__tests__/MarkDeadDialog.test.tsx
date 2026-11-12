/**
 * F-DEATH-01(2026-11-12):「标记死亡」此前固定发今天 —— 已录的死亡日被覆盖,生年距今超 150 年的灵魂标不了。
 * 已录的:写出那一天、不发日期(后端沿用);没录的:发官员填的那一天。
 */
import { fireEvent, screen } from "@testing-library/react";
import { MarkDeadDialog } from "@/src/components/souls/detail/MarkDeadDialog";
import { renderWithProviders } from "./support/render";

jest.mock("@/src/contexts/I18nContext", () => require("./support/mocks").i18nMock({ locale: "zh-Hans", hydrated: true }));

function renderDialog(recordedDeath: string | null) {
  const onConfirm = jest.fn();
  const onClose = jest.fn();
  renderWithProviders(
    <MarkDeadDialog soulName="苏格拉底" recordedDeath={recordedDeath} isOpen onClose={onClose} onConfirm={onConfirm} />,
    { i18n: false },
  );
  return { onConfirm, onClose };
}

const submit = () => fireEvent.click(screen.getByTestId("mark-dead-submit"));

it("keeps a recorded death date: shows it, offers no date field, and sends no date", () => {
  const { onConfirm, onClose } = renderDialog("公元前 399 年 5 月 7 日");
  expect(screen.getByTestId("mark-dead-recorded")).toHaveTextContent("公元前 399 年 5 月 7 日");
  expect(screen.queryByLabelText(/souls\.death/)).toBeNull();
  submit();
  expect(onConfirm).toHaveBeenCalledWith(undefined);
  expect(onClose).toHaveBeenCalled();
});

it("without a recorded date, sends the date the officer entered, not today", () => {
  const { onConfirm } = renderDialog(null);
  expect(screen.queryByTestId("mark-dead-recorded")).toBeNull();
  fireEvent.change(screen.getByLabelText(/souls\.death/), { target: { value: "1990-05-07" } });
  submit();
  expect(onConfirm).toHaveBeenCalledWith("1990-05-07");
});
