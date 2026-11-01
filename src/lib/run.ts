/**
 * The /run page's pure logic: the Runner API's shapes, what the page sends, and how it
 * describes a run. The page itself is src/client/run.ts.
 */
import { TERMS_UPDATED } from "./legal.ts";

export interface DatasetOption {
  name: string;
  label: string;
  hash: string;
  license: string | null;
  conversations: number;
  questions: number;
}

export interface ConnectorOption {
  id: string;
  target: string;
  label: string;
  required_keys: string[];
  allowed_domains: string[];
  /** Named settings a run must pick from; empty when the connector has none. */
  presets?: string[];
  /** The models a run uses with each preset ("" without presets), or "vendor". */
  models?: Record<string, Record<string, unknown>> | "vendor";
}

export interface RouteOption {
  route: string;
  spec: string;
  key_name: string;
}

export interface Estimate {
  questions: number;
  judge_cost_usd_typical: number | null;
  judge_cost_usd_upper_bound: number | null;
}

export interface RunnerOptions {
  budget_tokens: number;
  judge_season: string;
  datasets: DatasetOption[];
  connectors: ConnectorOption[];
  judge_routes: RouteOption[];
  estimates: Record<string, Record<string, Estimate>>;
  /** Makers a submitter can name as affiliated; any other is sent without a name. */
  affiliations: string[];
  /** The live runner: its release, and the commit and image it was deployed from. */
  runner: { version: string; commit: string | null; image_digest: string | null };
}

export type RunState =
  "starting" | "retrieving" | "judging" | "publishing" | "done" | "stopped" | "failed";

export interface RunStatus {
  run_id: string;
  dataset: string;
  connector: string;
  preset?: string | null;
  judge_route: string;
  state: RunState;
  /** Questions answered while retrieving, then questions judged. */
  done: number;
  total: number;
  ingested: number;
  ingest_total: number;
  /** Turns while a batch ingestion runs, else sessions. */
  ingest_unit: "sessions" | "turns";
  error: string | null;
  result_url: string | null;
  resumes: number;
  resume_from: "retrieve" | "finish" | null;
  key_names: string[];
  resume_until: string | null;
  created_at: string;
  /** For a re-judge: the published run whose stored contexts it judges again. */
  rejudge_of?: string | null;
  /** Whether the current job has reported in, past its start-up (absent from older runners). */
  job_started?: boolean;
}

export interface LogLine {
  at: string;
  /** The job that wrote it. */
  job: "retrieve" | "finish";
  text: string;
}

/** The run's job log: the newest lines, oldest first. Only the run's owner gets it. */
export interface RunLog {
  lines: LogLine[];
  /** Set when the log could not be read just now; the lines are then the last ones read. */
  error: string | null;
}

export interface StartForm {
  dataset: string;
  connector: string;
  /** "" when the connector has no presets. */
  preset: string;
  judgeRoute: string;
  keys: Record<string, string>;
  judgeKey: string;
  affiliated: boolean;
  /** One of RunnerOptions.affiliations, or "" for another memory system. */
  system: string;
}

export interface SignInFragment {
  token?: string;
  /** The login id the token was issued for (the one the sign-in link carried). */
  loginId?: string;
  error?: string;
}

/** What the API put in the address bar after GitHub sign-in: a session token with its
 * login id, or an error. */
export function readFragment(hash: string): SignInFragment {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const token = params.get("token") ?? undefined;
  const loginId = params.get("login_id") ?? undefined;
  const error = params.get("error") ?? undefined;
  return {
    ...(token ? { token } : {}),
    ...(loginId ? { loginId } : {}),
    ...(error ? { error } : {}),
  };
}

/** Whether the token in the address bar comes from a sign-in this browser started: a
 * link carrying someone else's token must not sign the visitor in as them. */
export function ownLogin(fragment: SignInFragment, pending: string | null): boolean {
  return Boolean(fragment.token && pending && fragment.loginId === pending);
}

/** The sign-in link: the API hands ``loginId`` back with the token. */
export function signInUrl(api: string, loginId: string): string {
  return `${api}/auth/login?login_id=${encodeURIComponent(loginId)}`;
}

