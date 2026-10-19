import "server-only";

/**
 * The reviewed games behind /games, read from content/games/*.json when the site is built
 * (the pages are static). The daily job (src/lib/content/publish.test.ts) adds the files.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GameRecord } from "../content/games";

const DIR = join(process.cwd(), "content/games");

let all: GameRecord[] | null = null;

/** Every reviewed game, the most recently played first. */
export function allGames(): GameRecord[] {
  if (all) return all;
  all = existsSync(DIR)
    ? readdirSync(DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as GameRecord)
        .filter((g) => g.v === 1)
        .sort((a, b) => (b.played ?? b.published).localeCompare(a.played ?? a.published) || a.slug.localeCompare(b.slug))
    : [];
  return all;
}

export const gameBySlug = (slug: string): GameRecord | null => allGames().find((g) => g.slug === slug) ?? null;
