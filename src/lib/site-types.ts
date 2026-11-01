/** Shapes of the files `npm run data` writes for the pages and the browser. */
import type { Board } from "./boards.ts";
import type { QuestionInfo, Row } from "./questions.ts";
import type { Season } from "./seasons.ts";
import type { Metrics, RunResult, SizeKey } from "./types.ts";

/**
 * One listed run at one result size, as the pages see it (src/generated/site.json). `id` is
 * `<signed run id>-top10` or `-top30` (`result.signed_run_id` is the run's own id).
 */
export interface RunEntry {
  id: string;
  board: string;
  label: string;
  system: string;
  settings: string[];
  result: RunResult;
  keyId: string;
  /** What makes this run differ from a clean hosted run, shown wherever it appears. */
  notices: string[];
  /** Browser data, or null when the run's per-question file was not available. */
  dataFile: string | null;
  questionsFile: string | null;
  /** The signed file exactly as published. */
  signedFile: string;
}

export interface SiteData {
  generatedAt: string;
  /** Ids of the trusted signing keys. */
  keys: string[];
  /** Every season, oldest first (seasons.json). */
  seasons: Season[];
  currentSeason: string | null;
  boards: Board[];
  runs: Record<string, RunEntry>;
  skipped: { file: string; reason: string }[];
}

/** What the browser needs to show and compare a run (part of /data/runs/<id>.json). */
export interface RunSummary {
  id: string;
  label: string;
  system: string;
  board: string;
  boardTitle: string;
  size: SizeKey;
  connector: string;
  vendorMaintained: boolean;
  affiliated: boolean | null;
  affiliatedSystem: string | null;
  datasetHash: string;
  /** Equal for runs judged the same way (same season, or same unofficial judge and prompt). */
  judgeKey: string;
  judgeLabel: string;
  /** The models the run used (modelsLabel), or "" when none are recorded. */
  models: string;
  budget: number;
  finished: string;
  metrics: Metrics;
  runPage: string;
  questionsFile: string;
}

/** /data/runs/<id>.json */
export interface RunFile {
  summary: RunSummary;
  /** Contexts are in /data/ctx/<id>/<n>.json; row i is in chunk floor(i / chunkSize). */
  chunkSize: number;
  rows: Row[];
}

/** /data/questions/<dataset hash>.json: the question text, once per dataset version. */
export type QuestionsFile = Record<string, QuestionInfo>;

/** Small index of every listed run, embedded in the compare page for "Add a run". */
export interface RunIndexEntry {
  id: string;
  label: string;
  board: string;
  boardTitle: string;
  accuracy: number;
}
