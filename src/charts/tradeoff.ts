/**
 * The headline chart: accuracy (with its 95% CI) against what a run spends: context
 * tokens or retrieval latency. Up and to the left is better.
 */
import { pct, secs } from "../lib/format.ts";
import { RUN_LETTERS, RUN_SYMBOLS } from "../lib/runs.ts";
import { base, escapeHtml, valueAxis, type Option, type Palette } from "./echarts.ts";

export type TradeoffAxis = "tokens" | "latency";

export interface TradeoffPoint {
  id: string;
  label: string;
  acc: number;
  lo: number;
  hi: number;
  tokens: number;
  latency: number | null;
  /** Compared-run index (0 to 3); undefined on the leaderboard, where every run is ink. */
  run?: number;
  /** Leaderboard rank, the label on narrow charts. */
  rank?: number;
}

/** Below this width, points are labelled with their rank or letter instead of their name. */
const COMPACT_WIDTH = 600;

const AXES: Record<TradeoffAxis, { name: string; value: (p: TradeoffPoint) => number | null }> = {
  tokens: { name: "Context tokens per question (log scale)", value: (p) => p.tokens },
  latency: { name: "Retrieval latency, median (log scale)", value: (p) => p.latency },
};

function formatX(axis: TradeoffAxis, value: number): string {
  if (axis === "tokens") return `${Math.round(value).toLocaleString("en-GB")} tokens`;
  return secs(value);
}

/** A linear range around [lo, hi] with some room, starting at a round number. */
function niceLinearRange(lo: number, hi: number): { min: number; max: number } {
  const span = hi - lo || hi || 1;
  const step = 10 ** Math.floor(Math.log10(span));
  return {
    min: Math.max(0, Math.floor((lo - span * 0.25) / step) * step),
    max: Math.ceil((hi + span * 0.25) / step) * step,
  };
}

/** How many points have no value on this axis (they cannot be placed). */
export function missingOn(points: TradeoffPoint[], axis: TradeoffAxis): number {
  return points.filter((p) => !((AXES[axis].value(p) ?? 0) > 0)).length;
}

export function tradeoffOption(
  points: TradeoffPoint[],
  axis: TradeoffAxis,
  p: Palette,
  width = Infinity,
): Option | null {
  const compact = width < COMPACT_WIDTH;
  const shown = points.filter((pt) => (AXES[axis].value(pt) ?? 0) > 0);
  if (shown.length === 0) return null;
  // A log scale only when the values span a wide range; otherwise a padded linear one.
  const xs = shown.map((pt) => AXES[axis].value(pt)!);
  const log = Math.max(...xs) / Math.min(...xs) > 6;
  const xRange = log
    ? { min: Math.min(...xs) / 1.6, max: Math.max(...xs) * 1.6 }
    : niceLinearRange(Math.min(...xs), Math.max(...xs));
  const lo = Math.min(...shown.map((pt) => pt.lo)) * 100;
  const hi = Math.max(...shown.map((pt) => pt.hi)) * 100;
  const yMin = Math.max(0, Math.floor((lo - 2) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((hi + 2) / 5) * 5);
  const colour = (pt: TradeoffPoint) => (pt.run === undefined ? p.ink : p.runs[pt.run]!);
  const short = (pt: TradeoffPoint) =>
    pt.run === undefined ? String(pt.rank ?? "") : RUN_LETTERS[pt.run]!;
  const datum = (pt: TradeoffPoint) => ({
    name: compact
      ? short(pt)
      : pt.run === undefined
        ? pt.label
        : `${RUN_LETTERS[pt.run]}  ${pt.label}`,
    value: [AXES[axis].value(pt), pt.acc * 100, pt.lo * 100, pt.hi * 100],
    id: pt.id,
    symbol: pt.run === undefined ? "circle" : RUN_SYMBOLS[pt.run],
    itemStyle: { color: colour(pt), borderColor: p.paper, borderWidth: 2 },
  });

  return {
    ...base(p),
    grid: { left: compact ? 48 : 64, right: compact ? 16 : 32, top: 24, bottom: 64 },
    tooltip: {
      ...(base(p).tooltip as object),
      trigger: "item",
      formatter: (params: { dataIndex: number; seriesType: string }) => {
        const pt = shown[params.dataIndex];
        if (!pt) return "";
        const x = AXES[axis].value(pt)!;
        return (
          `<strong>${escapeHtml(pt.label)}</strong><br>` +
          `Accuracy ${pct(pt.acc)} (95% CI ${pct(pt.lo)} to ${pct(pt.hi)})<br>` +
          escapeHtml(formatX(axis, x))
        );
      },
    },
    xAxis: valueAxis(p, log ? AXES[axis].name : AXES[axis].name.replace(" (log scale)", ""), {
      type: log ? "log" : "value",
      ...xRange,
      nameGap: 36,
      axisLabel: {
        color: p.ink2,
        fontSize: 12,
        formatter: (v: number) => formatX(axis, v).replace(" tokens", ""),
      },
    }),
    yAxis: valueAxis(p, "Accuracy (%)", { type: "value", min: yMin, max: yMax, nameGap: 44 }),
    series: [
      {
        type: "custom",
        silent: true,
        data: shown.map((pt) => ({
          value: [AXES[axis].value(pt), pt.acc * 100, pt.lo * 100, pt.hi * 100],
          itemStyle: { color: colour(pt) },
        })),
        renderItem: (
          _params: unknown,
          api: {
            value: (i: number) => number;
            coord: (v: number[]) => number[];
            visual: (k: string) => string;
          },
        ) => {
          const top = api.coord([api.value(0), api.value(3)]);
          const bottom = api.coord([api.value(0), api.value(2)]);
          const stroke = { stroke: api.visual("color"), lineWidth: 1.5, opacity: 0.55 };
          return {
            type: "group",
            children: [
              {
                type: "line",
                shape: { x1: top[0], y1: top[1], x2: bottom[0], y2: bottom[1] },
                style: stroke,
              },
              {
                type: "line",
                shape: { x1: top[0]! - 4, y1: top[1], x2: top[0]! + 4, y2: top[1] },
                style: stroke,
              },
              {
                type: "line",
                shape: { x1: bottom[0]! - 4, y1: bottom[1], x2: bottom[0]! + 4, y2: bottom[1] },
                style: stroke,
              },
            ],
          };
        },
        z: 1,
      },
      {
        type: "scatter",
        symbolSize: 11,
        data: shown.map(datum),
        cursor: "pointer",
        label: {
          show: true,
          position: "right",
          distance: 8,
          formatter: "{b}",
          color: p.ink,
          fontSize: 12,
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        emphasis: { scale: 1.3, label: { fontWeight: "bold" } },
        z: 2,
      },
    ],
  };
}
