/**
 * 致谢页的开源软件清单(packages/core/src/config/creditsOss.json)是生成的:
 * `backend/.venv/bin/python scripts/gen-credits-oss.py`。依赖增删之后没重跑,这里红 ——
 * 比的是各清单的**直接依赖名集合**,与生成脚本取名的口径相同(工作区自己的包不算)。
 *
 * 另两节同样对着源头核:模型与服务的默认值出自 backend/config/settings.py,
 * 且整份致谢数据里不出现任何地址(settings 里的默认向量服务地址是局域网 IP)。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { OSS_CREDITS, OSS_GROUPS, SERVICE_CREDITS } from "@soulledger/core/config/credits";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const deps = (rel: string) => Object.keys(JSON.parse(read(rel)).dependencies ?? {});
const internal = (name: string) => name.startsWith("@soulledger/");

const requirementNames = () =>
  read("backend/requirements.txt")
    .split("\n")
    .map((line) => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(line.split("#")[0])?.[1])
    .filter((n): n is string => Boolean(n));

const EXPECTED: Record<(typeof OSS_GROUPS)[number], string[]> = {
  server: requirementNames(),
  web: deps("frontend/package.json"),
  app: deps("mobile/package.json"),
  shared: [...deps("packages/core/package.json"), ...deps("package.json")],
};

describe("credits: open-source list matches the dependency manifests", () => {
  it.each(OSS_GROUPS)("%s — rerun scripts/gen-credits-oss.py if this is red", (group) => {
    const expected = [...new Set(EXPECTED[group].filter((n) => !internal(n)))].sort();
    expect(OSS_CREDITS[group].map((c) => c.name).sort()).toEqual(expected);
  });

  it("every row has a registry link and a licence string or null (never an empty string)", () => {
    for (const row of OSS_GROUPS.flatMap((g) => OSS_CREDITS[g])) {
      expect(row.url).toMatch(/^https:\/\/(www\.npmjs\.com\/package|pypi\.org\/project)\//);
      expect(row.licence === null || row.licence.trim().length > 0).toBe(true);
    }
  });
});

describe("credits: models and services", () => {
  const settings = read("backend/config/settings.py");
  const setting = (name: string) => new RegExp(`${name}\\s*=\\s*os\\.getenv\\("${name}",\\s*"([^"]*)"\\)`).exec(settings)?.[1];

  it("the rows marked default are the defaults in settings.py", () => {
    const defaults = SERVICE_CREDITS.filter((s) => s.isDefault).map((s) => s.name);
    expect(defaults).toEqual(["Anthropic Claude", "Ollama", "Matrix · Synapse"]);
    expect(setting("ASSISTANT_PROVIDER")).toBe("apps.soul_assist.providers.AnthropicProvider");
    expect(SERVICE_CREDITS[0].detail.split(" · ")[0]).toBe(setting("ASSISTANT_MODEL"));
    expect(SERVICE_CREDITS.find((s) => s.name === "Ollama")?.detail.split(" · ")[0]).toBe(setting("ASSISTANT_EMBEDDING_MODEL"));
    expect(setting("MATRIX_CLIENT")).toBe("apps.chat.matrix.SynapseClient");
  });

  it("names no host, address or key", () => {
    const text = JSON.stringify(SERVICE_CREDITS);
    expect(text).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b|localhost|:\d{4,5}\b|http:\/\//);
    expect(text).not.toContain(new URL(setting("ASSISTANT_EMBEDDING_URL") ?? "http://x").hostname);
  });
});
