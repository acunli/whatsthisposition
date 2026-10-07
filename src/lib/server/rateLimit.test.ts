import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { clientIp, rateLimit } = await import("./rateLimit");

const req = (headers: Record<string, string>) => new Request("https://example.test/api/games", { headers });

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the first x-forwarded-for address, which Vercel and Caddy set", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "198.51.100.2" }))).toBe("203.0.113.7");
  });

  it("ignores a cf-connecting-ip a visitor sends unless the site trusts it", () => {
    const r = req({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "203.0.113.7" });
    expect(clientIp(r)).toBe("203.0.113.7");
    vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
    expect(clientIp(r)).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip, then to one shared local bucket", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(req({}))).toBe("local");
  });
});

describe("rateLimit", () => {
  it("allows `limit` hits per window, then says how long to wait", () => {
    const key = `test-${Math.random()}`;
    expect(rateLimit(key, 2, 60_000)).toBe(0);
    expect(rateLimit(key, 2, 60_000)).toBe(0);
    const wait = rateLimit(key, 2, 60_000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
  });
});
