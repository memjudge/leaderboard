/**
 * The signed result format, mirroring memjudge's `schemas/result.v1.json`.
 * The JSON Schema is the source of truth; these types describe what the site reads.
 */

export interface Rate {
  n: number;
  value: number | null;
}

export interface CategoryMetrics {
  questions: number;
  correct: number;
  accuracy: number;
  accuracy_ci95: [number, number];
  context_tokens_mean: number;
  context_tokens_p95: number;
  efficiency: number | null;
  retrieval_latency_p50_s: number | null;
  retrieval_latency_p95_s: number | null;
  abstention_accuracy: Rate;
  stale_fact_rate: Rate;
  evidence_recall: Rate;
  truncation_rate: number;
  flagged: number;
  errors: number;
}

export interface Ingestion {
  conversations: number;
  sessions: number;
  turns: number;
  total_s: number;
  per_turn_s: number | null;
  per_session_p50_s: number | null;
  per_session_p95_s: number | null;
  api_calls: number;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Absent from older results, which are per-session (ADR 0017). */
  mode?: "per-session" | "batch";
}

/** USD. `null` means the system did not report it (never estimated). */
export interface Cost {
  ingestion_usd: number | null;
  retrieval_usd: number | null;
  judge_usd: number | null;
  total_usd: number | null;
  per_1k_questions_usd: number | null;
  ingestion_credits: number | null;
  retrieval_credits: number | null;
  judge_cost_source: string;
}

export interface Metrics {
  overall: CategoryMetrics;
  by_category: Record<string, CategoryMetrics>;
  ingestion: Ingestion;
  cost: Cost;
  error_rate: Rate;
  flagged_question_ids: string[];
}

export interface Selection {
  conversation_ids?: string[];
  categories?: string[];
  smallest?: number | null;
  sample?: number | null;
  seed?: number;
}

export interface DatasetInfo {
  name: string;
  version: string;
  hash: string;
  curated: boolean;
  license: string;
  upstream_sha256: string | null;
  errata_applied: number;
  selection?: Selection | null;
  conversation_ids?: string[] | null;
  questions: number;
}

export interface ConnectorInfo {
  id: string;
  code_hash: string;
  target: string;
  label: string;
  sdk: string | null;
  settings: Record<string, unknown>;
  /** Settings that name the models the system ran, or "vendor" when undisclosed. */
  models?: Record<string, unknown> | "vendor";
  endpoint?: string | null;
  custom_endpoint?: boolean;
}

export interface JudgeInfo {
  route: string;
  model: string;
  upstream_provider: string | null;
  effort: string | null;
  max_output_tokens: number;
  prompt_version: string;
  prompt_hash: string;
  served_by: string[];
  official: boolean;
  season: string | null;
}

export interface Artifact {
  name: string;
  sha256: string;
  url?: string | null;
}

/** The two result sizes every run scores (memjudge ADR 0018). */
export type SizeKey = "top10" | "top30";
export const SIZES: readonly SizeKey[] = ["top10", "top30"];
export const sizeLabel = (size: SizeKey): string => (size === "top10" ? "Top 10" : "Top 30");

/** A signed result as published: one run, scored at both result sizes. */
export interface SignedResult {
  schema_version: "1";
  run_id: string;
  mode: "local" | "hosted";
  started_at: string;
  finished_at: string;
  tool: { version: string; commit: string | null; image_digest?: string | null };
  dataset: DatasetInfo;
  connector: ConnectorInfo;
  judge: JudgeInfo;
  config: {
    budget_tokens: number;
    tokenizer: string;
    concurrency: number;
    judge_concurrency: number;
  };
  metrics: Record<SizeKey, Metrics>;
  price_table_version: string;
  artifacts: Artifact[];
  affiliation: { affiliated: boolean | null; system?: string | null };
  reused_ingestion?: { run_id: string; connector_code_hash: string } | null;
  /** Set when this result judged an earlier run's stored contexts again (a re-judge). */
  rejudged_from?: { run_id: string; season: string | null } | null;
  resumes?: number;
  /** Hosted runs: each stop (with the cause the runner set) and resume, oldest first. */
  history?: RunEvent[];
  key_id?: string | null;
}

export type StopCause = "submitter" | "retrieval" | "judge" | "crash" | "runner";

export interface RunEvent {
  at: string;
  event: "stopped" | "resumed";
  cause?: StopCause | null;
}

/**
 * One result size of a signed run, as the site lists it. `run_id` is the listing's id,
 * `<signed run id>-top10` or `-top30`; `signed_run_id` is the run's own id.
 */
export interface RunResult extends Omit<SignedResult, "metrics"> {
  metrics: Metrics;
  size: SizeKey;
  signed_run_id: string;
}

/** The listing of `signed` at `size`. */
export function sizeView(signed: SignedResult, size: SizeKey): RunResult {
  return {
    ...signed,
    run_id: `${signed.run_id}-${size}`,
    metrics: signed.metrics[size],
    size,
    signed_run_id: signed.run_id,
  };
}

export interface SignedEnvelope {
  payload: SignedResult;
  signature: { alg: string; key_id: string; value: string };
}
