/**
 * The glyph each audit verb is told apart by (the audit page's 动作 column, and the welcome page's
 * 最近活动). One table, so the two pages cannot drift apart. Unknown verbs get •.
 */
const GLYPH: Record<string, string> = {
  CREATE: "＋",
  LOGIN: "→",
  LOGOUT: "←",
  UPDATE: "✎",
  DELETE: "⌫",
};

export const auditActionGlyph = (action: string): string => GLYPH[action] ?? "•";
