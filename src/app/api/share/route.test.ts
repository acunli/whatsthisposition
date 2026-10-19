import { describe, expect, it, vi } from "vitest";
import { packReview } from "@/lib/review/share";

vi.mock("server-only", () => ({}));
const kv = new Map<string, string>();
vi.mock("@/lib/server/shares", async (orig) => {
  const real = await orig<typeof import("@/lib/server/shares")>();
  return { ...real, shareStore: () => ({ set: async (k: string, v: string) => void kv.set(k, v), get: async (k: string) => kv.get(k) ?? null }) };
});
const { POST } = await import("./route");

const PGN = '[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 *';
const summary = { white: "A", black: "B", result: "*", as: "w", accuracy: { w: 90, b: 80 }, counts: { w: {}, b: {} }, finalFen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2" };
let ip = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request("https://www.whatsthisposition.com/api/share", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json", origin: "https://www.whatsthisposition.com", "x-forwarded-for": `203.0.113.${ip++}`, ...headers },
    }),
  );

describe("POST /api/share", () => {
  it("stores a finished review and answers its link", async () => {
    const data = await packReview([null, null, null, null], 14);
    const r = await post({ pgn: PGN, as: "w", depth: 14, data, summary });
    expect(r.status).toBe(200);
    const { id, url } = await r.json();
    expect(url).toMatch(new RegExp(`/r/${id}$`));
    expect(JSON.parse(kv.get(`share-local:${id}`)!)).toMatchObject({ pgn: PGN, as: "w", depth: 14, data, summary: { white: "A" } });
  });

  it("refuses other sites, junk and reviews that don't fit the game", async () => {
    const data = await packReview([null, null, null, null], 14);
    expect((await post({ pgn: PGN, as: "w", depth: 14, data, summary }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ pgn: PGN, as: "w", depth: 14, data, summary: { ...summary, as: "x" } })).status).toBe(400);
    expect((await post({ pgn: "not a game", as: "w", depth: 14, data, summary })).status).toBe(400);
    expect((await post({ pgn: PGN, as: "w", depth: 14, data: await packReview([null, null], 14), summary })).status).toBe(400);
    expect((await post({ pgn: PGN, as: "w", depth: 18, data, summary })).status).toBe(400);
    expect((await post("x".repeat(300_000))).status).toBe(413);
  });

  it("limits how many links one address makes", async () => {
    const data = await packReview([null, null, null, null], 14);
    const statuses = [];
    for (let i = 0; i < 22; i++) statuses.push((await post({ pgn: PGN, as: "w", depth: 14, data, summary }, { "x-forwarded-for": "192.0.2.9" })).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });
});
