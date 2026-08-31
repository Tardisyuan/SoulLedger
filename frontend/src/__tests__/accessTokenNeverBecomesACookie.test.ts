/**
 * access token 不得被写进 cookie —— 一次都不行。
 *
 * 登录路径只写 sessionStorage + refresh cookie。**但 401 刷新拦截器把 access 也
 * 写进了 cookie,`max-age=86400`(24 小时),而 access 的实际寿命是 30 分钟**;
 * 而且两个读取端(`lib/api/client.ts`、`lib/ws/client.ts`)都是 **cookie 优先**。
 *
 * 于是设计上那条「access 只活在 sessionStorage、关标签页即失效」,**在第一次静默
 * 刷新之后就不再成立**:此后 token 跨标签页、跨浏览器重启存活 24 小时,并且完整
 * 暴露给任何 XSS。
 *
 * 这个文件盯的是那次「升级」。三条:refresh 之后 cookie 里没有 access;
 * 老浏览器里残留的那个 cookie 会被清掉(否则读取端还是会优先拿它);
 * 读取端只认 sessionStorage。
 */
import { getAccessToken, rotateRefreshToken } from "@/lib/api/client";

jest.mock("axios", () => {
  const post = jest.fn(async () => ({
    data: { access: "NEW-ACCESS", refresh: "NEW-REFRESH" },
  }));
  return {
    __esModule: true,
    default: {
      post,
      create: () => ({
        interceptors: {
          request: { use: jest.fn() },
          response: { use: jest.fn() },
        },
      }),
    },
  };
});

function cookieJar(): Record<string, string> {
  return Object.fromEntries(
    document.cookie
      .split("; ")
      .filter(Boolean)
      .map((c) => {
        const i = c.indexOf("=");
        return [c.slice(0, i), c.slice(i + 1)];
      })
  );
}

beforeEach(() => {
  for (const name of Object.keys(cookieJar())) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
  sessionStorage.clear();
});

describe("刷新之后 access 的落点", () => {
  it("不写进 cookie", async () => {
    document.cookie = "soulledger_refresh=OLD; path=/";
    await rotateRefreshToken("OLD");
    expect(cookieJar()["soulledger_access"]).toBeUndefined();
  });

  it("写进 sessionStorage —— **断存在**", async () => {
    // 只断「cookie 里没有」的测试,在 refresh 什么都不存时也会绿,
    // 而那时每个请求都会 401。
    document.cookie = "soulledger_refresh=OLD; path=/";
    await rotateRefreshToken("OLD");
    expect(sessionStorage.getItem("soulledger_access")).toBe("NEW-ACCESS");
  });

  it("清掉老浏览器里残留的那个 24 小时 cookie", async () => {
    // 不清的话,读取端(修好之前是 cookie 优先)还是会拿到旧的那个。
    document.cookie = "soulledger_access=STALE-24H; path=/";
    document.cookie = "soulledger_refresh=OLD; path=/";
    await rotateRefreshToken("OLD");
    expect(cookieJar()["soulledger_access"]).toBeUndefined();
  });

  it("refresh 仍然落在 cookie 里", async () => {
    document.cookie = "soulledger_refresh=OLD; path=/";
    await rotateRefreshToken("OLD");
    expect(cookieJar()["soulledger_refresh"]).toBe("NEW-REFRESH");
  });
});

describe("读取端只认 sessionStorage", () => {
  it("sessionStorage 空时,cookie 里的 access 不被采纳", () => {
    document.cookie = "soulledger_access=FROM-COOKIE; path=/";
    expect(getAccessToken()).toBeNull();
  });

  it("sessionStorage 有值时用它,而不是 cookie", () => {
    document.cookie = "soulledger_access=FROM-COOKIE; path=/";
    sessionStorage.setItem("soulledger_access", "FROM-SESSION");
    expect(getAccessToken()).toBe("FROM-SESSION");
  });
});

describe("源码里不再有把 access 写成 cookie 的那一行", () => {
  it("client.ts / ws 客户端都不写它", () => {
    // 断源码,而不只断行为:一条只在别的分支上写 cookie 的实现,上面几条会绿。
    const { readFileSync } = jest.requireActual("node:fs") as typeof import("node:fs");
    const path = jest.requireActual("node:path") as typeof import("node:path");
    const root = path.join(__dirname, "..", "..");
    for (const file of ["lib/api/client.ts", "lib/ws/client.ts", "lib/ws/social-client.ts"]) {
      const source = readFileSync(path.join(root, file), "utf8");
      const writes = source
        .split("\n")
        .filter((line) => /document\.cookie\s*=/.test(line))
        .filter((line) => line.includes("soulledger_access"))
        // 清除那一行是允许的,它写的是 max-age=0。
        .filter((line) => !line.includes("max-age=0"));
      expect({ file, writes }).toEqual({ file, writes: [] });
    }
  });
});
