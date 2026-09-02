import { api, fetchAllPages } from "./client";

/** NOTE ON WHICH FIELDS THE *LIST* ENDPOINT ACTUALLY SENDS.
 *
 * `ActorListSerializer` emits exactly: id, name, civilization, role,
 * realm_code, display_name, display_title, is_active, assessor_index.
 * Everything else below belongs to the detail or localized serializers, and
 * is optional here for that reason -- `/actors` was reading `title`,
 * `name_zh` and `description` off list rows and getting undefined for all
 * 130 of them, while `display_title` (already localized by the backend) sat
 * unread in the same payload.
 *
 * `icon` is on no serializer at all; the model column is `icon_url`. Both are
 * kept optional because the interface also covers detail responses.
 */
export interface Actor {
  id: string;
  name: string;
  /** Localized by the backend. Present on the list endpoint. */
  display_name?: string;
  /** Localized by the backend. Present on the list endpoint. */
  display_title?: string;
  name_zh?: string;
  name_en?: string;
  name_egy?: string;
  title?: string;
  title_zh?: string;
  title_en?: string;
  title_egy?: string;
  civilization: string;
  role: string;
  realm?: string;
  realm_code?: string;
  description?: string;
  powers_json?: Record<string, unknown>;
  /**
   * Seat on the Forty-Two Assessors of Ma'at (Book of the Dead ch. 125), or
   * null/absent for an actor who holds none. The list endpoint projects this
   * one key out of `powers_json` — presence tells a bench member apart from a
   * major god, and the value is the order the papyrus seats them in, which is
   * NOT their alphabetical order.
   */
  assessor_index?: number | null;
  icon?: string;
  icon_url?: string;
  is_active: boolean;
}

export const actorsApi = {
  list: async (params?: Record<string, string>) => {
    const data = await fetchAllPages<Actor>("/actors/", params);
    return { data: { results: data, count: data.length } };
  },
  get: (id: string) => api.get<Actor>(`/actors/${id}/`),
};
