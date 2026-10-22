import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const recorded: unknown[][] = [];
vi.mock("@/lib/server/usage", async (orig) => {
  const real = await orig<typeof import("@/lib/server/usage")>();
  return { ...real, usageStore: () => ({}) as never, recordUse: async (...args: unknown[]) => void recorded.push(args) };
});
const { POST } = await import("./route");

const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://www.whatsthisposition.com/api/usage", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "https://www.whatsthisposition.com", "user-agent": browser, "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 250)}`, ...headers },
    }),
  );

describe("POST /api/usage", () => {
  afterEach(() => void (recorded.length = 0));

  it("counts a listed use from the site's own pages, with what the request says about the visitor", async () => {
    const r = await post(
      { e: "visit", s: "direct", p: "/", d: { input: "touch" } },
      { "x-vercel-ip-country": "IN", "x-vercel-ip-country-region": "MH", "x-vercel-ip-city": "Mumbai", "x-vercel-ip-timezone": "Asia/Kolkata", "accept-language": "en-IN,en;q=0.9" },
    );
    expect(r.status).toBe(204);
    expect(recorded).toHaveLength(1);
    const [, prefix, t, use, visitor] = recorded[0] as [unknown, string, number, unknown, import("@/lib/server/usage").Visitor];
    expect(prefix).toBe("use-local");
    expect(Math.abs(t - Date.now())).toBeLessThan(5000);
    expect(use).toEqual({ e: "visit", s: "direct", p: "/", d: { input: "touch" } });
    expect(visitor.token).toMatch(/^[0-9a-f]{32}$/);
    // A "Mac" with a touch screen is an iPad.
    expect(visitor.software).toEqual({ device: "tablet", os: "iPadOS", browser: "Chrome" });
    expect([visitor.country, visitor.region, visitor.city, visitor.lang]).toEqual(["IN", "MH", "Mumbai", "en"]);
    expect(visitor.localHour).toMatch(/^\d\d$/);
  });

  it("refuses other sites, unknown uses and junk, and quietly skips bots", async () => {
    expect((await post({ e: "visit" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ e: "visit" }, { origin: "null" })).status).toBe(403);
    expect((await post({ e: "signup" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ e: "visit" }, { "user-agent": "Googlebot/2.1" })).status).toBe(204);
    expect(recorded).toHaveLength(0);
  });

  it("keeps only clean place names", async () => {
    await post({ e: "visit" }, { "x-vercel-ip-country": "<b>", "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-vercel-ip-country-region": "too-long" });
    const visitor = recorded[0][4] as import("@/lib/server/usage").Visitor;
    expect([visitor.country, visitor.region, visitor.city]).toEqual(["", "", "São Paulo"]);
  });
});
