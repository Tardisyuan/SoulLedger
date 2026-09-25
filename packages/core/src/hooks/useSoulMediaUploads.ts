/**
 * The composer's image uploads: upload first, post after (backend
 * `apps/social/media.py`). Each picked image uploads on its own request, so
 * each has its own progress and its own failure; a failed one can be retried
 * or removed without touching the others.
 *
 * `ready` is the composer's gate: true only when nothing is uploading and
 * nothing has failed. A post sent before that would either lose the image or
 * be refused — the server only attaches uploads that have finished.
 *
 * `S` is whatever the host calls a picked image (on a phone, the picker's
 * `{ uri, … }` asset); `toBody` turns it into the multipart body, because what
 * a "file" is belongs to the platform (see `soulSocialApi.uploadMedia`).
 *
 * Removing an image that already uploaded deletes it on the server (best
 * effort — the orphan cleanup command collects anything a failed delete or a
 * crashed app leaves behind). Removing one still in flight marks it; when its
 * request lands, the upload is deleted rather than kept.
 */
import { useCallback, useRef, useState } from "react";
import { soulSocialApi, type SoulPostMediaUpload } from "../api/soul-social";
import { SOUL_POST_MEDIA_MAX } from "../domain/postMedia";

export type SoulMediaUploadStatus = "uploading" | "done" | "failed";

export interface SoulMediaUpload<S> {
  key: string;
  source: S;
  status: SoulMediaUploadStatus;
  /** 0..1 while uploading; 1 once done. */
  progress: number;
  media: SoulPostMediaUpload | null;
  error: unknown;
}

let seq = 0;

export function useSoulMediaUploads<S>(toBody: (source: S) => FormData, max: number = SOUL_POST_MEDIA_MAX) {
  const [items, setItems] = useState<SoulMediaUpload<S>[]>([]);
  // Keys removed while their request was in flight: the upload is deleted when it lands.
  const dropped = useRef(new Set<string>());

  const patch = useCallback((key: string, change: Partial<SoulMediaUpload<S>>) => {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...change } : it)));
  }, []);

  const start = useCallback(
    (key: string, source: S) => {
      soulSocialApi
        .uploadMedia(toBody(source), (progress) => patch(key, { progress }))
        .then((media) => {
          if (dropped.current.delete(key)) {
            void soulSocialApi.removeMedia(media.id).catch(() => {});
            return;
          }
          patch(key, { status: "done", progress: 1, media, error: null });
        })
        .catch((error: unknown) => {
          if (dropped.current.delete(key)) return;
          patch(key, { status: "failed", error });
        });
    },
    [toBody, patch]
  );

  /** Adds up to the remaining room; returns how many were taken. */
  const add = useCallback(
    (sources: S[]) => {
      const room = Math.max(0, max - items.length);
      const taken = sources.slice(0, room).map((source) => ({
        key: `m${++seq}`,
        source,
        status: "uploading" as const,
        progress: 0,
        media: null,
        error: null,
      }));
      if (taken.length) setItems((prev) => [...prev, ...taken]);
      taken.forEach((it) => start(it.key, it.source));
      return taken.length;
    },
    [items.length, max, start]
  );

  const retry = useCallback(
    (key: string) => {
      const item = items.find((it) => it.key === key);
      if (!item || item.status !== "failed") return;
      patch(key, { status: "uploading", progress: 0, error: null });
      start(key, item.source);
    },
    [items, patch, start]
  );

  const remove = useCallback(
    (key: string) => {
      const item = items.find((it) => it.key === key);
      if (!item) return;
      if (item.status === "uploading") dropped.current.add(key);
      if (item.media) void soulSocialApi.removeMedia(item.media.id).catch(() => {});
      setItems((prev) => prev.filter((it) => it.key !== key));
    },
    [items]
  );

  /** After a successful post: the uploads now belong to it, so nothing is deleted. */
  const clear = useCallback(() => setItems([]), []);

  /** Leaving the composer without posting: delete what was uploaded. */
  const discard = useCallback(() => {
    items.forEach((it) => remove(it.key));
  }, [items, remove]);

  const uploading = items.some((it) => it.status === "uploading");
  const failed = items.some((it) => it.status === "failed");
  return {
    items,
    add,
    retry,
    remove,
    clear,
    discard,
    uploading,
    failed,
    ready: !uploading && !failed,
    room: Math.max(0, max - items.length),
    mediaIds: items.flatMap((it) => (it.media ? [it.media.id] : [])),
  };
}
