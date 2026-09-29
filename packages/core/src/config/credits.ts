/**
 * 「关于 / 致谢」页的数据(规范 v2 补足 C16、A4、A7)。Web 与 App 各有一页,读同一份。
 *
 * 这里全是专名与授权标识 —— 字体名、书名、馆名、藏品号、许可证缩写 —— 不进语言包:
 * 它们在三种语言里写法相同,而 egy 包是封闭词表,专名进去只会逼着词表为它们开口子。
 * 要翻译的只有分节标题,在各语言包的 `about.*`。
 */
export type CreditLicence = "OFL-1.1" | "CC0-1.0" | "PD";

export interface Credit {
  name: string;
  /** 书名、藏品号这类补充,同样是专名,不翻译。 */
  detail?: string;
  licence: CreditLicence;
  url?: string;
}

export const LICENCE_LABELS: Record<Exclude<CreditLicence, "PD">, { label: string; url: string }> = {
  "OFL-1.1": { label: "SIL Open Font License 1.1", url: "https://openfontlicense.org/open-font-license-official-text/" },
  "CC0-1.0": { label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
};

/** 界面三条字体栈(补足 A4)加中文回退,再加只由匾与印按需加载的题字 / 印文字体。 */
export const FONT_CREDITS: Credit[] = [
  "Archivo",
  "Source Serif 4",
  "IBM Plex Mono",
  "Noto Sans SC",
  "Noto Serif SC",
  "LXGW Seal",
  "Ma Shan Zheng",
  "UnifrakturMaguntia",
  "Josefin Slab",
  "Cinzel",
  "GFS Didot",
  "Noto Sans Egyptian Hieroglyphs",
].map((name) => ({ name, licence: "OFL-1.1" as const }));

export const ORNAMENT_CREDITS: Credit[] = [
  { name: "Owen Jones", detail: "The Grammar of Ornament, 1856", licence: "PD" },
];

/**
 * 印的残边扫描遮罩(deliver/textures/scan-*)。
 *
 * 都灵 S 2312:规范 v2 草案写 CC0,补足 A7 改写为「按 CC BY 2.0 署名,待工程核对」。
 * 2026-09-30 核对 Commons 文件页:模板是 `{{Cc-zero}}`,API 的 extmetadata 为
 * LicenseShortName「CC0」、AttributionRequired「false」、Credit「Museo Egizio」——
 * 所以是 CC0 1.0,不是 CC BY 2.0。按 A7「以文件页为准」写 CC0;署名不是义务,照样写上馆名。
 * 另外三张:素材包说明写「CC0 馆藏」,具体出处素材包没有给。
 */
export const IMAGE_CREDITS: Credit[] = [
  {
    name: "Museo Egizio, Torino",
    detail: "S 2312",
    licence: "CC0-1.0",
    url: "https://commons.wikimedia.org/wiki/File:Stamped_clay_sealing_(bulla)_showing_St._Menas_-_Museo_Egizio,_Turin_S_2312_p01.jpg",
  },
  { name: "scan-cnseal · scan-wax · scan-cyl", licence: "CC0-1.0" },
];
