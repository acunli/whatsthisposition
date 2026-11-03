import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    id: "/",
    start_url: "/?ref=app",
    scope: "/",
    display: "standalone",
    categories: ["games", "education"],
    background_color: "#0c110f",
    theme_color: "#0c110f",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    // Installed on a phone, the app is in the share sheet: Share a game in the Chess.com or Lichess
    // app, pick what'sthisposition, and its review opens (src/app/share/route.ts).
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
  };
}
