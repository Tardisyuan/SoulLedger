/**
 * The web refresh token is an httpOnly cookie the API sets (2026-10-29 decision 16,
 * `backend/apps/authentication/refresh_cookie.py`). The file name is historical: this used to pin the
 * lifetime of a JS-written cookie that held the token itself.
 *
 * What is pinned now:
 * - the web adapter declares `refreshCookie`, so the core client sends credentials + `X-Auth-Cookie: 1`;
 * - `setRefreshToken` never writes the token into a script-readable cookie — only the marker "1", for
 *   `proxy.ts`, which cannot see the API origin's cookie (asserted absent as well as present);
 * - a silent refresh posts no body (the cookie is the credential) and still writes only the marker.
 */
import axios from "axios";
import { rotateRefreshToken } from "@soulledger/core/api/client";
import { configurePlatform, setRefreshToken, usesRefreshCookie } from "@soulledger/core/platform";
import { MARKER_MAX_AGE, REFRESH_TOKEN_KEY, webPlatform } from "@/lib/platform/web";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: jest.fn(async () => ({ data: { access: "NEW-ACCESS" } })),
    create: () => ({ interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } } }),
  },
}));

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoicmVmcmVzaCJ9.signature";

let writes: string[] = [];
const cookieDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")!;

beforeEach(() => {
  writes = [];
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => cookieDescriptor.get!.call(document),
    set: (value: string) => {
      writes.push(value);
      cookieDescriptor.set!.call(document, value);
    },
  });
  configurePlatform(webPlatform);
  (axios.post as jest.Mock).mockClear();
});

afterEach(() => {
  delete (document as unknown as { cookie?: string }).cookie;
});

function refreshWrites(): string[] {
  return writes.filter((w) => w.startsWith(`${REFRESH_TOKEN_KEY}=`));
}

describe("web refresh token", () => {
  it("is declared as a cookie the script cannot read", () => {
    expect(webPlatform.refreshCookie).toBe(true);
    expect(usesRefreshCookie()).toBe(true);
  });

  it("is never written by the page: only the signed-in marker is", () => {
    setRefreshToken(TOKEN);
    const [write] = refreshWrites();
    expect(write.startsWith(`${REFRESH_TOKEN_KEY}=1;`)).toBe(true);
    expect(writes.join("\n")).not.toContain(TOKEN);
    expect(write).toContain(`max-age=${MARKER_MAX_AGE}`);
    expect(write.toLowerCase()).not.toContain("httponly"); // the page sets the marker; the API sets the real one
  });

  it("a login answer without `refresh` still marks the browser signed in", () => {
    setRefreshToken(undefined);
    expect(refreshWrites()[0]).toMatch(new RegExp(`^${REFRESH_TOKEN_KEY}=1;`));
  });

  it("a silent refresh sends no token in the body and asks for the cookie", async () => {
    await rotateRefreshToken("1");
    const [, body, config] = (axios.post as jest.Mock).mock.calls[0];
    expect(body).toEqual({});
    expect(config).toEqual({ withCredentials: true, headers: { "X-Auth-Cookie": "1" } });
    expect(writes.join("\n")).not.toContain("NEW-ACCESS");
    expect(refreshWrites()[0]).toMatch(new RegExp(`^${REFRESH_TOKEN_KEY}=1;`));
  });
});
