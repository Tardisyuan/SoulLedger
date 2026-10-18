/**
 * @jest-environment node
 *
 * `packages/core/src/domain/soulCode.ts` 的字符集与长度要和后端一致:后端生成编号,
 * 前端 / App 校验与输入。两边漂开,就会有一类编号登录页不让输入,或输入框放行而后端从不发。
 * core 自己的 vitest 不读后端文件,所以守卫放在这里(并登记在 jest.always-run.txt)。
 */
import fs from "node:fs";
import path from "node:path";

import { SOUL_CODE_ALPHABET, SOUL_CODE_GROUPS, SOUL_CODE_LENGTH } from "@soulledger/core/domain/soulCode";

const SERVICES = fs.readFileSync(path.resolve(__dirname, "../../../backend/apps/soul_accounts/services.py"), "utf8");
const pyConst = (name: string) => new RegExp(`^${name}\\s*=\\s*(.+?)\\s*$`, "m").exec(SERVICES)?.[1];

describe("soul code constants track the backend", () => {
  it("alphabet", () => {
    expect(pyConst("SOUL_CODE_ALPHABET")).toBe(JSON.stringify(SOUL_CODE_ALPHABET));
  });
  it("length, and 3-4-3 adds up to it", () => {
    expect(pyConst("SOUL_CODE_LENGTH")).toBe(String(SOUL_CODE_LENGTH));
    expect(SOUL_CODE_GROUPS.reduce((a, b) => a + b, 0)).toBe(SOUL_CODE_LENGTH);
  });
});
