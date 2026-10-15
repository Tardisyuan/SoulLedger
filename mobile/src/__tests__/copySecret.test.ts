import * as Clipboard from "expo-clipboard";

import { copySecret } from "../copySecret";

// A clipboard that holds one string, like the real one.
let mockHeld = "";
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async (s: string) => ((mockHeld = s), true)),
  getStringAsync: jest.fn(async () => mockHeld),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockHeld = "";
  jest.clearAllMocks();
});
afterEach(() => jest.useRealTimers());

const after = (ms: number) => jest.advanceTimersByTimeAsync(ms);

describe("copySecret", () => {
  it("puts the text on the clipboard and leaves it there before 60 s", async () => {
    await copySecret("abc");
    await after(59_999);
    expect(mockHeld).toBe("abc");
  });

  it("clears it at 60 s when it still holds exactly what we copied", async () => {
    await copySecret("abc");
    await after(60_000);
    expect(mockHeld).toBe("");
  });

  it("leaves it alone when the user copied something else meanwhile", async () => {
    await copySecret("abc");
    mockHeld = "something else";
    await after(60_000);
    expect(mockHeld).toBe("something else");
  });

  it("a second copy restarts the 60 s", async () => {
    await copySecret("abc");
    await after(40_000);
    await copySecret("abc");
    await after(40_000);
    expect(mockHeld).toBe("abc");
    await after(20_000);
    expect(mockHeld).toBe("");
  });

  it("does not clear when the clipboard cannot be read", async () => {
    (Clipboard.getStringAsync as jest.Mock).mockRejectedValueOnce(new Error("no"));
    await copySecret("abc");
    await after(60_000);
    expect(mockHeld).toBe("abc");
  });
});
