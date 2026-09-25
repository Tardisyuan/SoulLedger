/**
 * `useSoulMediaUploads` (packages/core): the composer's upload queue. The App
 * drives it through its screen tests; here it is driven directly, so the gate
 * (`ready`) and the server-side clean-up (`removeMedia`) are pinned where the
 * core coverage floor measures them.
 */
import { act, renderHook } from "@testing-library/react";
import { useSoulMediaUploads } from "@soulledger/core/hooks/useSoulMediaUploads";

// Only the two calls the hook makes. Not `requireActual`: the soul HTTP client is the
// App's, and this suite has no business loading it (it is exercised by mobile's tests).
jest.mock("@soulledger/core/api/soul-social", () => ({
  soulSocialApi: { uploadMedia: jest.fn(), removeMedia: jest.fn() },
}));
const { soulSocialApi: api } = jest.requireMock("@soulledger/core/api/soul-social") as {
  soulSocialApi: { uploadMedia: jest.Mock; removeMedia: jest.Mock };
};

type Held = { resolve: (_value: unknown) => void; reject: (_error: unknown) => void; progress?: (_fraction: number) => void };
let held: Held[];
const toBody = (s: string) => ({ append: () => {}, source: s }) as unknown as FormData;
const media = (id: string) => ({ id, url: `/api/v1/social-media/${id}/?t=x`, width: 1, height: 1, byte_size: 1, content_type: "image/png" });

beforeEach(() => {
  held = [];
  api.uploadMedia.mockReset().mockImplementation(
    (_body: unknown, progress?: (_fraction: number) => void) =>
      new Promise((resolve, reject) => held.push({ resolve, reject, progress }))
  );
  api.removeMedia.mockReset().mockResolvedValue(undefined);
});

const setup = (max?: number) => renderHook(() => useSoulMediaUploads<string>(toBody, max));

it("uploads each image on its own request; ready only when all are done, ids in pick order", async () => {
  const { result } = setup();
  expect(result.current.ready).toBe(true);
  act(() => void result.current.add(["a", "b"]));
  expect(api.uploadMedia).toHaveBeenCalledTimes(2);
  expect(result.current.items.map((i) => i.status)).toEqual(["uploading", "uploading"]);
  expect(result.current.ready).toBe(false);

  act(() => held[0].progress?.(0.5));
  expect(result.current.items[0].progress).toBe(0.5);

  await act(async () => held[1].resolve(media("B")));
  expect(result.current.ready).toBe(false);
  expect(result.current.mediaIds).toEqual(["B"]);
  await act(async () => held[0].resolve(media("A")));
  expect(result.current.ready).toBe(true);
  expect(result.current.mediaIds).toEqual(["A", "B"]);
});

it("a failure blocks until retried; the retry is a new request for the same image", async () => {
  const { result } = setup();
  act(() => void result.current.add(["a"]));
  await act(async () => held[0].reject(new Error("413")));
  expect(result.current.items[0].status).toBe("failed");
  expect(result.current.failed).toBe(true);
  expect(result.current.ready).toBe(false);

  act(() => result.current.retry(result.current.items[0].key));
  expect(result.current.items[0]).toMatchObject({ status: "uploading", progress: 0, error: null });
  expect(api.uploadMedia).toHaveBeenCalledTimes(2);
  await act(async () => held[1].resolve(media("A")));
  expect(result.current.ready).toBe(true);
});

it("takes only the room left and says how many it took", () => {
  const { result } = setup(3);
  let taken = 0;
  act(() => void (taken = result.current.add(["a", "b"])));
  expect(taken).toBe(2);
  act(() => void (taken = result.current.add(["c", "d", "e"])));
  expect(taken).toBe(1);
  expect(result.current.items).toHaveLength(3);
  expect(result.current.room).toBe(0);
});

it("removing an uploaded image deletes it on the server; a failed one needs no request", async () => {
  const { result } = setup();
  act(() => void result.current.add(["a", "b"]));
  await act(async () => held[0].resolve(media("A")));
  await act(async () => held[1].reject(new Error("x")));
  act(() => result.current.remove(result.current.items[1].key));
  expect(api.removeMedia).not.toHaveBeenCalled();
  act(() => result.current.remove(result.current.items[0].key));
  expect(api.removeMedia).toHaveBeenCalledWith("A");
  expect(result.current.items).toEqual([]);
});

it("removing one still in flight deletes it when it lands, and never shows it again", async () => {
  const { result } = setup();
  act(() => void result.current.add(["a"]));
  act(() => result.current.remove(result.current.items[0].key));
  expect(api.removeMedia).not.toHaveBeenCalled();
  await act(async () => held[0].resolve(media("LATE")));
  expect(api.removeMedia).toHaveBeenCalledWith("LATE");
  expect(result.current.items).toEqual([]);
});

it("discard deletes every upload; clear (after posting) deletes none", async () => {
  const { result } = setup();
  act(() => void result.current.add(["a", "b"]));
  await act(async () => {
    held[0].resolve(media("A"));
    held[1].resolve(media("B"));
  });
  act(() => result.current.clear());
  expect(api.removeMedia).not.toHaveBeenCalled();
  expect(result.current.items).toEqual([]);

  act(() => void result.current.add(["c"]));
  await act(async () => held[2].resolve(media("C")));
  act(() => result.current.discard());
  expect(api.removeMedia).toHaveBeenCalledWith("C");
});

it("defaults to nine per post", () => {
  const { result } = renderHook(() => useSoulMediaUploads<string>(toBody));
  let taken = 0;
  act(() => void (taken = result.current.add(Array.from({ length: 12 }, (_, i) => `s${i}`))));
  expect(taken).toBe(9);
  expect(api.uploadMedia).toHaveBeenCalledTimes(9);
});
