/**
 * 「zh***g」: enough to recognise one's own account, not enough to read it off someone else's screen. The remembered
 * account's card (Design 第五十批 C3) in the officer app and, since 第五十二批 F4, on the web's sign-in page.
 */
export function maskUsername(name: string): string {
  const head = name.length >= 5 ? 2 : 1;
  const tail = name.length >= 3 ? 1 : 0;
  return `${name.slice(0, head)}***${tail ? name.slice(-tail) : ""}`;
}
