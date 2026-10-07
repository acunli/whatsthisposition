/** EngineClient against a scripted transport: the bits a real engine can't reproduce on demand. */
import { describe, expect, it } from "vitest";
import { EngineClient, type EngineTransport } from "./client";

/** A fake engine that answers the handshake and plays back `script` after `go`. */
function scripted(script: string[]): EngineTransport {
  let emit: (line: string) => void = () => undefined;
  return {
    post: (cmd) => {
      const reply = (l: string) => queueMicrotask(() => emit(l));
      if (cmd === "uci") reply("uciok");
      else if (cmd === "isready") reply("readyok");
      else if (cmd.startsWith("go")) for (const l of script) reply(l);
    },
    onLine: (cb) => {
      emit = cb;
    },
    onError: () => undefined,
    terminate: () => undefined,
  };
}

describe("EngineClient", () => {
  it("never shows the same move twice when the order of lines changes mid-depth", async () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const client = new EngineClient(
      scripted([
        "info depth 10 multipv 1 score cp 30 pv e2e4 e7e5",
        "info depth 10 multipv 2 score cp 25 pv d2d4 d7d5",
        // Depth 11: d4 overtakes e4; rank 2 still holds depth 10's d4 until it's reported.
        "info depth 11 multipv 1 score cp 32 pv d2d4 g8f6",
        "bestmove d2d4",
      ]),
    );
    const snap = await client.analyze({ fen, depth: 11, multipv: 2 }).promise;
    expect(snap.lines.map((l) => l.pv[0])).toEqual(["d2d4"]);
    expect(snap.lines[0].depth).toBe(11);
  });
});
