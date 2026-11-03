import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { forgetPlayer, isNewGame, markReviewed, rememberPlayer, rememberedPlayer, reviewedGames } from "./player";

describe("the remembered player", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    } as Storage;
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("is remembered with when the list was seen, and forgotten", () => {
    expect(rememberedPlayer()).toBeNull();
    rememberPlayer("lichess", "DrNykterstein", 1000);
    expect(rememberedPlayer()).toEqual({ site: "lichess", user: "DrNykterstein", seenAt: 1000 });
    markReviewed("a");
    forgetPlayer();
    expect(rememberedPlayer()).toBeNull();
    expect(reviewedGames().size).toBe(0);
  });

  it("refuses what isn't a player", () => {
    localStorage.setItem("wtp-player", JSON.stringify({ site: "fide", user: "x" }));
    expect(rememberedPlayer()).toBeNull();
    localStorage.setItem("wtp-player", "{not json");
    expect(rememberedPlayer()).toBeNull();
  });

  it("keeps the reviewed games, newest last, without repeats", () => {
    markReviewed("a");
    markReviewed("b");
    markReviewed("a");
    expect([...reviewedGames()]).toEqual(["b", "a"]);
  });

  it("calls a game new when played since the last visit and not reviewed", () => {
    expect(isNewGame(2000, 1000, false)).toBe(true);
    expect(isNewGame(2000, 1000, true)).toBe(false);
    expect(isNewGame(500, 1000, false)).toBe(false);
    expect(isNewGame(2000, 0, false)).toBe(false);
    expect(isNewGame(undefined, 1000, false)).toBe(false);
  });
});
