/** Build-time access to src/generated/site.json, written by `npm run data`. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Board } from "./boards.ts";
import type { RunEntry, SiteData } from "./site-types.ts";

let cached: SiteData | undefined;

export function getSite(): SiteData {
  if (cached && !import.meta.env.DEV) return cached;
  const path = join(process.cwd(), "src", "generated", "site.json");
  if (!existsSync(path)) {
    throw new Error("src/generated/site.json is missing: run `npm run data` first.");
  }
  cached = JSON.parse(readFileSync(path, "utf8")) as SiteData;
  return cached;
}

export function boardRuns(site: SiteData, board: Board): RunEntry[] {
  return board.runIds.map((id) => site.runs[id]!);
}

export function boardBySlug(site: SiteData, slug: string): Board {
  const board = site.boards.find((b) => b.slug === slug);
  if (!board) throw new Error(`unknown board ${slug}`);
  return board;
}
