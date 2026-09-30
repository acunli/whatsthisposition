/**
 * Server-side vision adapter. Providers are selected by environment variables and
 * never run in the browser. Add a provider by implementing `VisionProvider` and
 * registering it in `getVisionProvider`.
 *
 * VISION_PROVIDER=soclaas    → OpenAI-compatible NUS SoCLaaS gateway (SOCLAAS_* vars)
 * VISION_PROVIDER=anthropic  → Anthropic Messages API (ANTHROPIC_API_KEY)
 * unset                      → whichever of the two has a key (SoCLaaS first)
 */
import "server-only";
import { AnthropicVisionProvider } from "./anthropic";
import { OpenAICompatibleVisionProvider } from "./openaiCompatible";
import type { VisionProvider } from "./types";

export { VisionProviderError, type VisionInput, type VisionProvider } from "./types";

export function getVisionProvider(env: NodeJS.ProcessEnv = process.env): VisionProvider | null {
  const choice = (env.VISION_PROVIDER || (env.SOCLAAS_API_KEY ? "soclaas" : env.ANTHROPIC_API_KEY ? "anthropic" : "")).toLowerCase();
  if (choice === "soclaas" || choice === "openai-compatible") {
    const apiKey = env.SOCLAAS_API_KEY;
    if (!apiKey) return null;
    return new OpenAICompatibleVisionProvider({
      name: "soclaas",
      baseURL: env.SOCLAAS_BASE_URL || "https://soclaas-api.comp.nus.edu.sg/v1",
      apiKey,
      model: env.SOCLAAS_MODEL || "default",
    });
  }
  if (choice === "anthropic") {
    const key = env.ANTHROPIC_API_KEY;
    if (!key) return null;
    return new AnthropicVisionProvider(key, env.VISION_MODEL || "claude-opus-5-5");
  }
  return null;
}
