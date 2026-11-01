/**
 * Seasons: one fixed set of judging rules each (memjudge ADR 0015). `seasons.json` is a copy
 * of memjudge's `src/memjudge/judge/seasons.json`; the last entry is the current season.
 */
import type { SignedResult } from "./types.ts";

export interface SeasonJudge {
  routes: Record<string, string>;
  default_route: string;
  effort: string | null;
  max_output_tokens: number;
  prompt_version: string;
  prompt_hash: string;
}

export interface Season {
  id: string;
  name: string;
  /** YYYY-MM-DD */
  started: string;
  provisional: boolean;
  summary: string;
  details: string | null;
  /** How earlier seasons' runs get into this one: judged again, or a new run. */
  upgrade: "re-judge" | "re-run";
  judge: SeasonJudge;
}

export function currentSeason(seasons: Season[]): Season | undefined {
  return seasons.at(-1);
}

export function seasonById(seasons: Season[], id: string | null): Season | undefined {
  return seasons.find((s) => s.id === id);
}

/** "Season 1" for a known season, else the raw id. */
export function seasonName(seasons: Season[], id: string | null): string {
  return seasonById(seasons, id)?.name ?? `season ${id ?? "none"}`;
}

/**
 * Whether a run judged in season `id` can be judged again into the current season: it is an
 * earlier season and every season after it allows re-judging stored contexts.
 */
export function canRejudge(seasons: Season[], id: string | null): boolean {
  const i = seasons.findIndex((s) => s.id === id);
  if (i < 0 || i === seasons.length - 1) return false;
  return seasons.slice(i + 1).every((s) => s.upgrade === "re-judge");
}

/** The judge spec a result ran, as seasons list them ("route:model" or "...@provider"). */
function judgeSpec(r: Pick<SignedResult, "judge">): string {
  const j = r.judge;
  return `${j.route}:${j.model}${j.upstream_provider ? `@${j.upstream_provider}` : ""}`;
}

/**
 * Why an official result does not fit its season, or null. Throws for a season missing from
 * `seasons`: the copy of seasons.json is out of date, and the build must not go on.
 */
export function seasonProblem(
  r: Pick<SignedResult, "run_id" | "judge">,
  seasons: Season[],
): string | null {
  if (!r.judge.official) return null;
  const season = seasonById(seasons, r.judge.season);
  if (!season) {
    throw new Error(
      `run ${r.run_id} names season ${r.judge.season}, which seasons.json does not list: ` +
        "copy memjudge's src/memjudge/judge/seasons.json into the leaderboard",
    );
  }
  const s = season.judge;
  if (!Object.values(s.routes).includes(judgeSpec(r))) return `judge ${judgeSpec(r)}`;
  if (r.judge.effort !== s.effort) return `effort ${r.judge.effort}`;
  if (r.judge.max_output_tokens !== s.max_output_tokens) return "judge output limit";
  if (r.judge.prompt_hash !== s.prompt_hash) return `prompt ${r.judge.prompt_version}`;
  return null;
}
