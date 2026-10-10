import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { api } from "../client";
import { permApi } from "../perm";

describe("permApi export/import config", () => {
  beforeEach(() => vi.clearAllMocks());

  it("importConfig posts the document as JSON with overwrite false unless asked", async () => {
    await permApi.importConfig({ roles: [{ name: "R", display_name: "R" }] } as never);
    expect(api.post).toHaveBeenCalledWith("/perm/import/", {
      roles: [{ name: "R", display_name: "R" }],
      overwrite: false,
      dry_run: false,
    });
  });

  it("importConfig cannot be talked into overwrite by the document", async () => {
    await permApi.importConfig({ overwrite: true } as never);
    expect((api.post as ReturnType<typeof vi.fn>).mock.calls[0][1].overwrite).toBe(false);
  });

  it("importConfig(doc, dryRun, true) is the only way to send overwrite: true, and the document cannot undo it", async () => {
    await permApi.importConfig({ overwrite: false, dry_run: false } as never, true, true);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.overwrite).toBe(true);
    expect(body.dry_run).toBe(true);
  });

  it("importConfig(doc, true) is a dry run and keeps overwrite false", async () => {
    await permApi.importConfig({ overwrite: true } as never, true);
    const body = (api.post as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(body.dry_run).toBe(true);
    expect(body.overwrite).toBe(false);
  });

  it("exportConfig asks for a blob", async () => {
    await permApi.exportConfig();
    expect(api.get).toHaveBeenCalledWith("/perm/export/", { responseType: "blob" });
  });
});
