/**
 * 「关于 / 致谢」页的数据(规范 v2 补足 C16、A4、A7)。Web 与 App 各有一页,读同一份。
 *
 * 这里全是专名与授权标识 —— 字体名、书名、馆名、藏品号、许可证缩写 —— 不进语言包:
 * 它们在三种语言里写法相同,而 egy 包是封闭词表,专名进去只会逼着词表为它们开口子。
 * 要翻译的只有分节标题,在各语言包的 `about.*`。
 */
import LITERATURE from "./creditsLiterature.json";
import OSS from "./creditsOss.json";

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
  { name: "Owen Jones", detail: "The Grammar of Ornament, 1856 · Pl. LXII / LXVIII / VI / XXII", licence: "PD" },
];

/**
 * 印的残边扫描遮罩(deliver/textures/scan-*)。
 *
 * 都灵 S 2312:规范 v2 草案写 CC0,补足 A7 改写为「按 CC BY 2.0 署名,待工程核对」。
 * 2026-09-30 核对 Commons 文件页:模板是 `{{Cc-zero}}`,API 的 extmetadata 为
 * LicenseShortName「CC0」、AttributionRequired「false」、Credit「Museo Egizio」——
 * 所以是 CC0 1.0,不是 CC BY 2.0。按 A7「以文件页为准」写 CC0;署名不是义务,照样写上馆名。
 * 另外三张的出处由 Design 在素材包 README 与补足 A7 补齐(2026-09-30),都是 CC0 1.0,
 * 都在 Commons 上。四张法律上都不需要署名,致谢页仍逐条列出。
 */
export const IMAGE_CREDITS: Credit[] = [
  {
    name: "Museo Egizio, Torino",
    detail: "S 2312",
    licence: "CC0-1.0",
    url: "https://commons.wikimedia.org/wiki/File:Stamped_clay_sealing_(bulla)_showing_St._Menas_-_Museo_Egizio,_Turin_S_2312_p01.jpg",
  },
  {
    name: "The Metropolitan Museum of Art",
    detail: "韓幹《照夜白圖》卷 · 1977.78 · DP153679",
    licence: "CC0-1.0",
    url: "https://commons.wikimedia.org/wiki/File:唐_韓幹_照夜白圖_卷-Night-Shining_White_MET_DP153679.jpg",
  },
  {
    name: "The Metropolitan Museum of Art",
    detail: "Seal Impression, Municipal Seal of Middelburg · 227192",
    licence: "CC0-1.0",
    url: "https://commons.wikimedia.org/wiki/File:Seal_Impression,_Municipal_Seal_of_Middelburg_MET_227192.jpg",
  },
  {
    name: "The Metropolitan Museum of Art",
    detail: "Cylinder seal and modern impression: ritual scene before a temple facade · DP270679",
    licence: "CC0-1.0",
    url: "https://commons.wikimedia.org/wiki/File:Cylinder_seal_and_modern_impression-_ritual_scene_before_a_temple_facade_MET_DP270679.jpg",
  },
];

// ── 2026-10-01 扩充:开源软件、文献出处、模型与服务、设计与协作 ──────────────

/**
 * 开源软件:各平台的**直接**依赖,由 `scripts/gen-credits-oss.py` 从已安装包的元数据生成,
 * 不手改。`licence` 是包自己声明的字符串(多数是 SPDX,少数如 "BSD" 是原样的声明);
 * 读不到时是 null,页面写「未声明」。依赖增删而没重生成,`creditsOssDrift.test.ts` 红。
 */
export interface OssCredit {
  name: string;
  licence: string | null;
  url: string;
}
export const OSS_GROUPS = ["server", "web", "app", "shared"] as const;
export type OssGroup = (typeof OSS_GROUPS)[number];
export const OSS_CREDITS: Record<OssGroup, OssCredit[]> = OSS;

/**
 * 文献出处:律条语料的出处串(后端 `apps/actors/mythology` 各 `*_SOURCE`,埃及取判官行的
 * `ASSESSOR_PAPYRUS` / `ASSESSOR_SOURCE_EDITION`)拆成的书名与细节。手拆,但每个字段都逐字
 * 出自那些串 —— `backend/tests/test_credits_literature_quotes_the_corpus.py` 守着,
 * 并要求种子命令写入的每个语料至少有一条。
 * `kind: "reference"`:语料逐条注记里为对照提到的书(用户 2026-10-01 定:要列,标「参照」,
 * 与底本分开)。字段逐字出自注记原文;注记里出现的每个《书名》都得记上;同一文明下底本在前。
 */
export interface LiteratureCredit {
  civilization: "CHINESE" | "EUROPEAN" | "EGYPTIAN" | "GREEK";
  corpus: string;
  kind?: "reference";
  title: string;
  details: string[];
  url?: string;
}
export const LITERATURE_CREDITS = LITERATURE as LiteratureCredit[];
export const LITERATURE_CIVILIZATIONS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"] as const;

/**
 * 模型与服务:助手(`apps/soul_assist`)与书信(`apps/chat`)代码里支持的提供方。全部按部署
 * 配置 —— 这里只写代码的默认值与支持的协议,不写地址与密钥。`isDefault` 对应
 * `backend/config/settings.py` 的默认值,`creditsServices.test.ts` 对着那份文件核。
 */
export interface ServiceCredit {
  name: string;
  detail: string;
  url: string;
  isDefault?: boolean;
}
export const SERVICE_CREDITS: ServiceCredit[] = [
  { name: "Anthropic Claude", detail: "claude-opus-5 · Messages API", url: "https://www.anthropic.com/", isDefault: true },
  {
    name: "OpenAI Chat Completions",
    detail: "OpenAI · Azure OpenAI · Ollama · DeepSeek",
    url: "https://platform.openai.com/docs/api-reference/chat",
  },
  {
    name: "Ollama",
    detail: "qwen3-embedding:4b-q4_K_M · /api/embed",
    url: "https://ollama.com/library/qwen3-embedding",
    isDefault: true,
  },
  { name: "pgvector", detail: "pgvector/pgvector:pg16", url: "https://github.com/pgvector/pgvector" },
  { name: "Matrix · Synapse", detail: "matrixdotorg/synapse", url: "https://github.com/element-hq/synapse", isDefault: true },
];

/**
 * 设计与协作。素材包 README(`~/Downloads/SoulLedger-deliver`,不入库)分 svg / textures /
 * fonts / icons 四个目录:svg 与 icons 是 Design 画的,textures 里的扫描见 IMAGE_CREDITS,
 * 字体见 FONT_CREDITS。README 没写纸 / 莎草纸 / 大理石纹理的出处,所以这里不列它们。
 */
export const DESIGN_CREDITS: { name: string; detail: string }[] = [
  { name: "Claude Design", detail: "Anthropic · SoulLedger v2 · 朱印 · svg / icons" },
];
