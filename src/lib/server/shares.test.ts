import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { loadShare, saveShare, shareId } = await import("./shares");
type Db = import("./shares").ShareDb;
type Shared = import("./shares").SharedReview;

function fakeDb() {
  const kv = new Map<string, string>();
  const db: Db & { kv: typeof kv } = {
    kv,
    set: async (key, value, opts) => (opts.nx && kv.has(key) ? null : (kv.set(key, value), "OK")),
    get: async (key) => kv.get(key) ?? null,
  };
  return db;
}

const share = (over: Partial<Shared> = {}): Shared => ({
  v: 1,
  pgn: "1. e4 e5 *",
  as: "w",
  depth: 14,
  data: "packed",
  summary: { white: "A", black: "B", result: "*", as: "w", accuracy: { w: 90, b: 80 }, counts: { w: {}, b: {} }, finalFen: "8/8/8/8/8/8/8/8 w - - 0 1" },
  at: 1,
  ...over,
});

describe("shared reviews", () => {
  it("get a short id from their content", () => {
    expect(shareId(share())).toMatch(/^[0-9A-Za-z]{10}$/);
    expect(shareId(share())).toBe(shareId(share({ at: 2 })));
    expect(shareId(share())).not.toBe(shareId(share({ as: "b" })));
    expect(shareId(share())).not.toBe(shareId(share({ depth: 18 })));
  });

  it("are stored once per environment and read back", async () => {
    const db = fakeDb();
    const id = await saveShare(db, share(), "production");
    expect([...db.kv.keys()]).toEqual([`share:${id}`]);
    expect(await saveShare(db, share({ at: 5 }), "production")).toBe(id);
    expect((await loadShare(db, id, "production"))?.at).toBe(1);
    expect(await loadShare(db, id, "preview")).toBeNull();
    await saveShare(db, share(), "preview");
    expect(db.kv.has(`share-preview:${id}`)).toBe(true);
  });

  it("read nothing for a bad id or a damaged record", async () => {
    const db = fakeDb();
    expect(await loadShare(db, "../../etc", "production")).toBeNull();
    db.kv.set("share:AAAAAAAAAA", "{not json");
    expect(await loadShare(db, "AAAAAAAAAA", "production")).toBeNull();
  });
});
