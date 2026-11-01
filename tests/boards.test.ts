import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardKey, groupBoards, judgeLabel, otherSize, scopeLabel } from "../src/lib/boards.ts";
import { modelsLabel, runLabels, systemName, targetDetail } from "../src/lib/naming.ts";
import { canRejudge, seasonProblem, type Season } from "../src/lib/seasons.ts";
import { sizeView, type RunResult, type SignedResult } from "../src/lib/types.ts";

const DIR = join(import.meta.dirname, "fixtures", "results", "runs");
const signed: SignedResult[] = readdirSync(DIR).map(
  (f) => JSON.parse(readFileSync(join(DIR, f), "utf8")).payload,
);
// Most tests look at the Top 30 listings, one board per scope.
const fixtures: RunResult[] = signed.map((r) => sizeView(r, "top30"));
// Fixtures are in "0-provisional"; "1" is current.
const seasons: Season[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "fixtures", "seasons.json"), "utf8"),
);
const clone = (r: RunResult, change: (r: RunResult) => void): RunResult => {
  const copy = structuredClone(r);
  change(copy);
  return copy;
};

describe("groupBoards", () => {
  it("ranks comparable runs on one board by accuracy", () => {
    const [board, ...rest] = groupBoards(fixtures);
    expect(rest).toEqual([]);
    expect(board!.slug).toBe("example-v1");
    const accuracies = board!.runIds.map(
      (id) => fixtures.find((r) => r.run_id === id)!.metrics.overall.accuracy,
    );
    expect(accuracies).toEqual([...accuracies].sort((a, b) => b - a));
    expect(scopeLabel(board!)).toBe("All 24 questions");
    expect(judgeLabel(board!.judge)).toBe("claude-sonnet-5-5, season 0-provisional");
  });

  it("lists every run once per result size, Top 30 first", () => {
    const views = signed.flatMap((r) => [sizeView(r, "top10"), sizeView(r, "top30")]);
    const boards = groupBoards(views);
    expect(boards.map((b) => [b.slug, b.size])).toEqual([
      ["example-v1", "top30"],
      ["example-v1-top10", "top10"],
    ]);
    expect(boards[1]!.runIds.every((id) => id.endsWith("-top10"))).toBe(true);
    expect(otherSize(boards, boards[0]!)).toBe(boards[1]);
    expect(otherSize(boards, boards[1]!)).toBe(boards[0]);
    // Each size ranks by its own accuracy.
    const accuracy = (id: string) => views.find((r) => r.run_id === id)!.metrics.overall.accuracy;
    const top10 = boards[1]!.runIds.map(accuracy);
    expect(top10).toEqual([...top10].sort((a, b) => b - a));
  });

  it("separates runs that cannot be compared: other budget, judge or questions", () => {
    const base = fixtures[0]!;
    const budget = clone(base, (r) => (r.config.budget_tokens = 4096));
    const judge = clone(base, (r) => {
      r.judge.official = false;
      r.judge.model = "gpt-6-sol";
    });
    const partial = clone(base, (r) => {
      r.dataset.conversation_ids = ["c2"];
      r.dataset.selection = { conversation_ids: ["c2"] };
      r.dataset.questions = 8;
    });
    const keys = new Set([base, budget, judge, partial].map(boardKey));
    expect(keys.size).toBe(4);
    const boards = groupBoards([base, budget, judge, partial]);
    expect(boards.map((b) => b.slug)).toEqual([
      "example-v1",
      "example-v1-budget-4096",
      "example-v1-gpt-6-sol",
      "example-v1-c2",
    ]);
    expect(scopeLabel(boards[3]!)).toBe("Conversation c2 (8 questions)");
    expect(judgeLabel(boards[2]!.judge)).toBe("gpt-6-sol (unofficial judge)");
  });

  it("gives older seasons their own slug and keeps the newest one plain", () => {
    const old = clone(fixtures[0]!, (r) => {
      r.judge.season = "0-provisional";
      r.finished_at = "2026-01-01T00:00:00Z";
    });
    const current = clone(fixtures[1]!, (r) => (r.judge.season = "1"));
    expect(groupBoards([old, current]).map((b) => b.slug)).toEqual([
      "example-v1",
      "example-v1-season-0-provisional",
    ]);
  });
});

