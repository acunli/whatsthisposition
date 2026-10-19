import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { default: sitemap } = await import("@/app/sitemap");
import { SITE_NAME, SITE_URL } from "./brand";
import { FAQ } from "./faq";
import { LANDINGS } from "./landing";
import { landingGraph, landingMetadata } from "./seo";

describe("landing pages", () => {
  it("each have a page", () => {
    for (const p of LANDINGS) expect(existsSync(join(__dirname, "..", "app", p.path, "page.tsx")), p.path).toBe(true);
  });

  it("have their own address, title, description and questions", () => {
    for (const key of ["path", "title", "description", "name", "h1"] as const) {
      expect(new Set(LANDINGS.map((p) => p[key])).size, key).toBe(LANDINGS.length);
    }
    const questions = [...FAQ, ...LANDINGS.flatMap((p) => p.faq)].map((f) => f.q);
    expect(new Set(questions).size).toBe(questions.length);
  });

  it("fit in a search result", () => {
    for (const p of LANDINGS) {
      // Longer titles and snippets are cut off with an ellipsis.
      expect(`${p.title} · ${SITE_NAME}`.length, p.title).toBeLessThanOrEqual(80);
      expect(p.title.length, p.title).toBeLessThanOrEqual(60);
      expect(p.description.length, p.description).toBeGreaterThanOrEqual(110);
      expect(p.description.length, p.description).toBeLessThanOrEqual(160);
      expect(p.faq.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("are canonical at their own address, and in the sitemap", () => {
    const urls = sitemap().map((u) => u.url);
    for (const p of LANDINGS) {
      expect(landingMetadata(p).alternates?.canonical).toBe(p.path);
      expect(urls).toContain(`${SITE_URL}${p.path}`);
    }
  });

  it("give search engines their questions and a breadcrumb", () => {
    for (const p of LANDINGS) {
      const graph = landingGraph(p)["@graph"] as { "@type": string; mainEntity?: unknown[]; itemListElement?: { item: string }[] }[];
      expect(graph.find((n) => n["@type"] === "FAQPage")?.mainEntity).toHaveLength(p.faq.length);
      expect(graph.find((n) => n["@type"] === "BreadcrumbList")?.itemListElement?.at(-1)?.item).toBe(`${SITE_URL}${p.path}`);
    }
  });
});
