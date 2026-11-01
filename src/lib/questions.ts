/**
 * Per-question records (`questions.jsonl`) turned into the compact files the browser loads:
 * one row per question per run, the question text once per dataset, and the retrieved
 * contexts in small chunks fetched only when someone opens a question.
 */
import { naturalCompare } from "./stats.ts";

/** One line of memjudge's questions.jsonl (only the fields the site uses). */
export interface QuestionRecord {
  question_id: string;
  conversation_id: string;
  category: string;
  kind: string;
  question?: string;
  gold_answer?: string;
  asked_at?: string | null;
  context?: string;
  context_tokens?: number;
  truncated?: boolean;
  retrieval_seconds?: number | null;
  retrieval_error?: string | null;
  correct?: boolean | null;
  reason?: string;
  stale?: boolean | null;
  gold_suspect?: boolean;
  judge_error?: string | null;
}

/** The latest record per question (a resumed run may re-write one), in question-id order. */
export function parseQuestions(text: string): QuestionRecord[] {
  const latest = new Map<string, QuestionRecord>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as QuestionRecord;
    latest.set(record.question_id, record);
  }
  return [...latest.values()].sort((a, b) => naturalCompare(a.question_id, b.question_id));
}

export const FLAG_GOLD_SUSPECT = 1;
export const FLAG_STALE = 2;
export const FLAG_TRUNCATED = 4;

/** Verdict: 1 right, 0 wrong, null no verdict (retrieval or judge failed). */
export type Verdict = 1 | 0 | null;

/** [question id, verdict, flags, context tokens, retrieval seconds, judge reason, error] */
export type Row = [string, Verdict, number, number, number | null, string, string | null];

/** [conversation id, category, kind, question, gold answer, asked at] */
export type QuestionInfo = [string, string, string, string, string, string | null];

export function toRow(r: QuestionRecord): Row {
  const verdict: Verdict = r.correct === true ? 1 : r.correct === false ? 0 : null;
  const flags =
    (r.gold_suspect ? FLAG_GOLD_SUSPECT : 0) |
    (r.stale ? FLAG_STALE : 0) |
    (r.truncated ? FLAG_TRUNCATED : 0);
  const seconds = r.retrieval_seconds == null ? null : Number(r.retrieval_seconds.toFixed(6));
  return [
    r.question_id,
    verdict,
    flags,
    r.context_tokens ?? 0,
    seconds,
    r.reason ?? "",
    r.retrieval_error ?? r.judge_error ?? null,
  ];
}

export function toInfo(r: QuestionRecord): QuestionInfo {
  return [
    r.conversation_id,
    r.category,
    r.kind,
    r.question ?? "",
    r.gold_answer ?? "",
    r.asked_at ?? null,
  ];
}

/** Contexts per chunk file. A full LoCoMo run (1,986 questions) makes 40 files. */
export const CHUNK_SIZE = 50;

/** Contexts split in question-id order: chunk i holds rows i*50 to i*50+49. */
export function contextChunks(records: QuestionRecord[]): Record<string, string>[] {
  const chunks: Record<string, string>[] = [];
  records.forEach((r, i) => {
    const chunk = (chunks[Math.floor(i / CHUNK_SIZE)] ??= {});
    chunk[r.question_id] = r.context ?? "";
  });
  return chunks;
}