describe("seasons", () => {
  const inSeason1 = (r: RunResult, from?: string) =>
    clone(r, (x) => {
      const id = r.signed_run_id;
      x.signed_run_id = `${id.slice(0, -6)}s1${id.slice(-4)}`;
      x.run_id = `${x.signed_run_id}-${r.size}`;
      x.judge.season = "1";
      x.rejudged_from = from ? { run_id: from, season: "0-provisional" } : null;
    });

  it("leads with an empty current season and lists earlier runs below it", () => {
    const [current, past, ...rest] = groupBoards(fixtures, seasons);
    expect(rest).toEqual([]);
    expect([current!.slug, current!.seasonStatus, current!.runIds]).toEqual([
      "example-v1",
      "current",
      [],
    ]);
    expect(current!.olderRunIds).toEqual(past!.runIds); // all of them, in rank order
    expect([past!.slug, past!.seasonStatus]).toEqual(["example-v1-season-0-provisional", "past"]);
    expect(judgeLabel(past!.judge, seasons)).toBe("claude-sonnet-5-5, Preview season");
  });

  it("ranks a re-judged run in the current season and drops it from the earlier list", () => {
    const orig = fixtures[0]!;
    const [current] = groupBoards([...fixtures, inSeason1(orig, orig.signed_run_id)], seasons);
    expect(current!.runIds).toHaveLength(1);
    expect(current!.olderRunIds).not.toContain(orig.run_id);
    expect(current!.olderRunIds).toHaveLength(fixtures.length - 1);
  });

  it("drops a run that needs a new run once its system has a current-season run", () => {
    const rerun = seasons.map((s) => (s.id === "1" ? { ...s, upgrade: "re-run" as const } : s));
    const alpha = fixtures.find((r) => r.connector.id === "example/alpha")!;
    const [current] = groupBoards([...fixtures, inSeason1(alpha)], rerun);
    const older = current!.olderRunIds.map((id) => fixtures.find((r) => r.run_id === id)!);
    expect(older.length).toBeGreaterThan(0);
    expect(older.every((r) => r.connector.id !== "example/alpha")).toBe(true);
  });

  it("can re-judge only from an earlier season with no re-run season after it", () => {
    expect(canRejudge(seasons, "0-provisional")).toBe(true);
    expect(canRejudge(seasons, "1")).toBe(false);
    expect(canRejudge(seasons, null)).toBe(false);
    const rerun = [...seasons, { ...seasons[1]!, id: "2", upgrade: "re-run" as const }];
    expect(canRejudge(rerun, "0-provisional")).toBe(false);
    expect(canRejudge(rerun, "1")).toBe(false);
  });

  it("flags a result whose judge differs from its season, and stops on an unknown season", () => {
    expect(seasonProblem(fixtures[0]!, seasons)).toBeNull();
    const effort = clone(fixtures[0]!, (r) => (r.judge.effort = "high"));
    expect(seasonProblem(effort, seasons)).toBe("effort high");
    const prompt = clone(fixtures[0]!, (r) => (r.judge.prompt_hash = "sha256:other"));
    expect(seasonProblem(prompt, seasons)).toBe("prompt v1");
    const unknown = clone(fixtures[0]!, (r) => (r.judge.season = "9"));
    expect(() => seasonProblem(unknown, seasons)).toThrow(/does not list/);
    const unofficial = clone(unknown, (r) => (r.judge.official = false));
    expect(seasonProblem(unofficial, seasons)).toBeNull();
  });
});

describe("names", () => {
  it("lists the distinct models a run used, or says the vendor chose them", () => {
    expect(modelsLabel({ decompose: "llm-a", select: "llm-a", embedding: "emb-a" })).toBe(
      "llm-a, emb-a",
    );
    expect(modelsLabel("vendor")).toBe("chosen by the vendor, not disclosed");
    expect(modelsLabel({})).toBe("");
    expect(modelsLabel(undefined)).toBe("");
  });

  it("shortens targets and labels runs by the settings that differ", () => {
    const alpha = fixtures.filter((r) => r.connector.id === "example/alpha");
    expect(systemName(alpha[0]!)).toBe("Alpha Memory");
    expect(targetDetail(alpha[0]!.connector.target)).toBe("hosted API, v2");
    const labels = runLabels(fixtures);
    expect(labels.get("20261001T120000Z-a11111-top30")).toBe("Alpha Memory, limit 30");
    expect(labels.get("20261001T130000Z-a22222-top30")).toBe("Alpha Memory, limit 10");
    expect(labels.get("20261001T140000Z-b33333-top30")).toBe("Beta Recall");
  });

  it("names a replay after the system it recorded", () => {
    const replay = clone(fixtures[0]!, (r) => {
      r.connector.id = "offline/replay";
      r.connector.target = "Replay of search results recorded from a memory system (offline)";
      r.connector.settings = { path: "/tmp/output.json", tool: "mem0", top_k: 30 };
    });
    expect(systemName(replay)).toBe("Mem0 (replayed)");
  });

  it("tells identical configurations apart by run id", () => {
    const twin = clone(fixtures[0]!, (r) => {
      r.signed_run_id = "20261002T000000Z-zzzzzz";
      r.run_id = `${r.signed_run_id}-top30`;
    });
    const labels = runLabels([fixtures[0]!, twin]);
    expect(labels.get(twin.run_id)).toBe("Alpha Memory (run zzzzzz)");
  });
});
