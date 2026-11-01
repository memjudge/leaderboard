/**
 * A board is a set of runs that can be ranked against each other: same dataset version
 * and hash, same questions, same judge (season), same token budget and same result size
 * (Top 10 or Top 30, memjudge ADR 0018). Every run is listed on one board per size.
 *
 * With seasons, each dataset scope's current-season board is its default (even before any
 * run is in it), and also lists the official runs of earlier seasons that are not in the
 * current season yet, unranked (`olderRunIds`). Past seasons keep their own boards.
 */
import { datasetTitle } from "./naming.ts";
import { canRejudge, currentSeason, seasonName, type Season } from "./seasons.ts";
import { naturalCompare } from "./stats.ts";
import type { RunResult, SizeKey } from "./types.ts";

export const DEFAULT_BUDGET = 8192;
const DATASET_ORDER = ["locomo", "longmemeval-s", "longmemeval-oracle"];

export interface BoardJudge {
  official: boolean;
  season: string | null;
  route: string;
  model: string;
  effort: string | null;
  promptVersion: string;
  promptHash: string;
}

export interface Board {
  slug: string;
  title: string;
  dataset: { name: string; version: string; hash: string; license: string; questions: number };
  /** Conversations run, or null for all of them. */
  conversations: string[] | null;
  /** Categories run, or empty for all of them. */
  categories: string[];
  judge: BoardJudge;
  budget: number;
  size: SizeKey;
  /** Ranked: accuracy, then fewer tokens, then the earlier run. */
  runIds: string[];
  /** Current-season board only: earlier seasons' runs not in this season yet (unranked). */
  olderRunIds: string[];
  /** Whether an official board is the current season's; null when unofficial or no seasons. */
  seasonStatus: "current" | "past" | null;
  updated: string;
}

/** Everything that makes runs rankable together except the judge. */
export function scopeKey(b: Board): string {
  const d = b.dataset;
  const categories = b.categories.length ? b.categories : ["*"];
  return [
    d.name,
    d.version,
    d.hash,
    (b.conversations ?? ["*"]).join(","),
    categories,
    b.budget,
    b.size,
  ]
    .flat()
    .join("|");
}

export function boardKey(r: RunResult): string {
  const d = r.dataset;
  const conversations = d.conversation_ids ? [...d.conversation_ids].sort(naturalCompare) : ["*"];
  const categories = d.selection?.categories?.length ? [...d.selection.categories].sort() : ["*"];
  return [
    d.name,
    d.version,
    d.hash,
    conversations.join(","),
    categories.join(","),
    judgeKey(r),
    r.config.budget_tokens,
    r.size,
  ].join("|");
}

/** Equal for runs judged the same way: same season, or same unofficial judge and prompt. */
export function judgeKey(r: RunResult): string {
  const j = r.judge;
  return j.official && j.season
    ? `season:${j.season}`
    : `${j.route}:${j.model}:${j.effort ?? ""}:${j.prompt_hash}`;
}

export function rankRuns(a: RunResult, b: RunResult): number {
  return (
    b.metrics.overall.accuracy - a.metrics.overall.accuracy ||
    a.metrics.overall.context_tokens_mean - b.metrics.overall.context_tokens_mean ||
    a.finished_at.localeCompare(b.finished_at)
  );
}

