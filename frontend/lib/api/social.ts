import { api } from "./client";

// Types matching backend models exactly
export interface Post {
  id: string;
  author: string;
  author_name: string;
  author_username: string;
  content: string;
  visibility: "PUBLIC" | "TENANT" | "FOLLOWERS" | "PRIVATE";
  comment_count: number;
  reaction_count: number;
  tenant: number;
  create_time: string;
  update_time: string;
}

export interface Comment {
  id: string;
  post: string;
  author: string;
  author_name: string;
  author_username: string;
  parent: string | null;
  content: string;
  tenant: number;
  create_time: string;
  update_time: string;
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
    api.get("/social/posts/", { params }),
  getPost: (id: string) => api.get(`/social/posts/${id}/`),
  createPost: (data: { content: string; visibility?: string }) =>
    api.post("/social/posts/", data),
  updatePost: (id: string, data: Partial<Post>) =>
    api.patch(`/social/posts/${id}/`, data),
  deletePost: (id: string) => api.delete(`/social/posts/${id}/`),
  feed: (params?: Record<string, string | number | undefined>) =>
    api.get("/social/posts/feed/", { params }),

  // Comments
  listComments: (params?: Record<string, string | number | undefined>) =>
    api.get("/social/comments/", { params }),
  createComment: (data: { post: string; content: string; parent?: string }) =>
    api.post("/social/comments/", data),
  deleteComment: (id: string) => api.delete(`/social/comments/${id}/`),

  // Reactions
  listReactions: (params?: Record<string, string | number | undefined>) =>
    api.get("/social/reactions/", { params }),
  addReaction: (data: { post?: string; comment?: string; reaction_type: string }) =>
    api.post("/social/reactions/", data),
  deleteReaction: (id: string) => api.delete(`/social/reactions/${id}/`),

  // Follows
  listFollows: (params?: Record<string, string | number | undefined>) =>
    api.get("/social/follows/", { params }),
  follow: (data: { following: string }) =>
    api.post("/social/follows/", data),
  unfollow: (id: string) => api.delete(`/social/follows/${id}/`),
  toggleFollow: (followingId: string) =>
    api.post("/social/follows/toggle/", { following: followingId }),
  following: () => api.get("/social/follows/following/"),
  followers: () => api.get("/social/follows/followers/"),

  // Profiles
  getProfile: (id: string) => api.get(`/social/profiles/${id}/`),
  updateProfile: (id: string, data: Partial<UserProfile>) =>
    api.patch(`/social/profiles/${id}/`, data),
  myProfile: () => api.get("/social/profiles/me/"),
};
