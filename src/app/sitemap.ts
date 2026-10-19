import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";
import { LANDINGS } from "@/lib/landing";

export default function sitemap(): MetadataRoute.Sitemap {
  // The pages change with each deploy, so the build date is their last change.
  const lastModified = new Date();
  return [
    { url: SITE_URL, lastModified, changeFrequency: "weekly", priority: 1 },
    ...LANDINGS.map((p) => ({ url: `${SITE_URL}${p.path}`, lastModified, changeFrequency: "monthly" as const, priority: 0.8 })),
    { url: `${SITE_URL}/credits`, lastModified, changeFrequency: "monthly", priority: 0.5 },
  ];
}
