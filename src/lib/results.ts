/** Reading signed results from the results repo, and deciding which ones the site lists. */
import type { KeyObject } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ResultValidator } from "./schema.ts";
import type { RunResult, SignedResult, StopCause } from "./types.ts";
import { VerificationError, verifyEnvelope } from "./verify.ts";

export interface LoadedRun {
  /** File name inside the results folder. */
  file: string;
  /** The file exactly as published, offered for download so anyone can verify it. */
  raw: string;
  result: SignedResult;
  keyId: string;
}

export interface Skipped {
  file: string;
  reason: string;
}

/** Verify every `*.json` in `dir`. Invalid files are skipped with a reason, never thrown. */
export function readSignedResults(
  dir: string,
  trusted: Map<string, KeyObject>,
  validate: ResultValidator,
): { runs: LoadedRun[]; skipped: Skipped[] } {
  const runs: LoadedRun[] = [];
  const skipped: Skipped[] = [];
  if (!existsSync(dir)) return { runs, skipped };
  const seen = new Set<string>();
  for (const file of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort()) {
    const raw = readFileSync(join(dir, file), "utf8");
    let envelope: unknown;
    try {
      envelope = JSON.parse(raw);
    } catch {
      skipped.push({ file, reason: "not valid JSON" });
      continue;
    }
    let keyId: string;
    try {
      keyId = verifyEnvelope(envelope, trusted);
    } catch (err) {
      if (!(err instanceof VerificationError)) throw err;
      skipped.push({ file, reason: `signature: ${err.message}` });
      continue;
    }
    const payload = (envelope as { payload: unknown }).payload;
    const problem = validate(payload);
    if (problem !== null) {
      skipped.push({ file, reason: `schema: ${problem}` });
      continue;
    }
    const result = payload as SignedResult;
    if (seen.has(result.run_id)) {
      skipped.push({ file, reason: `duplicate run id ${result.run_id}` });
      continue;
    }
    seen.add(result.run_id);
    runs.push({ file, raw, result, keyId });
  }
  return { runs, skipped };
}

/**
 * Labels for what makes a run differ from a clean hosted run. They come from the signed
 * result itself and are shown wherever the run appears; nothing is hidden or filtered.
 */
export function runNotices(result: RunResult): string[] {
  const notices: string[] = [];
  if (result.mode !== "hosted") notices.push("Local run");
  if (!result.judge.official) notices.push("Unofficial judge");
  if (result.connector.custom_endpoint) {
    const where = result.connector.endpoint ? ` (${result.connector.endpoint})` : "";
    notices.push(`Custom endpoint${where}`);
  }
  if (result.reused_ingestion) {
    notices.push(`Ingestion reused from run ${result.reused_ingestion.run_id}`);
  }
  if (result.resumes) {
    notices.push(`Resumed ${result.resumes} time${result.resumes === 1 ? "" : "s"}`);
  }
  return notices;
}

const STOP_CAUSES: Record<StopCause, string> = {
  submitter: "stopped by the submitter",
  retrieval: "retrieval failed (the memory system or the retrieval job)",
  judge: "the judge failed",
  crash: "the job crashed or hit its time limit",
  runner: "runner error",
};

export interface HistoryRow {
  at: string;
  text: string;
}

/**
 * When a run stopped (and why) and was resumed, between its start and finish. Empty for a
 * run that never stopped. A re-judge's history is the original run's, so its own start
 * and finish are not added.
 */
export function historyRows(result: RunResult): HistoryRow[] {
  const events = (result.history ?? []).map((e) => ({
    at: e.at,
    text:
      e.event === "resumed"
        ? "Resumed"
        : `Stopped: ${e.cause ? STOP_CAUSES[e.cause] : "cause not recorded"}`,
  }));
  if (!events.length || result.rejudged_from) return events;
  return [
    { at: result.started_at, text: "Started" },
    ...events,
    { at: result.finished_at, text: "Finished" },
  ];
}
