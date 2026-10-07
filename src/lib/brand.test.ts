import { afterEach, describe, expect, it, vi } from "vitest";

async function siteUrl() {
  vi.resetModules();
  return (await import("./brand")).SITE_URL;
}

describe("SITE_URL", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is the .com address when nothing is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    expect(await siteUrl()).toBe("https://whatsthisposition.com");
  });

  it("follows Vercel's production domain", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "whatsthisposition.vercel.app");
    expect(await siteUrl()).toBe("https://whatsthisposition.vercel.app");
  });

  it("prefers an explicit address, without a trailing slash", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://chess.example.org/");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "whatsthisposition.vercel.app");
    expect(await siteUrl()).toBe("https://chess.example.org");
  });
});
