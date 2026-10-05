/**
 * Loads the square classifiers once per page: two small models trained with
 * different seeds and augmentations, averaged (about 430 KB each, cached by the browser).
 */
import { parseNet, type SquareNet } from "./net";

export const MODEL_URLS = ["/models/squares-a.bin", "/models/squares-b.bin"];

let cached: Promise<SquareNet[]> | null = null;

export function loadSquareNets(): Promise<SquareNet[]> {
  if (!cached) {
    cached = Promise.all(
      MODEL_URLS.map((url) =>
        fetch(url)
          .then((r) => {
            if (!r.ok) throw new Error(`The board reader's model didn't load (${r.status}).`);
            return r.arrayBuffer();
          })
          .then(parseNet),
      ),
    );
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}
