"use client";

import type { Statute } from "@soulledger/core/api";
import { statuteSigil } from "@soulledger/core/config/statuteCitation";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 语料页右栏「相关条目」—— 纯前端推导,不存关系表。三种关系,各自只在一部语料里有意义:
 *
 *   功過格      同门:`payload.gate` 相同(救濟門、口業門……);
 *   INFERNO     同圈:`payload.circle` 相同 —— 圈的总条与它的环 / 囊(`parent_code`
 *               指回 `EU-INF-C<n>`)同属一圈,所以按圈号归并已经涵盖 parent_code;
 *   DEADLY_SIN  同台阶:`payload.terrace_realm_code`(没有时读 `realm_code`)相同。
 *
 * 别的语料没有这类分组,不硬凑 —— 什么都不显示。
 */
type Relation = "gate" | "circle" | "terrace";

function relationKey(s: Statute): [Relation, string] | null {
  const p = s.payload_json ?? {};
  if (s.corpus === "GONGGUOGE" && typeof p.gate === "string") return ["gate", p.gate];
  if (s.corpus === "INFERNO" && typeof p.circle === "number") return ["circle", String(p.circle)];
  if (s.corpus === "DEADLY_SIN") {
    const terrace = p.terrace_realm_code ?? p.realm_code;
    if (typeof terrace === "string") return ["terrace", terrace];
  }
  return null;
}

/** The other articles in the same gate / circle / terrace, in the order given. */
export function relatedStatutes(statute: Statute, all: readonly Statute[]): { relation: Relation; rows: Statute[] } | null {
  const key = relationKey(statute);
  if (!key) return null;
  const rows = all.filter((s) => {
    if (s.id === statute.id || s.corpus !== statute.corpus) return false;
    const k = relationKey(s);
    return !!k && k[0] === key[0] && k[1] === key[1];
  });
  return rows.length ? { relation: key[0], rows } : null;
}

export function CorpusRelated({
  statute,
  all,
  onChoose,
}: {
  statute: Statute;
  all: readonly Statute[];
  onChoose: (id: string) => void;
}) {
  const { t } = useI18n();
  const related = relatedStatutes(statute, all);
  if (!related) return null;
  return (
    <div data-testid="corpus-related" data-relation={related.relation}>
      <p className="text-2xs text-[oklch(var(--color-ink-subtle))] pt-1">{t(`judgment.corpus.related_${related.relation}`)}</p>
      <ul>
        {related.rows.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onChoose(s.id)}
              className="w-full grid grid-cols-[5.5rem_1fr] gap-2 py-1 text-left border-b border-[oklch(var(--color-rule))] hover:bg-[oklch(var(--color-surface-2))]"
            >
              <span className="font-mono text-2xs truncate" title={statuteSigil(s) ?? s.code}>{statuteSigil(s) ?? s.code}</span>
              <span className="text-xs truncate" title={s.display_title}>{s.display_title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
