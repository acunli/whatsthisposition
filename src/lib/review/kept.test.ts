import { afterEach, describe, expect, it, vi } from "vitest";
import { keepReview, keptReview, updateKeptReview } from "./kept";

/** A tab's session storage. */
function storage(throws = false) {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => {
      if (throws) throw new Error("blocked");
      return items.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (throws) throw new Error("blocked");
      items.set(k, v);
    },
  });
  return items;
}

const PGN = '[White "A"]\n[Black "B"]\n\n1. e4 e5 *\n';

describe("the game kept for the review page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a game and gives it back", () => {
    storage();
    expect(keptReview()).toBeNull();
    keepReview({ pgn: PGN, as: "b" });
    expect(keptReview()).toEqual({ pgn: PGN, as: "b" });
  });

  it("adds the finished review and the orientation only to the game it belongs to", () => {
    storage();
    keepReview({ pgn: PGN });
    updateKeptReview(PGN, { depth: 14, data: "packed" });
    updateKeptReview(PGN, { as: "b" });
    updateKeptReview("another game", { as: "w", data: "other" });
    expect(keptReview()).toEqual({ pgn: PGN, as: "b", depth: 14, data: "packed" });
  });

  it("drops what isn't a game", () => {
    const items = storage();
    for (const bad of ["{", "null", "[]", '{"pgn":""}', '{"pgn":3}']) {
      items.set("wtp-review", bad);
      expect(keptReview()).toBeNull();
    }
    items.set("wtp-review", JSON.stringify({ pgn: PGN, as: "x", depth: -1, data: 5 }));
    expect(keptReview()).toEqual({ pgn: PGN });
  });

  it("does without storage", () => {
    storage(true);
    expect(() => keepReview({ pgn: PGN })).not.toThrow();
    expect(keptReview()).toBeNull();
    vi.unstubAllGlobals();
    expect(keptReview()).toBeNull(); // no sessionStorage at all (the server)
  });
});
