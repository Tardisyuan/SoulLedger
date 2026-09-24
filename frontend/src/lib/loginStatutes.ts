import type { StatuteRef } from "@soulledger/core/config/civilizationSigil";

/**
 * 今日律条(登录页左半)。A FIXED LIST, and why.
 *
 * The design asks for a statute drawn fresh on each visit. The login page has
 * no session, and `StatuteViewSet` (backend/apps/judgment/views.py) is behind
 * `TenantPermission` + `CodenamePermission` — no statute is readable without
 * auth, and opening one up for a decorative quote is not a trade worth making.
 * So these are copied from the seeded corpus instead, verbatim, and
 * `loginStatutes.test.ts` holds every `text` against the Python source it came
 * from: a quote that stops matching the corpus goes red rather than becoming
 * an invented statute on the first screen anyone sees.
 *
 * Only corpora whose text is a thing actually said: 《太微仙君功過格》 (1171,
 * the document's own wording) and Plato's Gorgias. Egyptian rows are derived
 * from the assessors' English "denies" clauses and carry no Chinese text; the
 * Inferno / 炼狱 rows are the seeder's descriptions, not quotations.
 */
export interface LoginStatute {
  code: string;
  civilization: "CHINESE" | "GREEK";
  ref: StatuteRef;
  text: string;
}

export const LOGIN_STATUTES: readonly LoginStatute[] = [
  {
    code: "CN-GGG-F-YS-01",
    civilization: "CHINESE",
    ref: { division: "用事門", gateOrdinal: 1 },
    text: "興諸善事，利益一人為一功。",
  },
  {
    code: "CN-GGG-F-YS-10",
    civilization: "CHINESE",
    ref: { division: "用事門", gateOrdinal: 10 },
    text: "勸諫人令不為非、不廉、不孝、不貞、不良、不善、不慈、不仁、不義，一人迴心為十功。",
  },
  {
    code: "CN-GGG-G-BR-10",
    civilization: "CHINESE",
    ref: { division: "不仁門", gateOrdinal: 10 },
    text: "若救得而不救者為十過，無門可救，不生慈念者為一過。",
  },
  {
    code: "CN-GGG-G-BR-11",
    civilization: "CHINESE",
    ref: { division: "不仁門", gateOrdinal: 11 },
    text: "見人有憂，不行解釋而故暢快者為五過。",
  },
  {
    code: "GR-GRG-01",
    civilization: "GREEK",
    ref: { stephanus: "523a-b" },
    text: "一生行于正义与虔敬者，死后往至福群岛，在那里全然幸福，恶不能及；行不义与不敬者，往复仇与惩罚之所，名曰塔尔塔罗斯。",
  },
];
