import { describe, expect, it } from "vitest";
import { channelOf } from "./channel";
import { parseUse } from "./usage";

const HOST = "www.whatsthisposition.com";
const from = (referrer: string, search = "") => channelOf(referrer, search, HOST);

describe("where a visitor came from", () => {
  it("reads search engines, including country domains", () => {
    expect(from("https://www.google.com/")).toBe("google");
    expect(from("https://www.google.co.uk/")).toBe("google");
    expect(from("https://www.bing.com/search?q=chess")).toBe("bing");
    expect(from("https://duckduckgo.com/")).toBe("duckduckgo");
    expect(from("https://search.yahoo.co.jp/")).toBe("yahoo");
    expect(from("https://yandex.ru/")).toBe("yandex");
  });

  it("tells Google's other products from its search", () => {
    expect(from("https://gemini.google.com/app")).toBe("gemini");
    expect(from("https://chromewebstore.google.com/detail/abc")).toBe("chromestore");
    expect(from("https://mail.google.com/")).toBe("email");
  });

  it("reads AI assistants, communities and chess sites", () => {
    expect(from("https://chatgpt.com/")).toBe("chatgpt");
    expect(from("https://www.perplexity.ai/")).toBe("perplexity");
    expect(from("https://out.reddit.com/t3_x")).toBe("reddit");
    expect(from("https://news.ycombinator.com/item?id=1")).toBe("hackernews");
    expect(from("https://t.co/abc")).toBe("x");
    expect(from("https://bsky.app/profile/x")).toBe("bluesky");
    expect(from("https://m.youtube.com/watch?v=1")).toBe("youtube");
    expect(from("https://www.chess.com/forum/view/general")).toBe("chesscom");
    expect(from("https://lichess.org/forum")).toBe("lichess");
    expect(from("https://addons.mozilla.org/en-US/firefox/addon/x")).toBe("firefoxstore");
  });

  it("doesn't take a lookalike host for a known one", () => {
    expect(from("https://notgoogle.example/")).toBe("other");
    expect(from("https://reddit.com.evil.example/")).toBe("other");
  });

  it("prefers the link's own tag", () => {
    expect(from("https://www.google.com/", "?ref=bluesky")).toBe("bluesky");
    expect(from("", "?utm_source=Reddit&utm_medium=post")).toBe("reddit");
    expect(from("https://www.google.com/", "?ref=made-up")).toBe("google");
  });

  it("isn't counted for moves within the site, with or without www", () => {
    expect(from("https://www.whatsthisposition.com/lichess-game-review")).toBeNull();
    expect(from("https://whatsthisposition.com/")).toBeNull();
  });

  it("has no referrer, an extension or an unreadable one", () => {
    expect(from("")).toBe("none");
    expect(from("chrome-extension://abcdef/panel.html")).toBe("extension");
    expect(from("not a url")).toBe("other");
  });

  it("is a source the counter accepts", () => {
    expect(parseUse({ e: "arrive", s: from("https://www.google.com/") })).toEqual({ e: "arrive", s: "google" });
    expect(parseUse({ e: "arrive", s: "https://www.google.com/" })).toBeNull();
  });
});
