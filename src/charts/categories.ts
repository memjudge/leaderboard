/**
 * Accuracy by question category as a dot plot: one row per category, one marker per run
 * with its 95% CI as a horizontal line. Weak categories show where a system fails.
 */
import { pct } from "../lib/format.ts";
import { RUN_LETTERS, RUN_SYMBOLS } from "../lib/runs.ts";
import type { CategoryMetrics } from "../lib/types.ts";
import { base, escapeHtml, valueAxis, type Option, type Palette } from "./echarts.ts";

export interface CategoryRun {
  label: string;
  /** Compared-run index (0 to 3), or null for a single run drawn in ink. */
  run: number | null;
  byCategory: Record<string, CategoryMetrics>;
}

/** Height that gives each category row room for up to four markers. */
export function categoryChartHeight(categories: number): number {
  return Math.max(220, categories * 64 + 72);
}

export function categoryOption(categories: string[], runs: CategoryRun[], p: Palette): Option {
  const spread = 0.17;
  const offset = (k: number) => (k - (runs.length - 1) / 2) * spread;
  const colour = (r: CategoryRun) => (r.run === null ? p.ink : p.runs[r.run]!);
  const points = runs.map((r, k) =>
    categories
      .map((c, i) => ({ c, i, m: r.byCategory[c] }))
      .filter((x): x is { c: string; i: number; m: CategoryMetrics } => x.m !== undefined)
      .map(({ c, i, m }) => ({
        value: [
          m.accuracy * 100,
          i + offset(k),
          m.accuracy_ci95[0] * 100,
          m.accuracy_ci95[1] * 100,
        ],
        category: c,
        metrics: m,
      })),
  );

  return {
    ...base(p),
    grid: { left: 8, right: 24, top: 8, bottom: 52, containLabel: true },
    tooltip: {
      ...(base(p).tooltip as object),
      trigger: "item",
      formatter: (params: { seriesIndex: number; dataIndex: number }) => {
        const k = Math.floor(params.seriesIndex / 2);
        const run = runs[k];
        const point = points[k]?.[params.dataIndex];
        if (!run || !point) return "";
        const m = point.metrics;
        const who = run.run === null ? "" : `${RUN_LETTERS[run.run]} ${escapeHtml(run.label)}<br>`;
        return (
          `${who}<strong>${escapeHtml(point.category)}</strong><br>` +
          `${pct(m.accuracy)}: ${m.correct} of ${m.questions} correct<br>` +
          `95% CI ${pct(m.accuracy_ci95[0])} to ${pct(m.accuracy_ci95[1])}`
        );
      },
    },
    xAxis: valueAxis(p, "Accuracy (%)", { type: "value", min: 0, max: 100, nameGap: 32 }),
    yAxis: {
      type: "value",
      inverse: true,
      min: -0.5,
      max: categories.length - 0.5,
      interval: 1,
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: {
        color: p.ink,
        fontSize: 13,
        customValues: categories.map((_, i) => i),
        formatter: (v: number) => categories[Math.round(v)] ?? "",
      },
    },
    series: runs.flatMap((r, k) => [
      {
        type: "custom",
        silent: true,
        data: points[k]!.map((pt) => pt.value),
        itemStyle: { color: colour(r) },
        renderItem: (
          _params: unknown,
          api: {
            value: (i: number) => number;
            coord: (v: number[]) => number[];
            visual: (k: string) => string;
          },
        ) => {
          const from = api.coord([api.value(2), api.value(1)]);
          const to = api.coord([api.value(3), api.value(1)]);
          return {
            type: "line",
            shape: { x1: from[0], y1: from[1], x2: to[0], y2: to[1] },
            style: { stroke: api.visual("color"), lineWidth: 2, opacity: 0.5 },
          };
        },
        z: 1,
      },
      {
        type: "scatter",
        name: r.label,
        symbol: r.run === null ? "circle" : RUN_SYMBOLS[r.run],
        symbolSize: 11,
        data: points[k]!.map((pt) => pt.value),
        itemStyle: { color: colour(r), borderColor: p.paper, borderWidth: 1.5 },
        z: 2,
      },
    ]),
  };
}
