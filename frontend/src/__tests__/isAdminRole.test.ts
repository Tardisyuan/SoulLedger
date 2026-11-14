/**
 * 分殿 1A:SYSTEM_ADMIN 过每一道 ADMIN 的门,角色判断只有 `isAdminRole` 一处(packages/core/src/domain/roles.ts)。
 * 变异:把 `isAdminRole` 改回只认 "ADMIN" → 第一条与密码那一条红。
 */
import { isAdminRole, isSystemAdminRole, SYSTEM_ADMIN_ROLE_NAME } from "@soulledger/core/domain/roles";
import { passwordMinLength, ADMIN_PASSWORD_MIN_LENGTH, PASSWORD_MIN_LENGTH } from "@soulledger/core/domain/passwordRules";
import { ROLE_DOORS } from "@soulledger/core/domain/doors";
import { officerAssistSuggestions } from "@soulledger/core/config/officerAssistSuggestions";
import zhHans from "@soulledger/core/messages/zh-Hans.json";
import en from "@soulledger/core/messages/en.json";
import { roleLabel } from "@/src/lib/domainNames";
import { tZh } from "./support/zhBundle";

describe("isAdminRole / isSystemAdminRole", () => {
  it("ADMIN and SYSTEM_ADMIN are admins; nobody else is", () => {
    expect(isAdminRole("ADMIN")).toBe(true);
    expect(isAdminRole(SYSTEM_ADMIN_ROLE_NAME)).toBe(true);
    for (const r of ["JUDGE", "GUARDIAN", "VIEWER", "MODERATOR", "SOUL", "admin", "", null, undefined]) expect(isAdminRole(r)).toBe(false);
  });

  it("only SYSTEM_ADMIN is the system administrator", () => {
    expect(isSystemAdminRole("SYSTEM_ADMIN")).toBe(true);
    expect(isSystemAdminRole("ADMIN")).toBe(false);
    expect(isSystemAdminRole(undefined)).toBe(false);
  });

  it("SYSTEM_ADMIN gets the admin password length and the admin's doors", () => {
    expect(passwordMinLength("SYSTEM_ADMIN")).toBe(ADMIN_PASSWORD_MIN_LENGTH);
    expect(passwordMinLength("JUDGE")).toBe(PASSWORD_MIN_LENGTH);
    expect(ROLE_DOORS.SYSTEM_ADMIN).toEqual(ROLE_DOORS.ADMIN);
  });

  it("SYSTEM_ADMIN is asked ADMIN's suggested questions, not VIEWER's fallback", () => {
    expect(officerAssistSuggestions("SYSTEM_ADMIN", "scheduler", "zh-Hans")).toEqual(officerAssistSuggestions("ADMIN", "scheduler", "zh-Hans"));
    expect(officerAssistSuggestions("SYSTEM_ADMIN", "scheduler", "zh-Hans")).not.toEqual(officerAssistSuggestions("VIEWER", "scheduler", "zh-Hans"));
  });

  it("SYSTEM_ADMIN has its own label in zh-Hans and en, not the key and not ADMIN's", () => {
    expect(zhHans.users.roles.SYSTEM_ADMIN).toBe("系统管理员");
    expect(en.users.roles.SYSTEM_ADMIN).toBe("System administrator");
    expect(roleLabel(tZh, "SYSTEM_ADMIN")).toBe("系统管理员");
    expect(roleLabel(tZh, "SYSTEM_ADMIN")).not.toBe(roleLabel(tZh, "ADMIN"));
  });
});
