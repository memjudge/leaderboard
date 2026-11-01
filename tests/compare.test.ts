import { describe, expect, it } from "vitest";
import { bestScore, type MetricRow, ROWS } from "../src/client/compare.ts";
import type { RunSummary } from "../src/lib/site-types.ts";
import type { Ingestion } from "../src/lib/types.ts";

const row = ROWS.find(
  (r): r is MetricRow => typeof r !== "string" && r.label === "Ingestion, total",
)!;

const run = (total_s: number, mode?: Ingestion["mode"]) =>
  ({ metrics: { ingestion: { total_s, mode } } }) as unknown as RunSummary;

describe("compare: ingestion time (ADR 0017)", () => {
  it("marks the fastest among runs that ingested the same way", () => {
    expect(bestScore(row, [run(100), run(50, "per-session")])).toBe(50);
    expect(bestScore(row, [run(100, "batch"), run(50, "batch")])).toBe(50);
  });

  it("marks no best between batch and per-session runs", () => {
    expect(bestScore(row, [run(1000), run(50, "batch")])).toBeNull();
  });

  it("labels batch time as wall-clock and per-session time as a sum", () => {
    expect(row.value(run(50, "batch"))).toBe("50.00 s (batch, wall-clock)");
    expect(row.value(run(50))).toBe("50.00 s (all conversations added up)");
  });
});