const LOGIN_ERRORS: Record<string, string> = {
  "login-expired": "The sign-in took too long or was opened in another browser. Try again.",
  "login-failed": "GitHub sign-in did not complete. Try again.",
};

export function loginError(code: string): string {
  return LOGIN_ERRORS[code] ?? "Sign-in failed. Try again.";
}

function trimmed(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
}

/** The body of POST /runs, with the date of the Terms of Use the submitter agreed to. */
export function startBody(form: StartForm): Record<string, unknown> {
  return {
    dataset: form.dataset,
    connector: form.connector,
    ...(form.preset ? { preset: form.preset } : {}),
    judge_route: form.judgeRoute,
    connector_keys: trimmed(form.keys),
    judge_key: form.judgeKey.trim(),
    affiliation: !form.affiliated
      ? { affiliated: false }
      : form.system
        ? { affiliated: true, system: form.system }
        : { affiliated: true },
    terms: TERMS_UPDATED,
  };
}

/** The body of POST /runs/{id}/rejudge: the published signed result, as this site serves it. */
export function rejudgeBody(
  envelope: unknown,
  judgeRoute: string,
  judgeKey: string,
): Record<string, unknown> {
  return { envelope, judge_route: judgeRoute, judge_key: judgeKey.trim(), terms: TERMS_UPDATED };
}

/** The re-judge's cost line: about what the original run's judge cost. */
export function rejudgeCostLine(judgeUsd: number | null | undefined): string {
  return judgeUsd == null
    ? "The judge cost could not be estimated: this run did not report it."
    : `Judge: about ${usd.format(judgeUsd)}, what judging this run cost the first time.`;
}

/** The body of POST /runs/{id}/resume: every key again (they are never kept). */
export function resumeBody(
  keys: Record<string, string>,
  judgeKey: string,
): Record<string, unknown> {
  return { connector_keys: trimmed(keys), judge_key: judgeKey.trim() };
}

const usd = new Intl.NumberFormat("en-GB", { style: "currency", currency: "USD" });

/** The judge cost line for a dataset and judge route. */
export function costLine(estimate: Estimate | undefined, budget: number): string {
  if (
    !estimate ||
    estimate.judge_cost_usd_typical == null ||
    estimate.judge_cost_usd_upper_bound == null
  ) {
    return "The judge cost could not be estimated for this choice.";
  }
  const typical = usd.format(estimate.judge_cost_usd_typical);
  const most = usd.format(estimate.judge_cost_usd_upper_bound);
  return (
    `Judge: usually under ${typical} for ${estimate.questions.toLocaleString("en-GB")} ` +
    `questions, each judged at Top 10 and Top 30; at most ${most} if every answer used the ` +
    `full ${budget.toLocaleString("en-GB")}-token budget. These are estimates only: the real ` +
    "cost depends on how much context the memory system returns, which MemJudge does not " +
    "control."
  );
}

export const ACTIVE_STATES: ReadonlySet<RunState> = new Set([
  "starting",
  "retrieving",
  "judging",
  "publishing",
]);

export function isActive(status: RunStatus): boolean {
  return ACTIVE_STATES.has(status.state);
}

/** The run as the page shows it. The site rebuilds after the runner commits the result, so a
 * finished run stays "publishing" until its result page is live. */
export function shownStatus(status: RunStatus, pageLive: boolean): RunStatus {
  return status.state === "done" && !pageLive ? { ...status, state: "publishing" } : status;
}

const STATE_TEXT: Record<RunState, string> = {
  starting: "Starting",
  retrieving: "Storing the conversations and searching for each question",
  judging: "Judging the answers",
  publishing: "Signing and publishing the result",
  done: "Published",
  stopped: "Stopped",
  failed: "Failed",
};

/** A one-line description of where the run is. Each question is searched and judged twice,
 * at Top 10 and Top 30 (memjudge ADR 0018), so the counts are searches and answers. */
export function stateText(status: RunStatus): string {
  const text = STATE_TEXT[status.state] ?? status.state;
  if ((status.state === "retrieving" || status.state === "judging") && status.total > 0) {
    const unit = status.state === "retrieving" ? "searches" : "answers";
    return `${text}: ${status.done.toLocaleString("en-GB")} of ${status.total.toLocaleString("en-GB")} ${unit}`;
  }
  return text;
}

