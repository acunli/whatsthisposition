import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CELL_VALUES, recognitionSchema, type Recognition } from "./grid";
import { VisionProviderError, type VisionInput, type VisionProvider } from "./types";

const SYSTEM = `You read chess positions from photos and screenshots of chessboards.

Report exactly what is on each of the 64 squares, as the board appears in the image:
- "rows" has 8 rows ordered from the TOP edge of the board in the image to the BOTTOM edge.
- Each row has 8 cells ordered from the LEFT edge of the board in the image to the RIGHT edge.
- Do not rotate or re-orient the board, even if coordinates are printed on it; the player tells us the orientation separately.

Each cell has:
- "piece": "" for an empty square, uppercase KQRBNP for White pieces, lowercase kqrbnp for Black pieces.
- "confident": false when the square is occluded, blurry, cut off, or when the piece type or colour is ambiguous (for example, bishop vs pawn, or a dark piece on a dark square). Prefer marking false over guessing silently.

Never infer whose turn it is, castling rights, or move history.
If the image does not show a chessboard, or the board is too cropped or distorted to read all 64 squares, set "board_found" to false, fill all cells with empty non-confident values, and explain what is wrong in "notes" in one sentence addressed to the player (for example "The left two files are cut off; retake the photo with the whole board in frame.").
Otherwise use "notes" for at most one short sentence about anything the player should double-check, or leave it empty.`;

const cell = {
  type: "object",
  additionalProperties: false,
  required: ["piece", "confident"],
  properties: {
    piece: { type: "string", enum: [...CELL_VALUES] },
    confident: { type: "boolean" },
  },
};

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["board_found", "notes", "rows"],
  properties: {
    board_found: { type: "boolean" },
    notes: { type: "string" },
    rows: { type: "array", items: { type: "array", items: cell } },
  },
};

export class AnthropicVisionProvider implements VisionProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
  ) {
    this.client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  }

  async recognize(input: VisionInput, signal?: AbortSignal): Promise<Recognition> {
    let response;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.model,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: SYSTEM,
          output_config: { effort: "high", format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: input.mediaType, data: input.data.toString("base64") } },
                { type: "text", text: "Read this chessboard square by square." },
              ],
            },
          ],
        },
        { signal },
      );
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
        throw new VisionProviderError("The server's vision API key was rejected. Check ANTHROPIC_API_KEY.", "provider_error");
      if (err instanceof Anthropic.RateLimitError)
        throw new VisionProviderError("The recognition service is busy right now. Try again in a minute.", "provider_error");
      if (err instanceof Anthropic.BadRequestError)
        throw new VisionProviderError("The recognition service couldn't accept this image. Try a smaller JPEG or PNG.", "provider_error");
      if (err instanceof Anthropic.APIConnectionError)
        throw new VisionProviderError("Couldn't reach the recognition service. Check the server's network connection.", "provider_error");
      if (err instanceof Anthropic.APIError)
        throw new VisionProviderError(`The recognition service returned an error (${err.status ?? "unknown"}).`, "provider_error");
      throw err;
    }

    if (response.stop_reason === "refusal") {
      throw new VisionProviderError("The recognition service declined this image. Try a different photo.", "unreadable");
    }
    if (response.stop_reason === "max_tokens") {
      throw new VisionProviderError("The recognition result was cut off. Please try again.", "invalid_output");
    }
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new VisionProviderError("The recognition result wasn't readable. Please try again.", "invalid_output");
    }
    const result = recognitionSchema.safeParse(parsed);
    if (!result.success) {
      throw new VisionProviderError("The recognition result didn't describe a full 8×8 board. Please try again.", "invalid_output");
    }
    return result.data;
  }
}
