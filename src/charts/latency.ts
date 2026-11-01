/**
 * Retrieval latency as the share of questions answered within a given time (an
 * empirical cumulative distribution). Further left is faster; it handles up to four runs
 * without overlapping bars.
 */
import { secs } from "../lib/format.ts";
import { RUN_LETTERS } from "../lib/runs.ts";
import { ecdf } from "../lib/stats.ts";
import { base, escapeHtml, valueAxis, type Option, type Palette } from "./echarts.ts";

export interface LatencyRun {
  label: string;
  run: number | null;
  seconds: number[];
}

export function latencyOption(runs: LatencyRun[], p: Palette): Option | null {
  const shown = runs.filter((r) => r.seconds.some((s) => s > 0));
  if (shown.length === 0) return null;
  return {
    ...base(p),
    grid: { left: 64, right: 32, top: 16, bottom: 64 },
    tooltip: {
      ...(base(p).tooltip as object),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: p.ink3 } },
      formatter: (items: { seriesIndex: number; value: [number, number] }[]) =>
        items
          .map((it) => {
            const r = shown[it.seriesIndex]!;
            const who = r.run === null ? "" : `${RUN_LETTERS[r.run]} `;
            return `${who}${escapeHtml(r.label)}: ${it.value[1].toFixed(0)}% within ${escapeHtml(secs(it.value[0]))}`;
          })
          .join("<br>"),
    },
    xAxis: valueAxis(p, "Retrieval time (log scale)", {
      type: "log",
      nameGap: 36,
      axisLabel: { color: p.ink2, fontSize: 12, formatter: (v: number) => secs(v) },
    }),
    yAxis: valueAxis(p, "Questions answered within (%)", {
      type: "value",
      min: 0,
      max: 100,
      nameGap: 44,
    }),
    series: shown.map((r) => ({
      type: "line",
      name: r.label,
      step: "end",
      showSymbol: false,
      data: ecdf(r.seconds.filter((s) => s > 0)).map(([x, y]) => [x, y * 100]),
      lineStyle: { width: 2, color: r.run === null ? p.ink : p.runs[r.run] },
      itemStyle: { color: r.run === null ? p.ink : p.runs[r.run] },
    })),
  };
}
