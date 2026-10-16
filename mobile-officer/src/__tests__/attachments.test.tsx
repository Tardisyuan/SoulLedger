/** 附件列表合一:随数据带地址的不再去取,要现取的点开才取;PDF 交给系统。 */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Linking } from "react-native";

import { AttachmentList } from "../attachments";
import { renderOfficer } from "./harness";

const pdf = { id: "p1", name: "卷宗.pdf", content_type: "application/pdf", byte_size: 2048 };
const img = { id: "i1", name: "证物.png", content_type: "image/png", byte_size: 4096 };

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(Linking, "openURL").mockResolvedValue(true); });
afterEach(() => jest.restoreAllMocks());

it("opens a carried url without calling resolve", async () => {
  const resolve = jest.fn();
  renderOfficer(<AttachmentList items={[{ ...pdf, url: "/api/v1/case-attachments/p1/?t=a" }]} resolve={resolve} />);
  fireEvent.press(screen.getByTestId("attachment-p1"));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining("/api/v1/case-attachments/p1/?t=a")));
  expect(resolve).not.toHaveBeenCalled();
});

it("fetches the link on press when the row has none, and shows meta on the second line", async () => {
  const resolve = jest.fn().mockResolvedValue("/api/v1/case-attachments/p1/?t=b");
  renderOfficer(<AttachmentList items={[{ ...pdf, meta: "阎罗 · 今天" }, img]} resolve={resolve} />);
  expect(screen.getByText(/阎罗 · 今天/)).toBeTruthy();
  fireEvent.press(screen.getByTestId("attachment-p1"));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining("?t=b")));
  expect(resolve).toHaveBeenCalledTimes(1);
});

it("opens a picture in the viewer, not the system", async () => {
  const resolve = jest.fn().mockResolvedValue("/api/v1/case-attachments/i1/?t=c");
  renderOfficer(<AttachmentList items={[img]} resolve={resolve} />);
  fireEvent.press(screen.getByTestId("attachment-i1"));
  await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
  expect(Linking.openURL).not.toHaveBeenCalled();
});
