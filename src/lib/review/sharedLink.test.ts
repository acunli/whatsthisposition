import { describe, expect, it } from "vitest";
import { linkInPath, linkInText, looksLikeGame } from "./sharedLink";

describe("linkInPath", () => {
  it("reads a site address typed after ours, with or without its scheme", () => {
    expect(linkInPath("/chess.com/game/live/185094379256")).toBe("https://chess.com/game/live/185094379256");
    expect(linkInPath("/www.chess.com/game/daily/123")).toBe("https://www.chess.com/game/daily/123");
    expect(linkInPath("/https://lichess.org/abcd1234")).toBe("https://lichess.org/abcd1234");
    expect(linkInPath("/https:/lichess.org/abcd1234/black")).toBe("https://lichess.org/abcd1234/black");
    expect(linkInPath("/http://www.lichess.org/@/DrNykterstein")).toBe("https://www.lichess.org/@/DrNykterstein");
  });

  it("keeps the query and drops a phone site's m.", () => {
    expect(linkInPath("/https://www.chess.com/game/live/1?move=3")).toBe("https://www.chess.com/game/live/1?move=3");
    expect(linkInPath("/m.chess.com/member/hikaru")).toBe("https://chess.com/member/hikaru");
  });

  it("refuses anything else", () => {
    expect(linkInPath("/games")).toBeNull();
    expect(linkInPath("/https://example.com/chess.com/x")).toBeNull();
    expect(linkInPath("/notchess.com/game/1")).toBeNull();
    expect(linkInPath("/chess.community/x")).toBeNull();
  });
});

describe("linkInText", () => {
  it("finds the game link in a shared message", () => {
    expect(linkInText("Check out this game on Chess.com: https://www.chess.com/game/live/185094379256")).toBe("https://www.chess.com/game/live/185094379256");
    expect(linkInText("lichess.org/abcd1234.")).toBe("https://lichess.org/abcd1234");
    expect(linkInText("good game!")).toBeNull();
  });
});

describe("looksLikeGame", () => {
  it("tells moves from a message", () => {
    expect(looksLikeGame('[Event "Live Chess"]\n[White "a"]\n\n1. e4 e5 *')).toBe(true);
    expect(looksLikeGame("1. e4 e5 2. Nf3 Nc6")).toBe(true);
    expect(looksLikeGame("1.Nf3 d5")).toBe(true);
    expect(looksLikeGame("I won 1. game today")).toBe(false);
  });
});
