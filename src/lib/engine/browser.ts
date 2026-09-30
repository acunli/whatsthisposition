"use client";

import { EngineClient, EngineError, createWorkerTransport } from "./client";

let instance: EngineClient | null = null;

/** One engine per tab. Recreated automatically after a failure. */
export function getBrowserEngine(): EngineClient {
  if (instance && !instance.error) return instance;
  instance?.terminate();
  try {
    instance = new EngineClient(createWorkerTransport("/engine/stockfish.js"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The engine could not start.";
    throw new EngineError(msg);
  }
  return instance;
}

export function resetBrowserEngine(): EngineClient {
  if (instance) {
    try {
      instance.terminate();
    } catch {
      /* already gone */
    }
  }
  instance = null;
  return getBrowserEngine();
}
