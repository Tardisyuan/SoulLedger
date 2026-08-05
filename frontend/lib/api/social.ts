import { api } from "./client";
import type { PaginatedResponse } from "./users";

/**
 * PostSerializer / PostListSerializer (backend/apps/social/serializers.py:12
 * and :56). The list serializer omits `tenant` and `update_time`, so both are
 * optional here — they were declared required and are absent from every
 * element of GET /social/posts/ and GET /social/posts/feed/.
 */
export interface Post {
  id: string;
  author: string;
  author_name: string;
  author_username: string;
  content: string;
  visibility: "PUBLIC" | "TENANT" | "FOLLOWERS" | "PRIVATE";
  comment_count: number;
  reaction_count: number;
  tenant?: number;
  create_time: string;
  update_time?: string;
}

/** CommentSerializer / CommentListSerializer (serializers.py:81 and :111). */
export interface Comment {
  id: string;
  post: string;
  author: string;
  author_name: string;
  author_username: string;
  parent: string | null;
  content: string;
  tenant?: number;
  create_time: string;
  update_time?: string;
}

export interface Reaction {
  id: string;
  user: string;
  user_name: string;
  post: string | null;
  comment: string | null;
  reaction_type: "LIKE" | "LOVE" | "RESPECT" | "SYMPATHY" | "ETERNAL_LIGHT";
  tenant: number;
  create_time: string;
}

export interface Follow {
  id: string;
  follower: string;
  follower_name: string;
  following: string;
  following_name: string;
  tenant: number;
  create_time: string;
}

export interface UserProfile {
  id: string;
  user: string;
  username: string;
  bio: string;
  avatar_url: string;
  followers_count: number;
  following_count: number;
  post_count: number;
}

export const socialApi = {
  // Posts
  listPosts: (params?: Record<string, string | number | undefined>) =>
    api.get<PaginatedResponse<Post>>("/social/posts/", { params }),
  getPost: (id: string) => api.get<Post>(`/social/posts/${id}/`),
  createPost: (data: { content: string; visibility?: string }) =>
    api.post<Post>("/social/posts/", data),
  updatePost: (id: string, data: Partial<Post>) =>
    api.patch<Post>(`/social/posts/${id}/`, data),
  deletePost: (id: string) => api.delete<void>(`/social/posts/${id}/`),
  /**
   * Bimodal, and deliberately typed as such: the action paginates normally
   * (backend/apps/social/views.py:108) but short-circuits to a bare `[]` when
   * the request carries no tenant (views.py:112).
   */
  feed: (params?: Record<string, string | number | undefined>) =>
    api.get<PaginatedResponse<Post> | Post[]>("/social/posts/feed/", { params }),

  // Comments
  listComments: (params?: Record<string, string | number | undefined>) =>
    api.get<PaginatedResponse<Comment>>("/social/comments/", { params }),
  createComment: (data: { post: string; content: string; parent?: string }) =>
    api.post<Comment>("/social/comments/", data),
  deleteComment: (id: string) => api.delete<void>(`/social/comments/${id}/`),

  // Reactions
  listReactions: (params?: Record<string, string | number | undefined>) =>
    api.get<PaginatedResponse<Reaction>>("/social/reactions/", { params }),
  addReaction: (data: { post?: string; comment?: string; reaction_type: string }) =>
    api.post<Reaction>("/social/reactions/", data),
  deleteReaction: (id: string) => api.delete<void>(`/social/reactions/${id}/`),

  // Follows
  listFollows: (params?: Record<string, string | number | undefined>) =>
    api.get<PaginatedResponse<Follow>>("/social/follows/", { params }),
  follow: (data: { following: string }) =>
    api.post<Follow>("/social/follows/", data),
  unfollow: (id: string) => api.delete<void>(`/social/follows/${id}/`),
  toggleFollow: (followingId: string) =>
    api.post<{ following: boolean }>("/social/follows/toggle/", { following: followingId }),
  // Bare arrays — both @actions serialize and return directly
  // (backend/apps/social/views.py:271 and :281), unlike the viewset's list.
  following: () => api.get<Follow[]>("/social/follows/following/"),
  followers: () => api.get<Follow[]>("/social/follows/followers/"),

  // Profiles
  getProfile: (id: string) => api.get<UserProfile>(`/social/profiles/${id}/`),
  updateProfile: (id: string, data: Partial<UserProfile>) =>
    api.patch<UserProfile>(`/social/profiles/${id}/`, data),
  myProfile: () => api.get<UserProfile>("/social/profiles/me/"),
};