export function groupBoards(results: RunResult[], seasons: Season[] = []): Board[] {
  const groups = new Map<string, RunResult[]>();
  for (const r of results) {
    const key = boardKey(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const boards = [...groups.values()].map((runs) => makeBoard(runs.sort(rankRuns)));
  const current = currentSeason(seasons);
  if (current) addSeasons(boards, results, seasons, current);
  boards.sort(compareBoards);
  assignSlugs(boards, current ? currentSeasons(boards, current) : latestSeasons(results));
  return boards;
}

function addSeasons(boards: Board[], results: RunResult[], seasons: Season[], current: Season) {
  const byId = new Map(results.map((r) => [r.run_id, r]));
  // Re-judges name the signed run, which is listed once per size.
  const rejudged = new Set(
    results.flatMap((r) => (r.rejudged_from ? [r.rejudged_from.run_id] : [])),
  );
  const official = boards.filter((b) => b.judge.official && b.judge.season);
  for (const b of official) b.seasonStatus = b.judge.season === current.id ? "current" : "past";
  for (const key of new Set(official.map(scopeKey))) {
    const scope = official.filter((b) => scopeKey(b) === key);
    let head = scope.find((b) => b.seasonStatus === "current");
    if (!head) {
      head = emptyBoard(scope[0]!, current);
      boards.push(head);
    }
    const connectors = new Set(head.runIds.map((id) => byId.get(id)!.connector.id));
    head.olderRunIds = scope
      .filter((b) => b.seasonStatus === "past")
      .flatMap((b) => b.runIds.map((id) => byId.get(id)!))
      .filter((r) => {
        if (rejudged.has(r.signed_run_id)) return false;
        // A run that cannot be re-judged leaves once its system has a current-season run.
        return canRejudge(seasons, r.judge.season) || !connectors.has(r.connector.id);
      })
      .sort(rankRuns)
      .map((r) => r.run_id);
  }
}

/** The current season's board for a scope that has no run in it yet. */
function emptyBoard(from: Board, season: Season): Board {
  const route = season.judge.default_route;
  const [, model = ""] = (season.judge.routes[route] ?? "").split(":");
  return {
    ...from,
    judge: {
      official: true,
      season: season.id,
      route,
      model,
      effort: season.judge.effort,
      promptVersion: season.judge.prompt_version,
      promptHash: season.judge.prompt_hash,
    },
    runIds: [],
    olderRunIds: [],
    seasonStatus: "current",
  };
}

/** Every dataset version's default season is the current one, even if it has no runs yet. */
function currentSeasons(boards: Board[], current: Season): Map<string, string> {
  return new Map(boards.map((b) => [`${b.dataset.name}@${b.dataset.version}`, current.id]));
}

function makeBoard(runs: RunResult[]): Board {
  const first = runs[0]!;
  const d = first.dataset;
  const j = first.judge;
  return {
    slug: "",
    title: datasetTitle(d.name, d.version),
    dataset: {
      name: d.name,
      version: d.version,
      hash: d.hash,
      license: d.license,
      questions: d.questions,
    },
    conversations: d.conversation_ids ? [...d.conversation_ids].sort(naturalCompare) : null,
    categories: d.selection?.categories?.length ? [...d.selection.categories].sort() : [],
    judge: {
      official: j.official,
      season: j.season,
      route: j.route,
      model: j.model,
      effort: j.effort,
      promptVersion: j.prompt_version,
      promptHash: j.prompt_hash,
    },
    budget: first.config.budget_tokens,
    size: first.size,
    runIds: runs.map((r) => r.run_id),
    olderRunIds: [],
    seasonStatus: null,
    updated: runs
      .map((r) => r.finished_at)
      .sort()
      .at(-1)!,
  };
}

function compareBoards(a: Board, b: Board): number {
  const order = (name: string) => {
    const i = DATASET_ORDER.indexOf(name);
    return i === -1 ? DATASET_ORDER.length : i;
  };
  return (
    order(a.dataset.name) - order(b.dataset.name) ||
    a.dataset.name.localeCompare(b.dataset.name) ||
    // Top 30 first: it is each dataset's default board, as before there were two sizes.
    Number(a.size === "top10") - Number(b.size === "top10") ||
    Number(a.conversations !== null) - Number(b.conversations !== null) ||
    Number(b.judge.official) - Number(a.judge.official) ||
    Number(b.seasonStatus === "current") - Number(a.seasonStatus === "current") ||
    b.dataset.questions - a.dataset.questions ||
    b.runIds.length - a.runIds.length ||
    b.updated.localeCompare(a.updated)
  );
}

/** The newest official season per dataset version: the default, so it needs no slug suffix. */
function latestSeasons(results: RunResult[]): Map<string, string> {
  const latest = new Map<string, RunResult>();
  for (const r of results) {
    if (!r.judge.official || !r.judge.season) continue;
    const key = `${r.dataset.name}@${r.dataset.version}`;
    const current = latest.get(key);
    if (!current || r.finished_at > current.finished_at) latest.set(key, r);
  }
  return new Map([...latest].map(([key, r]) => [key, r.judge.season!]));
}

function assignSlugs(boards: Board[], seasons: Map<string, string>): void {
  const used = new Set<string>();
  for (const b of boards) {
    const parts = [b.dataset.name, b.dataset.version];
    if (b.conversations) {
      parts.push(
        b.conversations.length <= 3
          ? b.conversations.join("-")
          : `${b.conversations.length}-conversations`,
      );
    }
    parts.push(...b.categories);
    if (!b.judge.official) parts.push(b.judge.model);
    else if (b.judge.season !== seasons.get(`${b.dataset.name}@${b.dataset.version}`)) {
      parts.push(`season-${b.judge.season ?? "none"}`);
    }
    if (b.budget !== DEFAULT_BUDGET) parts.push(`budget-${b.budget}`);
    if (b.size === "top10") parts.push("top10");
    const base = parts
      .join("-")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    let slug = base;
    for (let i = 2; used.has(slug); i++) slug = `${base}-${i}`;
    used.add(slug);
    b.slug = slug;
  }
}

/** "All 1,986 questions", "Conversation conv-48 (239 questions)", "4 conversations (…)". */
export function scopeLabel(b: Board): string {
  const questions = `${b.dataset.questions.toLocaleString("en-GB")} questions`;
  const categories = b.categories.length ? `, ${b.categories.join(", ")} only` : "";
  if (!b.conversations) return `All ${questions}${categories}`;
  const which =
    b.conversations.length === 1
      ? `Conversation ${b.conversations[0]}`
      : `${b.conversations.length} conversations`;
  return `${which} (${questions}${categories})`;
}

/** The board with the same runs at the other result size, if there is one. */
export function otherSize(boards: Board[], b: Board): Board | undefined {
  const size: SizeKey = b.size === "top10" ? "top30" : "top10";
  const key = scopeKey({ ...b, size });
  return boards.find(
    (x) =>
      scopeKey(x) === key &&
      x.judge.official === b.judge.official &&
      x.judge.season === b.judge.season &&
      x.judge.model === b.judge.model &&
      x.judge.promptHash === b.judge.promptHash,
  );
}

export function judgeLabel(j: BoardJudge, seasons: Season[] = []): string {
  if (!j.official) return `${j.model} (unofficial judge)`;
  return `${j.model}, ${seasons.length ? seasonName(seasons, j.season) : `season ${j.season}`}`;
}
