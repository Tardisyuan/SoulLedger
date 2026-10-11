/**
 * The checklist under a new-password box says 「至少 8 位」 and ticks it at 8 (packages/core passwordRules).
 * The server's rule is Django's MinimumLengthValidator with its default. If someone gives that validator
 * an OPTIONS.min_length, or drops a validator the list describes, the list would tick a password the
 * server then refuses. Reads backend/config/settings.py.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { PASSWORD_MIN_LENGTH } from "@soulledger/core/domain/passwordRules";

const settings = readFileSync(join(__dirname, "..", "..", "..", "backend", "config", "settings.py"), "utf8");
const block = /AUTH_PASSWORD_VALIDATORS = \[([\s\S]*?)\n\]/.exec(settings)?.[1] ?? "";

describe("the password checklist describes the server's validators", () => {
  it("finds the validator block", () => {
    expect(block).toContain("MinimumLengthValidator");
  });

  it("the minimum length is Django's default (8), the number the list prints", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(block).not.toMatch(/min_length/);
  });

  it("has the validators behind 「不只是数字」 and the line about common passwords and names", () => {
    for (const name of ["NumericPasswordValidator", "CommonPasswordValidator", "UserAttributeSimilarityValidator"]) {
      expect(block).toContain(name);
    }
  });
});
