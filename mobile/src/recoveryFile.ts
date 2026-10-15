/**
 * 「存为文件」: the ten recovery codes as one plain-text file, handed to the system share sheet so the soul picks
 * where it goes (Files, a mail to itself, another device). The file exists only for the length of that sheet:
 *
 *   it is written into the CACHE directory (not documents, not backed up), named `soulledger-recovery-<soul code>.txt`
 *   (not localised, no date, ASCII only: every system can save it), and holds one explanatory line, the soul code, and the codes --
 *   no name, no hall, nothing else about the soul;
 *   it is deleted the moment the sheet closes, whether the soul saved it, cancelled, or the sheet failed to open --
 *   EXCEPT on Android after a share that went through: there the sheet closes before the receiving app has read the
 *   file (seen on a Huawei TAS-AL00, 2026-10-15: 「中转站」 kept a 0-byte copy), so it stays until the codes page goes
 *   away (the sweep below) or the next one is written;
 *   any file of this name left behind (the app was killed while the sheet was up) is swept before the next one is
 *   written and when the codes page goes away.
 *
 * The codes never reach a log or a crash report from here: nothing is printed, and a failure is reported as a
 * boolean, not as the error (whose text could carry a path or the content).
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

const PREFIX = "soulledger-recovery-";

/**
 * `soulledger-recovery-<soul code>.txt`. The soul code is this life's, as the server wrote it (ten of
 * 23456789ABCDEFGHJKMNPQRSTUVWXYZ, so already safe on every file system); anything outside letters, digits, dot,
 * dash and underscore is replaced by `_` regardless, so a code that ever grew a slash or a colon cannot make a
 * path or an unsavable name.
 */
export function recoveryFileName(soulCode: string): string {
  return `${PREFIX}${soulCode.replace(/[^A-Za-z0-9._-]/g, "_")}.txt`;
}

/** `header` is the first line (what this is); then the soul code; then the codes, one a line. */
export function recoveryFileBody(header: string, soulCodeLine: string, codes: string[]): string {
  return [header, soulCodeLine, "", ...codes, ""].join("\n");
}

/** Deletes every recovery-codes file in the cache. Never throws. */
export function sweepRecoveryFiles(): void {
  try {
    for (const item of Paths.cache.list()) {
      if (item instanceof File && item.name.startsWith(PREFIX)) {
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

/**
 * Writes the file, opens the share sheet, deletes the file when the sheet closes. Resolves `true` when the sheet
 * was shown (whatever the soul then did with it), `false` when sharing is unavailable or anything went wrong.
 */
export async function shareRecoveryFile(opts: { header: string; soulCode: string; soulCodeLine: string; codes: string[]; dialogTitle: string }): Promise<boolean> {
  sweepRecoveryFiles();
  let file: File | null = null;
  let shared = false;
  try {
    if (!(await Sharing.isAvailableAsync())) return false;
    file = new File(Paths.cache, recoveryFileName(opts.soulCode));
    file.create({ overwrite: true, intermediates: true });
    file.write(recoveryFileBody(opts.header, opts.soulCodeLine, opts.codes));
    await Sharing.shareAsync(file.uri, { mimeType: "text/plain", UTI: "public.plain-text", dialogTitle: opts.dialogTitle });
    shared = true;
    return true;
  } catch {
    return false;
  } finally {
    // Cancelled or failed: the temporary copy goes now. Shared: on iOS too (the share is done by the time this
    // resolves); on Android the receiver may still be reading, so the page's sweep takes it when it goes.
    if (file && !(shared && Platform.OS === "android")) {
      try {
        file.delete();
      } catch {
        /* never created, or already gone */
      }
    }
  }
}
