/** The four push kinds that land on the sentence plan (1d). A leaf module: `push.ts` needs the
 *  list at runtime and must not reach the sentence screen (a require cycle through session). */
export const SENTENCE_PUSH_KINDS = ["sentence_completed", "sentence_waiting", "sentence_amended", "sentence_pardoned"] as const;
export type SentencePushKind = (typeof SENTENCE_PUSH_KINDS)[number];
/** Where a sentence push landed: its kind, and the stations the server named as new (amended / waiting). */
export type SentenceLanding = { kind: SentencePushKind; nodeIds: string[] };
