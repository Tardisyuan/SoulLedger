/**
 * Two-step verification's input and display rules, shared by both apps (cq-apps 2026-10-30 #10). Each app had
 * its own copy of both: the soul app's `digitsOf` / `secretLines` and the officer app's `digits` / `groupKey`.
 */

/** The six digits an authenticator code box may hold: everything else a paste brings is dropped. */
export function mfaDigits(text: string): string {
  return text.replace(/\D/g, "").slice(0, 6);
}

/** A setup secret four characters to a group, four groups to a line (16 characters = one line), for copying by hand. */
export function secretLines(secret: string): string[] {
  const groups = secret.match(/.{1,4}/g) ?? [];
  const lines: string[] = [];
  for (let i = 0; i < groups.length; i += 4) lines.push(groups.slice(i, i + 4).join(" "));
  return lines;
}
