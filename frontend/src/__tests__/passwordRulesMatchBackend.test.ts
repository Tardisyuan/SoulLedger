/**
 * @jest-environment node
 *
 * The checklist under a new-password box says 「至少 8 位」 and ticks it at 8 (packages/core passwordRules).
 * The server's rule is Django's MinimumLengthValidator with its default. If someone gives that validator
 * an OPTIONS.min_length, or drops a validator the list describes, the list would tick a password the
 * server then refuses. Reads backend/config/settings.py.
 *
 * Python comments are stripped before anything is matched, and a validator counts only as a
 * `{"NAME": "…"}` entry (审计 2026-11-11 G-05): a commented-out `# {"NAME": "…NumericPasswordValidator"},`
 * is a dropped validator, not a present one. 什么改动会让它红:注释掉或删掉块里任一被描述的校验器;
 * 给 MinimumLengthValidator 加 `min_length`;把 passwords.py 的 `ADMIN_MIN_PASSWORD_LENGTH = …` 改成别的数或注释掉。
 */
import { readFileSync } from "fs";
import { join } from "path";

import { ADMIN_PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH } from "@soulledger/core/domain/passwordRules";

/** Drop `#` comments (at line start or after whitespace); the settings block has no `#` inside strings. */
function pythonCode(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

function validatorNames(block: string): string[] {
  return [...pythonCode(block).matchAll(/\{\s*"NAME"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const settings = readFileSync(join(__dirname, "..", "..", "..", "backend", "config", "settings.py"), "utf8");
const block = /^AUTH_PASSWORD_VALIDATORS = \[([\s\S]*?)\n\]/m.exec(settings)?.[1] ?? "";
const names = validatorNames(block);
const has = (name: string) => names.some((n) => n === name || n.endsWith(`.${name}`));

describe("the password checklist describes the server's validators", () => {
  it("finds the validator block", () => {
    expect(has("MinimumLengthValidator")).toBe(true);
  });

  it("the minimum length is Django's default (8), the number the list prints", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(pythonCode(block)).not.toMatch(/min_length/);
  });

  it("has the validators behind 「不只是数字」 and the line about common passwords and names", () => {
    for (const name of ["NumericPasswordValidator", "CommonPasswordValidator", "UserAttributeSimilarityValidator"]) {
      expect(has(name)).toBe(true);
    }
  });

  it("a commented-out validator is not a validator", () => {
    const sample = [
      '    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},',
      '    # {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},',
      '    {"NAME": "x.CommonPasswordValidator"},  # NumericPasswordValidator lives here too',
    ].join("\n");
    expect(validatorNames(sample)).toEqual([
      "django.contrib.auth.password_validation.MinimumLengthValidator",
      "x.CommonPasswordValidator",
    ]);
  });
});

describe("the administrator's longer minimum", () => {
  const passwords = readFileSync(join(__dirname, "..", "..", "..", "backend", "apps", "authentication", "passwords.py"), "utf8");

  it("is the number the backend validator uses, and that validator is wired in", () => {
    expect(passwords).toMatch(new RegExp(`^ADMIN_MIN_PASSWORD_LENGTH = ${ADMIN_PASSWORD_MIN_LENGTH}\\b`, "m"));
    expect(names).toContain("apps.authentication.passwords.RoleMinimumLengthValidator");
  });
});
