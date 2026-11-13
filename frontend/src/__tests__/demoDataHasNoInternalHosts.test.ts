/**
 * The demo's recordings are published with the site, so no address of the machine that recorded them may be in one
 * (作品集建议 B4, 2026-11-13). `admin.*.json` once carried the embedding service's LAN address, recorded from
 * `/assist-admin/embedding/`. Kept out twice: the recording backend runs with placeholders (scripts/demo_settings.py)
 * and the recorder rewrites any private host it still meets (`INTERNAL_HOST` in scripts/demo-record.mjs).
 * Loopback in an `ip_address` column (127.0.0.1, the recorder's own sign-in) names no machine and is left alone.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = join(__dirname, "..", "..", "demo", "data");

const INTERNAL = [
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
  /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/,
  /\b192\.168\.\d{1,3}\.\d{1,3}\b/,
  /\b[\w-]+(?:\.[\w-]+)*\.(?:lan|local|internal|home\.arpa)\b/i,
  /localhost:11434/,
];

function internalHostsIn(text: string): string[] {
  return INTERNAL.flatMap((re) => text.match(new RegExp(re.source, `${re.flags}g`)) ?? []);
}

describe("the demo recordings name no internal host", () => {
  const files = readdirSync(DATA).filter((f) => f.endsWith(".json"));

  it("has recordings to scan", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files)("%s", (file) => {
    expect(internalHostsIn(readFileSync(join(DATA, file), "utf8"))).toEqual([]);
  });

  it("catches each kind it looks for", () => {
    // The scan's own check: a pattern that matches nothing would keep every file green.
    for (const leak of ["http://192.168.0.2:11434", "10.0.0.5", "172.20.1.9", "http://gates-host.lan:11434", "http://localhost:11434/v1"]) {
      expect(internalHostsIn(JSON.stringify({ embedding_url: leak }))).not.toEqual([]);
    }
    expect(internalHostsIn(JSON.stringify({ ip_address: "127.0.0.1", base_url: "https://api.deepseek.com", host: "internal.example" }))).toEqual([]);
  });
});
