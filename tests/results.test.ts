import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { historyRows, readSignedResults, runNotices } from "../src/lib/results.ts";
import { makeResultValidator } from "../src/lib/schema.ts";
import type { RunResult } from "../src/lib/types.ts";
import { loadTrustedKeys } from "../src/lib/verify.ts";

const FIXTURES = join(import.meta.dirname, "fixtures");
const trusted = loadTrustedKeys(join(FIXTURES, "keys"));
const validate = makeResultValidator(
  JSON.parse(readFileSync(join(import.meta.dirname, "..", "schemas", "result.v1.json"), "utf8")),
);

function copyOfResults(): string {
  const dir = mkdtempSync(join(tmpdir(), "mj-results-"));
  cpSync(join(FIXTURES, "results", "runs"), dir, { recursive: true });
  return dir;
}

describe("readSignedResults", () => {
  it("verifies every fixture", () => {
    const { runs, skipped } = readSignedResults(copyOfResults(), trusted, validate);
    expect(skipped).toEqual([]);
    expect(runs.map((r) => r.result.run_id)).toHaveLength(4);
    expect(runs.every((r) => r.keyId === "354ba5be4e44ca1e")).toBe(true);
  });

  it("skips a tampered file with the reason, and keeps the others", () => {
    const dir = copyOfResults();
    const file = join(dir, "20261001T140000Z-b33333.json");
    writeFileSync(file, readFileSync(file, "utf8").replace('"accuracy": 0.', '"accuracy": 0.9'));
    const { runs, skipped } = readSignedResults(dir, trusted, validate);
    expect(runs).toHaveLength(3);
    expect(skipped).toEqual([
      {
        file: "20261001T140000Z-b33333.json",
        reason: "signature: signature does not match payload",
      },
    ]);
  });

  it("skips files that are not JSON or not signed by a trusted key", () => {
    const dir = copyOfResults();
    writeFileSync(join(dir, "broken.json"), "{");
    const { skipped } = readSignedResults(dir, new Map(), validate);
    expect(skipped.find((s) => s.file === "broken.json")?.reason).toBe("not valid JSON");
    expect(
      skipped.filter((s) => s.reason.startsWith("signature: unknown signing key")),
    ).toHaveLength(4);
  });

  it("returns nothing for a missing folder", () => {
    expect(readSignedResults(join(tmpdir(), "does-not-exist-mj"), trusted, validate)).toEqual({
      runs: [],
      skipped: [],
    });
  });
});

describe("schema check", () => {
  it("reports a payload that does not match the published schema", () => {
    const envelope = JSON.parse(
      readFileSync(join(FIXTURES, "results", "runs", "20261001T120000Z-a11111.json"), "utf8"),
    );
    expect(validate(envelope.payload)).toBeNull();
    delete envelope.payload.metrics;
    expect(validate(envelope.payload)).toContain("metrics");
  });

  it("accepts results with and without the ingestion mode (ADR 0017)", () => {
    const { payload } = JSON.parse(
      readFileSync(join(FIXTURES, "results", "runs", "20261001T120000Z-a11111.json"), "utf8"),
    );
    expect(payload.metrics.top30.ingestion.mode).toBeUndefined();
    payload.metrics.top30.ingestion.mode = "batch";
    expect(validate(payload)).toBeNull();
    payload.metrics.top30.ingestion.mode = "parallel";
    expect(validate(payload)).toContain("mode");
  });
});

describe("run notices", () => {
  const base = JSON.parse(
    readFileSync(join(FIXTURES, "results", "runs", "20261001T120000Z-a11111.json"), "utf8"),
  ).payload as RunResult;
  const variant = (change: (r: RunResult) => void): RunResult => {
    const r = structuredClone(base);
    change(r);
    return r;
  };

  it("has nothing to say about a clean hosted run", () => {
    expect(runNotices(base)).toEqual([]);
  });

  it("labels local runs, unofficial judges, custom endpoints, reused ingestion and resumes", () => {
    const unusual = variant((r) => {
      r.mode = "local";
      r.judge.official = false;
      r.connector.custom_endpoint = true;
      r.connector.endpoint = "http://localhost:8080";
      r.reused_ingestion = { run_id: "x", connector_code_hash: "sha256:c" };
      r.resumes = 2;
    });
    expect(runNotices(unusual)).toEqual([
      "Local run",
      "Unofficial judge",
      "Custom endpoint (http://localhost:8080)",
      "Ingestion reused from run x",
      "Resumed 2 times",
    ]);
    expect(runNotices(variant((r) => (r.resumes = 1)))).toEqual(["Resumed 1 time"]);
  });
});

describe("run history", () => {
  const base = JSON.parse(
    readFileSync(join(FIXTURES, "results", "runs", "20261001T120000Z-a11111.json"), "utf8"),
  ).payload as RunResult;
  const stops: RunResult["history"] = [
    { at: "2026-10-01T12:30:00Z", event: "stopped", cause: "judge" },
    { at: "2026-10-01T13:00:00Z", event: "resumed", cause: null },
  ];

  it("is empty for a run that never stopped", () => {
    expect(historyRows(base)).toEqual([]);
    expect(historyRows({ ...base, history: [] })).toEqual([]);
  });

  it("puts stops and resumes between the start and the finish", () => {
    const rows = historyRows({ ...base, history: stops });
    expect(rows.map((r) => r.text)).toEqual([
      "Started",
      "Stopped: the judge failed",
      "Resumed",
      "Finished",
    ]);
    expect(rows[0]?.at).toBe(base.started_at);
    expect(rows.at(-1)?.at).toBe(base.finished_at);
  });

  it("shows a re-judge only the original run's stops and resumes", () => {
    const rejudge = { ...base, history: stops, rejudged_from: { run_id: "x", season: "1" } };
    expect(historyRows(rejudge).map((r) => r.text)).toEqual([
      "Stopped: the judge failed",
      "Resumed",
    ]);
  });

  it("is accepted by the published schema", () => {
    expect(validate({ ...base, history: stops })).toBeNull();
    expect(validate({ ...base, history: [{ at: "x", event: "paused" }] })).toContain("history");
  });
});
