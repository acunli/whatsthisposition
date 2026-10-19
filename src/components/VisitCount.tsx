"use client";

import { useEffect } from "react";
import { channelOf } from "@/lib/channel";
import { countUse } from "@/lib/usage";

/**
 * Counts one visit per page load, on every page but /stats: where it started (the extension's
 * link, a shared review's #review link or /r/ page, or anything else) and where the visitor
 * came from. The address is read when this module loads, before any page code runs: the app
 * clears a #review link from the address bar as soon as it opens it. Moving between the site's
 * pages loads nothing new, so it isn't counted again.
 */
const first = typeof window === "undefined" ? null : { hash: window.location.hash, search: window.location.search, path: window.location.pathname, referrer: document.referrer };

export function VisitCount() {
  useEffect(() => {
    if (!first || first.path.startsWith("/stats")) return;
    const handed = /^#(.*&)?review=/.test(first.hash);
    countUse("visit", first.path.startsWith("/r/") ? "link" : handed ? (/[#&]data=/.test(first.hash) ? "extension" : "link") : "direct");
    const from = channelOf(first.referrer, first.search, window.location.hostname);
    if (from) countUse("arrive", from);
  }, []);
  return null;
}
