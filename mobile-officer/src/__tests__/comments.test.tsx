/** 写评议 on a judgment's page in the 审判 tab: read the others', write one, a failure says so and keeps the text. */
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import { Detail } from "../screens/detail";
import { renderOfficer } from "./harness";

const mockGet = jest.fn();
const mockComments = jest.fn();
const mockAdd = jest.fn();
jest.mock("@soulledger/core/api/judgment", () => ({
  ...jest.requireActual("@soulledger/core/api/judgment"),
  judgmentApi: { get: (...a: unknown[]) => mockGet(...a), comments: (...a: unknown[]) => mockComments(...a), addComment: (...a: unknown[]) => mockAdd(...a) },
}));

const CASE = { id: "j-1", case_number: "CN-2026-1", soul_name: "张三", court: "第一殿", claimed_by_name: "阎罗", is_final: false };
const COMMENT = { id: "c-1", author: 2, author_name: "孟婆", body: "证据链完整", created_at: "2026-10-09T01:00:00Z" };

async function open() {
  mockGet.mockResolvedValue({ data: CASE });
  renderOfficer(<Detail target={{ type: "judgment", id: "j-1" }} onBack={() => {}} onSettled={() => {}} />);
  await screen.findByTestId("judgment-comments");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockComments.mockResolvedValue({ data: [COMMENT] });
});

describe("judgment comments", () => {
  it("shows the others' comments with who wrote them", async () => {
    await open();
    expect(await screen.findByText("证据链完整")).toBeTruthy();
    expect(screen.getByText(/孟婆/)).toBeTruthy();
    expect(screen.getByText("写评议")).toBeTruthy();
  });

  it("posts a trimmed comment, clears the field and reloads the list", async () => {
    mockAdd.mockResolvedValue({ data: { ...COMMENT, id: "c-2", body: "同意" } });
    await open();
    await screen.findByText("证据链完整");
    fireEvent.changeText(screen.getByTestId("comment-input"), "  同意  ");
    fireEvent.press(screen.getByTestId("comment-send"));
    await waitFor(() => expect(mockAdd).toHaveBeenCalledWith("j-1", "同意"));
    await waitFor(() => expect(mockComments.mock.calls.length).toBeGreaterThan(1));
    await waitFor(() => expect(screen.getByTestId("comment-input").props.value).toBe(""));
  });

  it("sends nothing for an empty comment", async () => {
    await open();
    await screen.findByText("证据链完整");
    fireEvent.press(screen.getByTestId("comment-send"));
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("says it failed and keeps what was typed", async () => {
    mockAdd.mockRejectedValue(new Error("Network Error"));
    await open();
    await screen.findByText("证据链完整");
    fireEvent.changeText(screen.getByTestId("comment-input"), "再议");
    fireEvent.press(screen.getByTestId("comment-send"));
    expect(await screen.findByTestId("comment-failed")).toBeTruthy();
    expect(screen.getByTestId("comment-input").props.value).toBe("再议");
  });
});
