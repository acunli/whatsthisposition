import type { Recognition } from "./grid";

export interface VisionInput {
  /** Raw image bytes (JPEG, PNG or WebP). Held in memory only for this request. */
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
}

export interface VisionProvider {
  readonly name: string;
  readonly model: string;
  recognize(input: VisionInput, signal?: AbortSignal): Promise<Recognition>;
}

export class VisionProviderError extends Error {
  constructor(
    message: string,
    readonly code: "provider_error" | "invalid_output" | "unreadable",
  ) {
    super(message);
  }
}
