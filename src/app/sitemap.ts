import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

export default function sitemap(): MetadataRoute.Sitemap {
  // The pages change with each deploy, so the build date is their last change.
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/credits`, lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
