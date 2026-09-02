"use client";

import { useQuery } from "@tanstack/react-query";
import { judgmentApi, type Statute, type StatuteCorpus } from "../api/index";
import { judgmentKeys } from "../query_keys";

/**
 * A page of the corpus — the 175 transcribed articles four cosmologies judge by.
 *
 * `staleTime` is minutes rather than the 30s the judgment lists use, and that
 * is a claim about the data rather than a tuning preference: `StatuteViewSet`
 * is a `ReadOnlyModelViewSet` with no create/update route, because corrections
 * go through `manage.py seed_mythology --update` next to the document they were
 * transcribed from. Nothing a logged-in operator can do changes an article's
 * text. The one field that *does* move under them is `citation_count`, which is
 * annotated from `JudgmentCitation` — hence the key sitting under
 * `judgmentKeys.all` (see ../query_keys.ts), so filing grounds on a verdict
 * invalidates these pages along with the judgment they were filed on.
 */
export function useStatutes(params?: Record<string, string>) {
  return useQuery({
    queryKey: judgmentKeys.statutes(params),
    queryFn: async () => {
      const res = await judgmentApi.statutes(params);
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
}

/** One rulebook's articles, as far as the current page carries them. */
export interface CorpusGroup {
  /** `${civilization}:${corpus}` — see `groupStatutesByCorpus`. */
  key: string;
  civilization: string;
  corpus: StatuteCorpus;
  statutes: Statute[];
}

/**
 * Split a page of articles into one group per rulebook, in the order the rows
 * arrived.
 *
 * THIS IS THE RULE, NOT A CONVENIENCE. Two civilizations carry two corpora
 * apiece and neither pair may share a table. Europe's are the seven terraces of
 * Purgatorio and the nine circles of Inferno — seven against nine, a different
 * canticle and a different ordering principle, so a combined table is a chart
 * that exists nowhere in Dante. Greece's are the Gorgias, where the judgement
 * stamps a soul and stops, and the Myth of Er, where it sentences the soul to a
 * thousand-year circuit and sends it back to be born; one table implies the two
 * describe one afterlife, and the whole point of seeding both is that they do
 * not. Grouping is therefore keyed on `corpus`, and a caller that renders one
 * `<table>` per group cannot accidentally merge them.
 *
 * The key carries `civilization` as well even though `corpus` is already unique
 * across the six: `Statute.civilization` is a free string on the wire, and a
 * row whose civilization disagrees with its corpus is a seeding fault that
 * should show up as two groups rather than be averaged into one heading.
 */
export function groupStatutesByCorpus(statutes: Statute[]): CorpusGroup[] {
  const groups: CorpusGroup[] = [];
  const index = new Map<string, CorpusGroup>();

  for (const statute of statutes) {
    const key = `${statute.civilization}:${statute.corpus}`;
    let group = index.get(key);
    if (group === undefined) {
      group = { key, civilization: statute.civilization, corpus: statute.corpus, statutes: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.statutes.push(statute);
  }

  return groups;
}
