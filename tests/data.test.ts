import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ArtifactMismatch,
  ArtifactMissing,
  loadArtifact,
  localSource,
  sha256,
} from "../src/lib/artifacts.ts";
import {
  CHUNK_SIZE,
  contextChunks,
  FLAG_GOLD_SUSPECT,
  FLAG_TRUNCATED,
  parseQuestions,
  toInfo,
  toRow,
} from "../src/lib/questions.ts";
import type { SignedResult } from "../src/lib/types.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const RUN = "20261001T140000Z-b33333";
const result: SignedResult = JSON.parse(
  readFileSync(join(FIXTURES, "results", "runs", `${RUN}.json`), "utf8"),
).payload;
const questionsArtifact = result.artifacts.find((a) => a.name === "questions-top30.jsonl")!;
const source = localSource(join(FIXTURES, "artifacts"));

describe("artifacts", () => {
  it("loads a file whose hash matches the signed result", async () => {
    const bytes = await loadArtifact(source, RUN, questionsArtifact, null);
    expect(sha256(bytes)).toBe(questionsArtifact.sha256);
  });

  it("refuses a file that differs from its signed hash", async () => {
    const wrong = { ...questionsArtifact, sha256: "sha256:" + "0".repeat(64) };
    await expect(loadArtifact(source, RUN, wrong, null)).rejects.toBeInstanceOf(ArtifactMismatch);
  });

  it("reports a missing file", async () => {
    await expect(
      loadArtifact(source, "no-such-run", questionsArtifact, null),
    ).rejects.toBeInstanceOf(ArtifactMissing);
  });
});

describe("questions", () => {
  const text = readFileSync(join(FIXTURES, "artifacts", RUN, "questions-top30.jsonl"), "utf8");

  it("keeps the last record per question, in natural id order", () => {
    const first = JSON.parse(text.split("\n")[0]!);
    const rewritten = `${text}${JSON.stringify({ ...first, reason: "re-judged" })}\n`;
    const records = parseQuestions(rewritten);
    expect(records).toHaveLength(24);
    expect(records.find((r) => r.question_id === first.question_id)?.reason).toBe("re-judged");
    expect(records.slice(0, 3).map((r) => r.question_id)).toEqual(["c1:q1", "c1:q2", "c1:q3"]);
    expect(records.slice(7, 9).map((r) => r.question_id)).toEqual(["c1:q8", "c2:q1"]);
  });

  it("turns records into compact rows", () => {
    const records = parseQuestions(text);
    const failed = toRow(records[0]!);
    expect(failed[1]).toBeNull();
    expect(failed[6]).toBe("judge HTTP 529: overloaded");
    const truncated = records.find((r) => r.truncated)!;
    expect(toRow(truncated)[2] & FLAG_TRUNCATED).toBeTruthy();
    const suspect = records.find((r) => r.gold_suspect)!;
    expect(toRow(suspect)[2] & FLAG_GOLD_SUSPECT).toBeTruthy();
    expect(toInfo(records[0]!)).toEqual([
      "c1",
      "single-hop",
      "standard",
      "Which city did Ana move to?",
      "Lisbon",
      "2024-06-11T09:00:00Z",
    ]);
  });

  it("splits contexts into chunks in row order", () => {
    const records = parseQuestions(text);
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...records[0]!,
      question_id: `x:q${i}`,
      context: `context ${i}`,
    }));
    const chunks = contextChunks(many);
    expect(chunks.map((c) => Object.keys(c).length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 20]);
    expect(chunks[2]!["x:q100"]).toBe("context 100");
  });
});
