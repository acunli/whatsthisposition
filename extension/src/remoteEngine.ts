/**
 * Engines for the review card, running in the hidden engine page (see engine.ts): the
 * same `Searcher` functions the review code takes, sent over a runtime port.
 */
import type { Searcher } from "@/lib/deep/deep";
import type { EngineLine } from "@/lib/engine/client";
import type { EnginePool } from "@/lib/engine/pool";

export async function remoteEnginePool(): Promise<EnginePool> {
  const opened = (await chrome.runtime.sendMessage({ type: "wtp:engine-open" })) as { ok?: boolean; error?: string } | undefined;
  if (!opened?.ok) throw new Error(opened?.error ?? "The engine page couldn't open.");
  const port = chrome.runtime.connect({ name: "wtp-engine" });
  const pending = new Map<number, { resolve: (l: EngineLine[]) => void; reject: (e: Error) => void }>();
  let next = 0;
  let gone = false;
  const size = new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("The engine page didn't answer.")), 15000);
    port.onMessage.addListener((m: { type?: string; size?: number; id?: number; lines?: EngineLine[]; error?: string }) => {
      if (m?.type === "size") {
        clearTimeout(t);
        resolve(m.size ?? 1);
      } else if (m?.type === "result" && typeof m.id === "number") {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p?.reject(new Error(m.error));
        else p?.resolve(m.lines ?? []);
      }
    });
    port.onDisconnect.addListener(() => {
      gone = true;
      clearTimeout(t);
      reject(new Error("The engine stopped."));
      for (const p of pending.values()) p.reject(new Error("The engine stopped."));
      pending.clear();
    });
  });
  const n = await size;
  const searchers: Searcher[] = Array.from(
    { length: n },
    (_, k): Searcher =>
      (req) =>
        new Promise<EngineLine[]>((resolve, reject) => {
          if (gone) return reject(new Error("The engine stopped."));
          const id = next++;
          pending.set(id, { resolve, reject });
          port.postMessage({ type: "search", id, k, req });
        }),
  );
  return { searchers, size: n, dispose: () => port.disconnect() };
}
