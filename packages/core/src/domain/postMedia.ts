/**
 * 朋友圈帖子图片 — what both clients draw, without either client's HTTP layer.
 *
 * The soul App uploads and reads posts through `soulSocialApi` (./../api/soul-social);
 * the web admin only ever *shows* post images, in /moderation, and never holds a
 * soul token. So the pieces both need live here, importing nothing but the
 * platform's base URL: the web bundle does not pull in the soul client to draw a
 * grid. `api/soul-social` re-exports all of it.
 */
import type { components } from "../api/generated/schema";
import { getApiBaseUrl } from "../platform/index";

/** One image of a post, as the serializers give it: ordered, with a signed `url`. */
export type PostMedia = components["schemas"]["PostMedia"];

/** Images per post (backend `apps/social/media.py::MAX_PER_POST`). */
export const SOUL_POST_MEDIA_MAX = 9;

/**
 * Columns of a post's square image grid — the App's feed and the officers'
 * review detail (C-08) draw the same grid: 1 image is one large tile, 2–4 are
 * two columns, 5–9 are three.
 */
export function mediaGridColumns(count: number): number {
  return count <= 1 ? 1 : count <= 4 ? 2 : 3;
}

/**
 * Where to fetch a post image from. The server gives each viewer a signed path
 * rooted at the site (`/api/v1/social-media/<id>/?t=…`, valid about an hour,
 * re-checked against the post's visibility on every fetch) — no token header,
 * because neither `<img src>` nor a native image view sends one. On the web the
 * API base is same-origin and the path is used as is; on a phone it is joined
 * to the API host's origin.
 */
export function mediaUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const origin = getApiBaseUrl().match(/^https?:\/\/[^/]+/)?.[0] ?? "";
  return origin + path;
}

