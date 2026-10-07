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

let lines: EngineClient | null = null;

/**
 * A second engine just for the live "top lines" panel next to the board, so those
 * searches never wait behind (or slow down) the explanations on the page engine.
 */
export function getLinesEngine(): EngineClient {
  if (lines && !lines.error) return lines;
  lines?.terminate();
  try {
    lines = new EngineClient(createWorkerTransport("/engine/stockfish.js"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "The engine could not start.";
    throw new EngineError(msg);
  }
  return lines;
}
