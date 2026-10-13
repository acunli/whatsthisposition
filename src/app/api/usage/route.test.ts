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

  it("counts a listed use from the site's own pages, with the visitor's country", async () => {
    const r = await post({ e: "review", s: "lichess" }, { "x-vercel-ip-country": "IN" });
    expect(r.status).toBe(204);
    expect(recorded).toHaveLength(1);
    const [, prefix, day, e, s, token, country] = recorded[0];
    expect([prefix, e, s, country]).toEqual(["use-local", "review", "lichess", "IN"]);
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(String(token)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses other sites, unknown uses and junk, and quietly skips bots", async () => {
    expect((await post({ e: "visit" }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ e: "visit" }, { origin: "null" })).status).toBe(403);
    expect((await post({ e: "signup" })).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ e: "visit" }, { "user-agent": "Googlebot/2.1" })).status).toBe(204);
    expect(recorded).toHaveLength(0);
  });
});
