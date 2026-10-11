import zhHans from "@soulledger/core/messages/zh-Hans.json";

/**
 * 交付单上联印的是「文明的文字」,不是官员台界面的语言(第二十五批),所以要同时拿到三种语言的词条。
 * `I18nContext` 只常驻 zh-Hans、en / egy 按需加载,这里只取交付单用到的两个切片:
 * `soul_accounts.credentials.slip` 与 `plaque.realm`。打印的那一刻才加载,不让三份语言包在每条路由上常驻。
 */
export type SlipLocale = "zh-Hans" | "en" | "egy";
export interface SlipTexts {
  slip: Record<string, string>;
  realm: Record<string, string>;
}
export type SlipBundles = Record<SlipLocale, SlipTexts>;

type Bundle = { soul_accounts: { credentials: { slip: Record<string, string> } }; plaque: { realm: Record<string, string> } };

export const sliceSlipTexts = (bundle: unknown): SlipTexts => {
  const b = bundle as Bundle;
  return { slip: b.soul_accounts.credentials.slip, realm: b.plaque.realm };
};

/** 动态 import 在 ESM 构建下是 `{ default }`,在 ts-jest 的 CommonJS 下是对象本身(与 I18nContext 的 `unwrapBundle` 同理)。 */
const unwrap = (mod: unknown) => (mod as { default?: unknown })?.default ?? mod;

export async function loadSlipBundles(): Promise<SlipBundles> {
  const [en, egy] = await Promise.all([import("@soulledger/core/messages/en.json"), import("@soulledger/core/messages/egy.json")]);
  return { "zh-Hans": sliceSlipTexts(zhHans), en: sliceSlipTexts(unwrap(en)), egy: sliceSlipTexts(unwrap(egy)) };
}
