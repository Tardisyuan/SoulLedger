/** 案卷附件上传(第五十四批 P-1/P-2):入口、进度行、失败重试 / 移除、离线置灰、没认领一行、结案无入口。 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { OnlineContext } from "../../../mobile/src/online";
import { CaseUpload } from "../screens/caseUpload";
import { httpError, renderOfficer } from "./harness";

const mockPick = jest.fn();
const mockUpload = jest.fn();
jest.mock("../attachmentPicker", () => ({
  pickerAvailable: () => true,
  pickFiles: (...a: unknown[]) => mockPick(...a),
}));
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: { uploadAttachment: (...a: unknown[]) => mockUpload(...a) },
}));

const list = { items: [], count: 0, total_bytes: 0, max_file_bytes: 20 * 1048576, max_total_bytes: 100 * 1048576, max_count: 30, concluded: false } as never;
const photo = { uri: "file:///a.jpg", name: "a.jpg", type: "image/jpeg", size: 1000 };
const ui = (over: Partial<Parameters<typeof CaseUpload>[0]> = {}) => <CaseUpload judgmentId="j1" list={list} canWrite onUploaded={() => {}} {...over} />;

beforeEach(() => { mockPick.mockReset(); mockUpload.mockReset(); });

it("uploads a picked photo and tells the parent to reload", async () => {
  mockPick.mockResolvedValue([photo]);
  mockUpload.mockResolvedValue({});
  const onUploaded = jest.fn();
  renderOfficer(ui({ onUploaded }));
  fireEvent.press(screen.getByTestId("attach-camera"));
  await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1));
  expect(mockPick).toHaveBeenCalledWith("camera");
  expect(screen.queryByTestId("attach-row-1")).toBeNull();
});

it("a refused file keeps its row with only 移除; a network failure offers 重试", async () => {
  mockPick.mockResolvedValue([photo]);
  mockUpload.mockRejectedValueOnce(httpError(409, { code: "too_many" })).mockRejectedValueOnce(new Error("net"));
  renderOfficer(ui());
  fireEvent.press(screen.getByTestId("attach-library"));
  expect(await screen.findByTestId("attach-remove-1")).toBeTruthy();
  expect(screen.queryByTestId("attach-retry-1")).toBeNull();
  fireEvent.press(screen.getByTestId("attach-remove-1"));
  expect(screen.queryByTestId("attach-row-1")).toBeNull();
  fireEvent.press(screen.getByTestId("attach-library"));
  expect(await screen.findByTestId("attach-retry-2")).toBeTruthy();
});

it("refuses a wrong type without sending", async () => {
  mockPick.mockResolvedValue([{ ...photo, name: "a.zip", type: "application/zip" }]);
  renderOfficer(ui());
  fireEvent.press(screen.getByTestId("attach-file"));
  expect(await screen.findByTestId("attach-remove-1")).toBeTruthy();
  expect(mockUpload).not.toHaveBeenCalled();
});

it("offline: the three entries are inert and the reason is written", () => {
  renderOfficer(<OnlineContext.Provider value={{ offline: true, back: 0 }}>{ui()}</OnlineContext.Provider>);
  fireEvent.press(screen.getByTestId("attach-camera"));
  expect(mockPick).not.toHaveBeenCalled();
  expect(screen.getByTestId("attach-offline")).toBeTruthy();
});

it("not claimed: one line, no entries; concluded: no entries", () => {
  const a = renderOfficer(ui({ canWrite: false }));
  expect(screen.getByTestId("attach-need-claim")).toBeTruthy();
  expect(screen.queryByTestId("attach-camera")).toBeNull();
  a.unmount();
  renderOfficer(ui({ list: { ...(list as object), concluded: true } as never }));
  expect(screen.getByTestId("attach-concluded")).toBeTruthy();
  expect(screen.queryByTestId("attach-camera")).toBeNull();
});
