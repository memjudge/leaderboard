/**
 * The questions of one to four runs, lined up by question id, and the filters the
 * quilt and the question list share.
 */
import { FLAG_GOLD_SUSPECT, type QuestionInfo, type Row, type Verdict } from "../lib/questions.ts";
import type { QuestionsFile, RunFile, RunSummary } from "../lib/site-types.ts";
import { naturalCompare } from "../lib/stats.ts";
import { fetchJson } from "./dom.ts";

export interface ViewRun {
  summary: RunSummary;
  rows: Map<string, Row>;
  /** Row position of each question, for finding its context chunk. */
  position: Map<string, number>;
  chunkSize: number;
}

export interface Item {
  id: string;
  info: QuestionInfo;
  /** Per run, in the order the runs were given; undefined if the run lacks the question. */
  rows: (Row | undefined)[];
  verdicts: Verdict[];
  flagged: boolean;
  search: string;
}

export async function loadRuns(
  ids: string[],
): Promise<{ runs: ViewRun[]; questions: QuestionsFile }> {
  const files = await Promise.all(ids.map((id) => fetchJson<RunFile>(`/data/runs/${id}.json`)));
  const questionFiles = await Promise.all(
    [...new Set(files.map((f) => f.summary.questionsFile))].map((url) =>
      fetchJson<QuestionsFile>(url),
    ),
  );
  const runs = files.map((f) => ({
    summary: f.summary,
    rows: new Map(f.rows.map((r) => [r[0], r])),
    position: new Map(f.rows.map((r, i) => [r[0], i])),
    chunkSize: f.chunkSize,
  }));
  return { runs, questions: Object.assign({}, ...questionFiles) as QuestionsFile };
}

/** Questions every run answered (all of them for comparable runs), by category then id. */
export function buildItems(runs: ViewRun[], questions: QuestionsFile): Item[] {
  const [first, ...rest] = runs;
  if (!first) return [];
  const ids = [...first.rows.keys()].filter((id) => rest.every((r) => r.rows.has(id)));
  const items = ids
    .map((id): Item | null => {
      const info = questions[id];
      if (!info) return null;
      const rows = runs.map((r) => r.rows.get(id));
      return {
        id,
        info,
        rows,
        verdicts: rows.map((row) => row?.[1] ?? null),
        flagged: rows.some((row) => ((row?.[2] ?? 0) & FLAG_GOLD_SUSPECT) !== 0),
        search: [id, info[3], info[4], ...rows.map((row) => row?.[5] ?? "")]
          .join(" ")
          .toLowerCase(),
      };
    })
    .filter((item): item is Item => item !== null);
  return items.sort((a, b) => a.info[1].localeCompare(b.info[1]) || naturalCompare(a.id, b.id));
}

export interface Filter {
  outcome: string;
  category: string;
  search: string;
}

/** Outcome choices; `beat:i:j` (run i correct, run j not) comes from the head-to-head counts. */
export function outcomeOptions(runs: number): [string, string][] {
  if (runs === 1) {
    return [
      ["all", "All questions"],
      ["correct", "Judged correct"],
      ["incorrect", "Judged incorrect"],
      ["none", "No verdict (call failed)"],
      ["flagged", "Flagged by the judge"],
    ];
  }
  return [
    ["all", "All questions"],
    ["disagree", "Runs disagree"],
    ["correct", "All runs correct"],
    ["incorrect", "No run correct"],
    ["none", "Any run without a verdict"],
    ["flagged", "Flagged by the judge"],
  ];
}

export function matches(item: Item, filter: Filter): boolean {
  if (filter.category && item.info[1] !== filter.category) return false;
  if (filter.search && !item.search.includes(filter.search.toLowerCase().trim())) return false;
  const v = item.verdicts;
  switch (filter.outcome) {
    case "correct":
      return v.every((x) => x === 1);
    case "incorrect":
      return v.every((x) => x !== 1);
    case "none":
      return v.some((x) => x === null);
    case "flagged":
      return item.flagged;
    case "disagree":
      return v.some((x) => x === 1) && v.some((x) => x !== 1);
    default: {
      const beat = /^beat:(\d):(\d)$/.exec(filter.outcome);
      if (beat) return v[Number(beat[1])] === 1 && v[Number(beat[2])] !== 1;
      return true;
    }
  }
}
