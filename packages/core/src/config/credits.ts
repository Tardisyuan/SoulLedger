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

/**
 * 界面三条字体栈(补足 A4)加中文回退,再加印文字体。v2 匾的题字字体(Ma Shan Zheng、
 * Josefin Slab、Cinzel)随匾一起去掉了(v3,2026-10-02);v2 朱印的另三款印文字体(LXGW Seal、
 * UnifrakturMaguntia、GFS Didot)随 App 的 v2 印去掉了(2026-10-03,Web 早在 10-02 撤掉)。
 * 都不再随任何一端发布,也就不再列。v3 描边印只剩埃及的圣书字。
 */
export const FONT_CREDITS: Credit[] = [
  "Archivo",
  "Source Serif 4",
  "IBM Plex Mono",
  "Noto Sans SC",
  "Noto Serif SC",
  "Noto Sans Egyptian Hieroglyphs",
].map((name) => ({ name, licence: "OFL-1.1" as const }));

export const ORNAMENT_CREDITS: Credit[] = [
  { name: "Owen Jones", detail: "The Grammar of Ornament, 1856 · Pl. LXII / LXVIII / VI / XXII", licence: "PD" },
];

// 印的残边(四张馆藏扫描:都灵 S 2312 与大都会三件,均 CC0 1.0)一节撤掉(2026-10-03):那组扫描
// 只做 v2 填色印的残边遮罩,Web 随 v3 描边印早已不用,App 的 v2 印与 assets/v2/ 也已删光,
// 不再随任何一端发布。`CC0-1.0` 留在许可类型里备用。

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
 * fonts / icons 四个目录:svg 与 icons 是 Design 画的,textures 里的印边扫描已不发布(见上),
 * 字体见 FONT_CREDITS。README 没写纸 / 莎草纸 / 大理石纹理的出处,所以这里不列它们。
 */
export const DESIGN_CREDITS: { name: string; detail: string }[] = [
  // 纹样带质感(paper / papyrus / marble 及深色 *-w)在规范 v2 定稿的授权表里标「本项目自有」:Design 自制,非馆藏。
  { name: "Claude Design", detail: "Anthropic · SoulLedger v2 · 朱印 · svg / icons / textures (paper · papyrus · marble)" },
];
