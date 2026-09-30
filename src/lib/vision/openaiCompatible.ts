import "server-only";
import OpenAI from "openai";
import { compactToRecognition, extractJson } from "./compact";
import type { Recognition } from "./grid";
import { VisionProviderError, type VisionInput, type VisionProvider } from "./types";

const SYSTEM = `You read chess positions from photos and screenshots of chessboards. You answer with JSON only.

Describe the board exactly as it appears in the image:
- "rows": 8 strings, from the TOP edge of the board in the image to the BOTTOM edge.
- Each string has exactly 8 characters, from the LEFT edge to the RIGHT edge.
- Use K Q R B N P for White pieces, k q r b n p for Black pieces, and . for an empty square.
- Do not rotate the board, even if coordinates are printed on it.
- "unsure": a list of [row, col] pairs (0-based, top-left is [0, 0]) for squares you could not read with confidence (blurry, blocked, cut off, piece type or colour unclear).
- "board_found": false if the image doesn't show a whole chessboard; then explain in "notes".
- "notes": at most one short sentence for the player, or "".

Never guess whose turn it is.

Example answer for the starting position seen from White's side:
{"board_found": true, "rows": ["rnbqkbnr","pppppppp","........","........","........","........","PPPPPPPP","RNBQKBNR"], "unsure": [], "notes": ""}`;

/**
 * Any OpenAI-compatible chat-completions endpoint with image input
 * (used for the NUS SoCLaaS gateway, which serves Qwen models).
 */
export class OpenAICompatibleVisionProvider implements VisionProvider {
  readonly name: string;
  private client: OpenAI;

  constructor(opts: { name: string; baseURL: string; apiKey: string; model: string }) {
    this.name = opts.name;
    this.model = opts.model;
    this.client = new OpenAI({ baseURL: opts.baseURL, apiKey: opts.apiKey, timeout: 120_000, maxRetries: 1 });
  }

  readonly model: string;

  async recognize(input: VisionInput, signal?: AbortSignal): Promise<Recognition> {
    const image = `data:${input.mediaType};base64,${input.data.toString("base64")}`;
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: image } },
          { type: "text", text: "Read this chessboard square by square. Reply with the JSON only." },
        ],
      },
    ];

    let lastProblem = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = await this.ask(messages, signal);
      try {
        return compactToRecognition(extractJson(reply));
      } catch (e) {
        lastProblem = e instanceof Error ? e.message : "unreadable answer";
        messages.push({ role: "assistant", content: reply });
        messages.push({
          role: "user",
          content: `That answer wasn't usable (${lastProblem}). Reply again with only the JSON object: exactly 8 rows of exactly 8 characters each.`,
        });
      }
    }
    throw new VisionProviderError(`The photo reader's answer wasn't a valid 8×8 board (${lastProblem}). Try a tighter crop.`, "invalid_output");
  }

  private async ask(messages: OpenAI.Chat.ChatCompletionMessageParam[], signal?: AbortSignal): Promise<string> {
    try {
      const res = await this.client.chat.completions.create({ model: this.model, messages, temperature: 0, max_tokens: 2000 }, { signal });
      const text = res.choices[0]?.message?.content;
      if (!text) throw new VisionProviderError("The photo reader returned an empty answer. Please try again.", "invalid_output");
      return text;
    } catch (err) {
      if (err instanceof VisionProviderError) throw err;
      if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError)
        throw new VisionProviderError("The school API key was rejected. Check SOCLAAS_API_KEY in .env.local.", "provider_error");
      if (err instanceof OpenAI.RateLimitError)
        throw new VisionProviderError("The photo reader is rate-limited right now. Try again in a minute.", "provider_error");
      if (err instanceof OpenAI.NotFoundError)
        throw new VisionProviderError(`The model "${this.model}" wasn't found. Run \`npm run vision:check\` to list available models.`, "provider_error");
      if (err instanceof OpenAI.BadRequestError)
        throw new VisionProviderError(
          `The model "${this.model}" rejected the image. It may not accept pictures. Run \`npm run vision:check\` and set SOCLAAS_MODEL to a vision model.`,
          "provider_error",
        );
      if (err instanceof OpenAI.APIConnectionError)
        throw new VisionProviderError("Couldn't reach the school API. Check your connection (it may require the NUS network or VPN).", "provider_error");
      if (err instanceof OpenAI.APIError) throw new VisionProviderError(`The photo reader returned an error (${err.status ?? "unknown"}).`, "provider_error");
      throw err;
    }
  }
}
