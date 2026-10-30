/**
 * Who is reborn into one of the six paths (六道). The server's rule, `rebirth_form_for` in
 * `backend/apps/reincarnation/services.py`: only a soul whose HOME civilization is Diyu (CHINESE) chooses a path;
 * any other civilization that is reborn at all (Greek) is stored as OTHER, and naming a path is refused. Residence
 * does not change it -- pass `home_civilization`, not the civilization the soul is in now.
 *
 * One function for every client (cq-web 2026-10-30 #4): the soul app's new-application screen tested `!== GREEK`,
 * which would have asked a European or Egyptian soul to pick a path the server refuses.
 */
export function hasSixPaths(homeCivilization: string | null | undefined): boolean {
  return homeCivilization === "CHINESE";
}
