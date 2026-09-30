/**
 * Server-side vision adapter. Providers are selected by environment variables and
 * never run in the browser. Add a provider by implementing `VisionProvider` and
 * registering it in `getVisionProvider`.
 */
import "server-only";
import { AnthropicVisionProvider } from "./anthropic";
import type { VisionProvider } from "./types";

export { VisionProviderError, type VisionInput, type VisionProvider } from "./types";

export function getVisionProvider(env: NodeJS.ProcessEnv = process.env): VisionProvider | null {
  const provider = (env.VISION_PROVIDER || "anthropic").toLowerCase();
  if (provider === "anthropic") {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return new AnthropicVisionProvider(key, env.VISION_MODEL || "claude-opus-5-5");
  }
  return null;
}
