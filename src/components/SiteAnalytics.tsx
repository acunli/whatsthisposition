"use client";

import { Analytics } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics: cookieless page views (visitors are a daily hash Vercel discards after
 * 24 hours), for referrers, countries and devices in the Vercel dashboard. The owner's own
 * dashboard (/stats) isn't counted, and links drop their #fragment (a review link carries the game).
 */
export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => {
        const url = new URL(event.url);
        if (url.pathname.startsWith("/stats")) return null;
        url.hash = "";
        return { ...event, url: url.toString() };
      }}
    />
  );
}
