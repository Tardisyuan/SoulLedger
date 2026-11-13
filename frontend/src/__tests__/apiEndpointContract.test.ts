/**
 * Every method on every `xxxApi` object in packages/core asks for a path the backend actually serves.
 *
 * Each method is called once with placeholder arguments against a recording transport (no network);
 * the method + path it produced must match an operation in the backend's OpenAPI
 * (`packages/core/openapi/schema.yml`, regenerated from Django with `manage.py spectacular`).
 * A typo in a URL, a renamed route, or a GET that should be a POST turns this red, which none of the
 * mocked hook tests can do — they stub the API module itself.
 *
 * Side effect, and why this file exists now (2026-10-16): most of core's API surface is used only by the
 * two Expo apps, whose jest runs don't count toward the web coverage floor on `packages/core/src`.
 */
import fs from "fs";
import path from "path";

import type { AxiosAdapter, AxiosInstance, InternalAxiosRequestConfig } from "axios";

import { api } from "@soulledger/core/api/client";
import { soulHttp } from "@soulledger/core/api/soul";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const API_DIR = path.join(ROOT, "packages", "core", "src", "api");
// `manage.py spectacular` writes each path as a 2-space key and its operations as 4-space keys;
// read those lines rather than pull in a YAML parser that isn't a declared dependency.
const SCHEMA_PATHS: Record<string, string[]> = {};
{
  let current: string | null = null;
  for (const line of fs.readFileSync(path.join(ROOT, "packages", "core", "openapi", "schema.yml"), "utf8").split("\n")) {
    if (line === "components:") break;
    const p = /^ {2}(\/\S*):$/.exec(line);
    if (p) SCHEMA_PATHS[(current = p[1])] = [];
    else if (current && /^ {4}(get|post|put|patch|delete):$/.test(line)) SCHEMA_PATHS[current].push(line.trim().slice(0, -1));
  }
}

// Not the Django API: Synapse's client-server API, reached by its own axios instance.
const SKIP_MODULES = new Set(["client.ts", "index.ts", "matrix.ts"]);

const OPERATIONS = Object.entries(SCHEMA_PATHS).flatMap(([p, methods]) =>
  methods.map((m) => ({ method: m, re: new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}$`), path: p })),
);

// Agreed with the backend but not served yet. Each entry names the batch that will serve it; once the schema
// has the operation, "pending operations are still unserved" goes red and the entry must be deleted here.
const PENDING: Record<string, string> = {};
const PENDING_OPS = Object.keys(PENDING).map((k) => {
  const [method, p] = k.split(" ");
  return { key: k, method, path: p, re: new RegExp(`^${p.replace(/\{[^}]+\}/g, "[^/]+")}$`) };
});

type Call = { method: string; url: string };
type Method = (..._args: unknown[]) => unknown;
let calls: Call[] = [];
const record: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
  const base = (config.baseURL ?? "").replace(/^https?:\/\/[^/]+/, "");
  const url = `${base}${(config.url ?? "").startsWith("/") ? "" : "/"}${config.url ?? ""}`.split("?")[0].replace(/\/{2,}/g, "/");
  calls.push({ method: (config.method ?? "get").toLowerCase(), url: url.startsWith("/api/v1") ? url : `/api/v1${url}` });
  return { data: {}, status: 200, statusText: "OK", headers: {}, config };
};
for (const http of [api, soulHttp] as AxiosInstance[]) http.defaults.adapter = record;

const PLACEHOLDER = "x1";
// Methods whose path segment is a literal from a closed set, not an id: the placeholder can't stand in for it.
const ARGS: Record<string, unknown[]> = {
  "socialModerationApi.content": ["posts", {}],
  "socialModerationApi.item": ["comments", PLACEHOLDER],
  "socialModerationApi.act": ["posts", PLACEHOLDER, "hide"],
};

/** Every exported object whose members are all functions, from every API module. */
function apiObjects(): { name: string; methods: [string, Method][] }[] {
  return fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !SKIP_MODULES.has(f))
    .flatMap((f) => {
      const mod = require(`@soulledger/core/api/${f.replace(/\.ts$/, "")}`) as Record<string, unknown>;
      return Object.entries(mod)
        .filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).length > 0 && Object.values(v).every((x) => typeof x === "function"))
        .filter(([k]) => !["soulHttp", "api"].includes(k))
        .map(([k, v]) => ({ name: `${f}:${k}`, methods: Object.entries(v as Record<string, Method>) }));
    });
}

const OBJECTS = apiObjects();

async function requestsOf(fn: Method, args?: unknown[]): Promise<Call[]> {
  calls = [];
  try {
    await fn(...(args ?? Array.from({ length: Math.max(fn.length, 1) }, () => PLACEHOLDER)));
  } catch {
    // The empty `{}` response breaks some `.then(r => r.data.items…)`; the request was already recorded.
  }
  return calls;
}

describe("core API methods ask for paths the backend serves", () => {
  it("every argument override names a method that exists", () => {
    const names = new Set(OBJECTS.flatMap((o) => o.methods.map(([m]) => `${o.name.split(":")[1]}.${m}`)));
    expect(Object.keys(ARGS).filter((k) => !names.has(k))).toEqual([]);
  });

  it("read the schema's operations (guard against a parser that matches nothing)", () => {
    expect(OPERATIONS.length).toBeGreaterThan(300);
    expect(SCHEMA_PATHS["/api/v1/me/mfa/"]).toEqual(expect.arrayContaining(["get"]));
  });

  it("found the API objects (guard against an empty sweep)", () => {
    expect(OBJECTS.length).toBeGreaterThanOrEqual(30);
    expect(OBJECTS.map((o) => o.name)).toEqual(expect.arrayContaining(["soul.ts:soulApi", "judgment.ts:judgmentApi"]));
  });

  it.each(OBJECTS.map((o) => [o.name, o] as const))("%s", async (name, { methods }) => {
    const object = name.split(":")[1];
    const unknown: string[] = [];
    let requested = 0;
    for (const [method, fn] of methods) {
      for (const c of await requestsOf(fn, ARGS[`${object}.${method}`])) {
        requested += 1;
        if (OPERATIONS.some((op) => op.method === c.method && op.re.test(c.url))) continue;
        if (!PENDING_OPS.some((op) => op.method === c.method && op.re.test(c.url))) unknown.push(`${method}: ${c.method.toUpperCase()} ${c.url}`);
      }
    }
    expect(requested).toBeGreaterThan(0);
    expect(unknown).toEqual([]);
  });

  it("pending operations are still unserved, each says why, and each is still asked for", async () => {
    const served = (op: (typeof PENDING_OPS)[number]) => {
      const url = op.path.replace(/\{[^}]+\}/g, PLACEHOLDER);
      return OPERATIONS.some((o) => o.method === op.method && o.re.test(url));
    };
    expect(PENDING_OPS.filter(served).map((op) => op.key)).toEqual([]);
    expect(Object.entries(PENDING).filter(([, why]) => why.trim().length < 4).map(([k]) => k)).toEqual([]);
    const asked: Call[] = [];
    for (const { name, methods } of OBJECTS) {
      for (const [method, fn] of methods) asked.push(...(await requestsOf(fn, ARGS[`${name.split(":")[1]}.${method}`])));
    }
    expect(PENDING_OPS.filter((op) => !asked.some((c) => c.method === op.method && op.re.test(c.url))).map((op) => op.key)).toEqual([]);
  });
});
