/**
 * useRealtimeFeed — live feed updates via WebSocket.
 *
 * Subscribes to social events and invalidates feed queries automatically.
 * Provides:
 *   - Live post count updates
   - Real-time new post notifications
   - Connection status
 *   - Event history for debugging
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSocialEventBus } from "./useSocialEventBus";
import { socialKeys } from "@/lib/social/models";

// ── Types ────────────────────────────────────────────────────────────

/** Generic social event shape from the WebSocket client */
export interface SocialWSLikeEvent {
  domain?: string;
  event?: string;
  [key: string]: unknown;
}

export interface FeedEvent {
  event: SocialWSLikeEvent;
  timestamp: number;
}

export interface RealtimeFeedState {
  /** Whether the feed is receiving live updates */
  isLive: boolean;
  /** Number of new posts since last manual refresh */
  newPostCount: number;
  /** Recent events for debugging (last 50) */
  recentEvents: FeedEvent[];
  /** Manually mark new posts as seen */
  markSeen: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────

export function useRealtimeFeed(userId: string): RealtimeFeedState {
  const queryClient = useQueryClient();
  const { subscribe, isConnected } = useSocialEventBus();
  const [newPostCount, setNewPostCount] = useState(0);
  const [recentEvents, setRecentEvents] = useState<FeedEvent[]>([]);
  const maxEvents = 50;

  // Subscribe to post events
  useEffect(() => {
    if (!userId) return;

    const unsubscribes = [
      subscribe("POST_CREATED", (event: SocialWSLikeEvent) => {
        // Only count posts from other users
        if (event.user_id && event.user_id !== userId) {
          setNewPostCount((prev) => prev + 1);
        }

        // Add to recent events
        setRecentEvents((prev) => {
          const next = [{ event, timestamp: Date.now() }, ...prev];
          return next.slice(0, maxEvents);
        });

        // Invalidate feed cache
        queryClient.invalidateQueries({ queryKey: socialKeys.feed.list(userId) });
      }),

      subscribe("POST_UPDATED", (event: SocialWSLikeEvent) => {
        if (event.post_id) {
          queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id as string) });
        }
        queryClient.invalidateQueries({ queryKey: socialKeys.feed.list(userId) });
      }),

      subscribe("POST_DELETED", (event: SocialWSLikeEvent) => {
        if (event.post_id) {
          queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id as string) });
        }
        queryClient.invalidateQueries({ queryKey: socialKeys.feed.list(userId) });
      }),

      subscribe("COMMENT_CREATED", (event: SocialWSLikeEvent) => {
        if (event.post_id) {
          queryClient.invalidateQueries({ queryKey: socialKeys.comments.byPost(event.post_id as string) });
          queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id as string) });
        }
      }),

      subscribe("REACTION_ADDED", (event: SocialWSLikeEvent) => {
        if (event.post_id) {
          queryClient.invalidateQueries({ queryKey: socialKeys.reactions.byPost(event.post_id as string) });
          queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id as string) });
        }
      }),

      subscribe("REACTION_REMOVED", (event: SocialWSLikeEvent) => {
        if (event.post_id) {
          queryClient.invalidateQueries({ queryKey: socialKeys.reactions.byPost(event.post_id as string) });
          queryClient.invalidateQueries({ queryKey: socialKeys.posts.detail(event.post_id as string) });
        }
      }),

      subscribe("USER_FOLLOWED", () => {
        queryClient.invalidateQueries({ queryKey: socialKeys.follows.all });
      }),

      subscribe("USER_UNFOLLOWED", () => {
        queryClient.invalidateQueries({ queryKey: socialKeys.follows.all });
      }),
    ];

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [userId, subscribe, queryClient]);

  const markSeen = useCallback(() => {
    setNewPostCount(0);
  }, []);

  return {
    isLive: isConnected,
    newPostCount,
    recentEvents,
    markSeen,
  };
}
