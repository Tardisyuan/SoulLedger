/**
 * 「导出我的资料」(Design 第二十八批 S3), the parts that are not drawing: how big a file reads, and how the finished
 * zip gets from the server to the system share sheet.
 *
 * The zip is the soul's whole record, so it lives on this phone only for the length of the share sheet, exactly like
 * the recovery-codes file (`recoveryFile.ts`): downloaded into the CACHE directory (not documents, not backed up),
 * handed to the sheet, deleted the moment the sheet closes -- saved, cancelled or failed -- and any file of this
 * kind left behind (the app was killed while the sheet was up) is swept before the next download.
 *
 * The download carries the soul's own token: the signed path is only half of what the server asks for.
 */
import { soulApi } from "@soulledger/core/api/soul";
import { mediaUrl } from "@soulledger/core/api/soul-social";
import { getAccessToken } from "@soulledger/core/platform";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

const PREFIX = "soulledger-";

/** `12.4 MB`, `830 KB`: one decimal from a megabyte up, whole kilobytes below (the design's `12.4 MB`). */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The server names it `soulledger-<code>-<yyyymmdd>.zip`; anything outside letters, digits, dot, dash, underscore becomes `_`. */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.startsWith(PREFIX) && cleaned.endsWith(".zip") ? cleaned : `${PREFIX}export.zip`;
}

/** Deletes every export zip in the cache. Never throws. */
export function sweepExportFiles(): void {
  try {
    for (const item of Paths.cache.list()) {
      if (item instanceof File && item.name.startsWith(PREFIX) && item.name.endsWith(".zip")) {
        try {
          item.delete();
        } catch {
          /* gone already */
        }
      }
    }
  } catch {
    /* a cache that cannot be listed has nothing of ours in a place we can reach */
  }
}

export type ShareOutcome = "shared" | "unavailable" | "download_failed" | "share_failed" | "expired";

/**
 * Fetches the export again (a fresh signed path, and a token the client has refreshed if it had to), downloads the zip
 * and opens the share sheet. `expired`: the server no longer has a ready file -- the page should show what it says now.
 */
export async function saveExport(dialogTitle: string): Promise<ShareOutcome> {
  sweepExportFiles();
  let file: File | null = null;
  try {
    if (!(await Sharing.isAvailableAsync())) return "unavailable";
    const { export: current } = await soulApi.dataExport();
    if (!current || current.status !== "READY" || !current.download_url) return "expired";
    file = new File(Paths.cache, safeFileName(current.file_name));
    const token = getAccessToken();
    try {
      await File.downloadFileAsync(mediaUrl(current.download_url), file, {
        idempotent: true,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      return "download_failed";
    }
    try {
      await Sharing.shareAsync(file.uri, { mimeType: "application/zip", UTI: "public.zip-archive", dialogTitle });
    } catch {
      return "share_failed";
    }
    return "shared";
  } catch {
    return "download_failed";
  } finally {
    if (file) {
      try {
        file.delete();
      } catch {
        /* never created, or already gone */
      }
    }
  }
}
