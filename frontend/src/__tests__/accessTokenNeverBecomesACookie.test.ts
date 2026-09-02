/**
 * access token 不得被写进 cookie —— 一次都不行。
 *
 * 登录路径只写 sessionStorage + refresh cookie。**但 401 刷新拦截器把 access 也
 * 写进了 cookie,`max-age=86400`(24 小时),而 access 的实际寿命是 30 分钟**;
 * 而且两个读取端(`packages/core/src/api/client.ts`、`packages/core/src/ws/client.ts`)都是 **cookie 优先**。
 *
 * 于是设计上那条「access 只活在 sessionStorage、关标签页即失效」,**在第一次静默
 * 刷新之后就不再成立**:此后 token 跨标签页、跨浏览器重启存活 24 小时,并且完整
 * 暴露给任何 XSS。
 *
 * 这个文件盯的是那次「升级」。三条:refresh 之后 cookie 里没有 access;
 * 老浏览器里残留的那个 cookie 会被清掉(否则读取端还是会优先拿它);
 * 读取端只认 sessionStorage。
 */
import { getAccessToken, rotateRefreshToken } from "@soulledger/core/api/client";
import { configurePlatform, resetPlatform } from "@soulledger/core/platform";
import { webPlatform } from "@/lib/platform/web";

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
  // The real web adapter, not a stand-in. A fake store here would test the
  // fake: the whole claim under test is about which **browser** facility each
  // token lands in, and only `lib/platform/web.ts` decides that now.
  configurePlatform(webPlatform);
  for (const name of Object.keys(cookieJar())) {
    document.cookie = `${name}=; path=/; max-age=0`;
  }
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  resetPlatform();
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
  /**
   * 这三个文件搬进 packages/core 之后,**主体必须跟着换**,否则这条检查会变成
   * 一条永远不可能触发的检查 —— 这个仓库反复栽的那个形状。
   *
   * 原因很具体:core 的 tsconfig 里没有 "dom",`document` 在那三个文件里根本
   * 编译不过。去 core 里扫 `document.cookie =` 一定扫到 0 条,而 0 条正是通过态。
   * 那不是「守住了」,那是「没在看」。
   *
   * 现在真正能写出这一行的地方只剩一个:`lib/platform/web.ts` —— 全仓库唯一
   * 知道 cookie 是什么的文件。所以第一条断它。
   *
   * 第二条断 core 一侧那个改了形状的等价物:适配器化之后,「把 access 写进
   * cookie」在 core 里的写法是 `persistent.set(ACCESS_TOKEN_KEY, ...)`。
   * 语法变了,同一个错误依然写得出来,所以它同样要有人看着。
   */
  const { readFileSync } = jest.requireActual("node:fs") as typeof import("node:fs");
  const path = jest.requireActual("node:path") as typeof import("node:path");
  const REPO_ROOT = path.join(__dirname, "..", "..", "..");

  function sourceOf(rel: string): string {
    const source = readFileSync(path.join(REPO_ROOT, rel), "utf8");
    // 先证明读到的是那个文件,而不是一个空串 —— 路径写错时,下面每一条都会绿。
    expect(source.length).toBeGreaterThan(500);
    return source;
  }

  /** 剥注释。这个仓库里「散文被当成代码」是个反复出现的事故形状,而这条检查
   *  第一次跑就栽在自己身上:client.ts 的注释里写着「这一行**曾经**把
   *  soulledger_access 写进 document.cookie」,于是一条记录「已经修好了」的
   *  注释,被读成了「问题还在」。判据必须先剥注释,再判。 */
  function code(rel: string): string {
    return sourceOf(rel).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  }

  it("web 适配器不把 access 写成 cookie", () => {
    const file = "frontend/lib/platform/web.ts";
    const writes = code(file)
      .split("\n")
      .filter((line) => /document\.cookie\s*=/.test(line))
      .filter((line) => line.includes("soulledger_access") || line.includes("ACCESS_TOKEN_KEY"))
      // 清除那一行是允许的,它写的是 max-age=0。
      .filter((line) => !line.includes("max-age=0"));
    expect({ file, writes }).toEqual({ file, writes: [] });
  });

  it("core 不把 access 放进 persistent store", () => {
    for (const file of [
      "packages/core/src/api/client.ts",
      "packages/core/src/ws/client.ts",
      "packages/core/src/ws/social-client.ts",
    ]) {
      const writes = code(file)
        .split("\n")
        .filter((line) => /persistent\.set\s*\(/.test(line));
      expect({ file, writes }).toEqual({ file, writes: [] });
    }
  });

  it("core 里根本没有 document —— 由 tsconfig 执行,这里只是把它写下来", () => {
    // packages/core/tsconfig.json 的 lib 不含 "dom"。这条不是第二道闸,
    // 它是那道闸的说明书:闸坏了(有人加回 "dom")这里会跟着红。
    const tsconfig = sourceOf("packages/core/tsconfig.json");
    expect(tsconfig).toMatch(/"lib":\s*\["ES2020"\]/);
    for (const file of ["packages/core/src/api/client.ts", "packages/core/src/ws/client.ts"]) {
      expect(code(file)).not.toMatch(/\bdocument\./);
    }
  });
});
