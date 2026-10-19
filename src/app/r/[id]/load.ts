import "server-only";
import { cache } from "react";
import { loadShare, shareStore, type SharedReview } from "@/lib/server/shares";

/** A shared review by id, read once per request (the page, its metadata and its card share it). */
export const sharedReview = cache(async (id: string): Promise<SharedReview | null> => {
  const db = shareStore();
  if (!db) return null;
  try {
    return await loadShare(db, id);
  } catch {
    return null;
  }
});