export interface RunStep {
  label: string;
  state: "done" | "active" | "waiting";
  /** "312 of 1,092 sessions · 28%", when the step has a count. */
  count: string | null;
  done: number;
  total: number;
}

function step(label: string, state: RunStep["state"], done = 0, total = 0, unit = ""): RunStep {
  const counted = state !== "waiting" && total > 0;
  const n = Math.min(done, total);
  return {
    label,
    state,
    count: counted
      ? `${n.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}${unit ? ` ${unit}` : ""} · ${Math.floor((n / total) * 100)}%`
      : null,
    done: n,
    total: counted ? total : 0,
  };
}

const START_UP = "usually 1–2 minutes";

/** An active run's steps. Storing and answering overlap: conversations run in parallel,
 * each answering its questions once its sessions are stored. A job's container start and
 * set-up count as "Starting the job" until the job reports in. */
export function runSteps(status: RunStatus): RunStep[] {
  const order = ["starting", "retrieving", "judging", "publishing"];
  const startingUp = status.job_started === false;
  const at = status.state === "retrieving" && startingUp ? 0 : order.indexOf(status.state);
  const phase = (i: number): RunStep["state"] =>
    at > i ? "done" : at === i ? "active" : "waiting";
  const retrieving = phase(1);
  const stored =
    retrieving === "active" && status.ingest_total > 0 && status.ingested >= status.ingest_total
      ? "done"
      : retrieving;
  const judging =
    phase(2) === "active" && startingUp
      ? { ...step("Judging the answers", "active"), count: `Starting the job, ${START_UP}` }
      : step(
          "Judging the answers",
          phase(2),
          phase(2) === "active" ? status.done : 0,
          phase(2) === "active" ? status.total : 0,
          "answers",
        );
  return [
    { ...step("Starting the job", phase(0)), count: phase(0) === "active" ? START_UP : null },
    step(
      "Storing the conversations",
      stored,
      status.ingested,
      status.ingest_total,
      status.ingest_unit,
    ),
    step(
      "Searching for each question, at Top 10 and Top 30",
      retrieving,
      retrieving === "active" ? status.done : 0,
      retrieving === "active" ? status.total : 0,
      "searches",
    ),
    judging,
    step("Signing and publishing the result", phase(3)),
  ].filter((_, i) => !status.rejudge_of || i === 0 || i >= 3); // a re-judge stores nothing
}

const time = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const SHORT_STATE: Record<RunState, string> = {
  starting: "Starting",
  retrieving: "Running",
  judging: "Judging",
  publishing: "Publishing",
  done: "Published",
  stopped: "Stopped",
  failed: "Failed",
};

/** One line for the list of a user's runs: when it started and where it is. */
/** "Started 17 Oct, 12:43", for the runs list and the run panel. */
export function startedText(status: RunStatus): string {
  return `Started ${time.format(new Date(status.created_at))}`;
}

export function runSummary(status: RunStatus): string {
  const state =
    status.state === "stopped" && status.resume_until
      ? "Stopped, can be resumed"
      : (SHORT_STATE[status.state] ?? status.state);
  return `${startedText(status)} · ${state}`;
}

const clock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The log as text, one line each: "14:02:11  retrieve  INFO memjudge.harness: ...". */
export function logText(lines: LogLine[]): string {
  if (!lines.length) return "No log lines yet.";
  return lines
    .map((line) => `${clock.format(new Date(line.at))}  ${line.job.padEnd(8)}  ${line.text}`)
    .join("\n");
}

/** When a stopped run can still be resumed, or why it cannot. */
export function resumeNote(status: RunStatus): string | null {
  if (status.state !== "stopped") return null;
  if (status.rejudge_of) return "A re-judge cannot be resumed. Start it again from the run's page.";
  if (status.resume_until) {
    return `You can resume it until ${time.format(new Date(status.resume_until))}. Completed work is kept.`;
  }
  return "It can no longer be resumed (48 hours have passed, or it was resumed 3 times). Start a new run.";
}

/** The API's error detail as one readable message. */
export function errorMessage(detail: unknown, status: number): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return "Some fields are missing or invalid. Check the form.";
  if (status === 401) return "Your sign-in has expired. Sign in again.";
  return `The runner answered with an error (${status}). Try again in a moment.`;
}
