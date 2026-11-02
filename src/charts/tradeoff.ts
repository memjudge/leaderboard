/**
 * The headline chart: accuracy (with its 95% CI) against what a run spends: context
 * tokens or retrieval latency. Up and to the left is better. On the leaderboard, runs on the
 * frontier are drawn in the accent and joined by a staircase, and the corner no run has
 * reached yet is shaded.
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
  /** Compared-run index (0 to 3); undefined on the leaderboard, where the frontier is shown. */
  run?: number;
  /** Leaderboard rank, the label on narrow charts. */
  rank?: number;
}

/** Below this width, points are labelled with their rank or letter instead of their name. */
const COMPACT_WIDTH = 600;
/** Marker size, gap between marker and label, label box height and font size (px). */
const SYMBOL = 11;
const LABEL_GAP = 8;
const LABEL_HEIGHT = 16;
const FONT_SIZE = 12;

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

/**
 * The points no other point beats on both axes (at least as accurate for no more spend, and
 * better on one), in order of spend.
 */
export function frontier<T>(points: T[], x: (p: T) => number, y: (p: T) => number): T[] {
  const sorted = [...points].sort((a, b) => x(a) - x(b) || y(b) - y(a));
  const out: T[] = [];
  for (const p of sorted) if (out.length === 0 || y(p) > y(out.at(-1)!)) out.push(p);
  return out;
}

export type LabelSide = "right" | "left" | "top" | "bottom" | "above-right" | "below-right";
const SIDES: LabelSide[] = ["right", "left", "top", "bottom", "above-right", "below-right"];

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A marker's centre and its label's width, in pixels. */
export interface LabelItem {
  x: number;
  y: number;
  width: number;
  /** Always labelled: when no side is clear, the first side inside the bounds. */
  required?: boolean;
}

/** Diagonal labels start at the marker's right edge, half a gap above or below it. */
const DIAGONAL_GAP = LABEL_GAP / 2;

function labelBox(it: LabelItem, side: LabelSide): Box {
  const r = SYMBOL / 2;
  const h = LABEL_HEIGHT;
  const w = it.width;
  if (side === "right") return { x: it.x + r + LABEL_GAP, y: it.y - h / 2, w, h };
  if (side === "left") return { x: it.x - r - LABEL_GAP - w, y: it.y - h / 2, w, h };
  if (side === "top") return { x: it.x - w / 2, y: it.y - r - LABEL_GAP - h, w, h };
  if (side === "bottom") return { x: it.x - w / 2, y: it.y + r + LABEL_GAP, w, h };
  if (side === "above-right") return { x: it.x + r, y: it.y - r - DIAGONAL_GAP - h, w, h };
  return { x: it.x + r, y: it.y + r + DIAGONAL_GAP, w, h };
}

/** ECharts label settings for a side; diagonals are offsets from the marker's top-left. */
function labelPosition(side: LabelSide): object {
  if (side === "above-right")
    return {
      position: [SYMBOL, -(DIAGONAL_GAP + LABEL_HEIGHT)],
      align: "left",
      verticalAlign: "top",
    };
  if (side === "below-right")
    return { position: [SYMBOL, SYMBOL + DIAGONAL_GAP], align: "left", verticalAlign: "top" };
  return { position: side };
}

/**
 * Where each label goes: the first side whose box stays inside `bounds` and clear of every
 * marker, every obstacle (lines drawn on the chart) and the labels placed before it, or null
 * when no side is. Items are placed in the order given, so the most important come first.
 */
export function placeLabels(
  items: LabelItem[],
  bounds: Box,
  obstacles: Box[] = [],
): (LabelSide | null)[] {
  const r = SYMBOL / 2;
  const markers = items.map((it) => ({ x: it.x - r, y: it.y - r, w: SYMBOL, h: SYMBOL }));
  const taken: Box[] = [...obstacles];
  const inside = (b: Box) =>
    b.x >= bounds.x &&
    b.y >= bounds.y &&
    b.x + b.w <= bounds.x + bounds.w &&
    b.y + b.h <= bounds.y + bounds.h;
  const overlaps = (a: Box, b: Box) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  return items.map((it) => {
    const clear = SIDES.find((side) => {
      const b = labelBox(it, side);
      return (
        inside(b) && !markers.some((m) => overlaps(b, m)) && !taken.some((t) => overlaps(b, t))
      );
    });
    const side =
      clear ?? (it.required ? (SIDES.find((s) => inside(labelBox(it, s))) ?? "right") : null);
    if (side) taken.push(labelBox(it, side));
    return side;
  });
}

let measureCanvas: HTMLCanvasElement | undefined;
function textWidth(text: string, font: string, weight: number): number {
  const ctx = (measureCanvas ??= document.createElement("canvas")).getContext("2d");
  if (!ctx) return text.length * FONT_SIZE * 0.6;
  ctx.font = `${weight} ${FONT_SIZE}px ${font}`;
  return ctx.measureText(text).width;
}

export function tradeoffOption(
  points: TradeoffPoint[],
  axis: TradeoffAxis,
  p: Palette,
  width = Infinity,
  height = 0,
): Option | null {
  const compact = width < COMPACT_WIDTH;
  const xOf = (pt: TradeoffPoint) => AXES[axis].value(pt)!;
  const shown = points.filter((pt) => (AXES[axis].value(pt) ?? 0) > 0);
  if (shown.length === 0) return null;
  // A log scale only when the values span a wide range; otherwise a padded linear one.
  const xs = shown.map(xOf);
  const log = Math.max(...xs) / Math.min(...xs) > 6;
  const xRange = log
    ? { min: Math.min(...xs) / 1.6, max: Math.max(...xs) * 1.6 }
    : niceLinearRange(Math.min(...xs), Math.max(...xs));
  const lo = Math.min(...shown.map((pt) => pt.lo)) * 100;
  const hi = Math.max(...shown.map((pt) => pt.hi)) * 100;
  const yMin = Math.max(0, Math.floor((lo - 2) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((hi + 2) / 5) * 5);
  const grid = { left: compact ? 48 : 64, right: compact ? 16 : 32, top: 24, bottom: 64 };

  // The frontier is drawn only on the leaderboard: compared runs have colours of their own.
  const board = shown.every((pt) => pt.run === undefined);
  const front = board ? frontier(shown, xOf, (pt) => pt.acc) : [];
  const onFront = new Set(front);
  const colour = (pt: TradeoffPoint) =>
    pt.run !== undefined ? p.runs[pt.run]! : onFront.has(pt) ? p.frontier : p.ink3;
  const short = (pt: TradeoffPoint) =>
    pt.run === undefined ? String(pt.rank ?? "") : RUN_LETTERS[pt.run]!;
  const name = (pt: TradeoffPoint) =>
    compact ? short(pt) : pt.run === undefined ? pt.label : `${RUN_LETTERS[pt.run]}  ${pt.label}`;
  const weight = (pt: TradeoffPoint) => (onFront.has(pt) ? 600 : 400);

  // The staircase: up to the cheapest frontier run, then along and up through the rest.
  const steps: number[][] = [];
  front.forEach((pt, i) => {
    const y = pt.acc * 100;
    if (i === 0) steps.push([xOf(pt), yMin]);
    steps.push([xOf(pt), y], [i + 1 < front.length ? xOf(front[i + 1]!) : xRange.max, y]);
  });

  // Labels are placed in pixels, frontier first, then by rank, so they never collide or
  // cross the staircase. A frontier label is always shown; any other that fits nowhere is
  // left off (the tooltip and the table still name the run).
  const sides = new Map<TradeoffPoint, LabelSide | null>();
  if (Number.isFinite(width) && height > 0) {
    const plotW = width - grid.left - grid.right;
    const plotH = height - grid.top - grid.bottom;
    const fx = (v: number) =>
      log
        ? Math.log(v / xRange.min) / Math.log(xRange.max / xRange.min)
        : (v - xRange.min) / (xRange.max - xRange.min);
    const px = ([x, y]: number[]) => [
      grid.left + fx(x!) * plotW,
      grid.top + ((yMax - y!) / (yMax - yMin)) * plotH,
    ];
    const lines = steps.slice(1).map((end, i) => {
      const [x0, y0] = px(steps[i]!);
      const [x1, y1] = px(end);
      return {
        x: Math.min(x0!, x1!) - 2,
        y: Math.min(y0!, y1!) - 2,
        w: Math.abs(x1! - x0!) + 4,
        h: Math.abs(y1! - y0!) + 4,
      };
    });
    const order = [...front, ...shown.filter((pt) => !onFront.has(pt))];
    const placed = placeLabels(
      order.map((pt) => {
        const [x, y] = px([xOf(pt), pt.acc * 100]);
        const width = textWidth(name(pt), p.font, weight(pt));
        return { x: x!, y: y!, width, required: onFront.has(pt) };
      }),
      { x: grid.left, y: 0, w: width - grid.left, h: height - grid.bottom },
      lines,
    );
    order.forEach((pt, i) => sides.set(pt, placed[i]!));
  }
  const label = (pt: TradeoffPoint) => {
    const side = sides.has(pt) ? sides.get(pt)! : "right";
    if (side === null) return { show: false };
    return {
      ...labelPosition(side),
      fontWeight: weight(pt),
      color: pt.run === undefined && !onFront.has(pt) ? p.ink2 : p.ink,
    };
  };
  const datum = (pt: TradeoffPoint) => ({
    name: name(pt),
    value: [xOf(pt), pt.acc * 100, pt.lo * 100, pt.hi * 100],
    id: pt.id,
    symbol: pt.run === undefined ? "circle" : RUN_SYMBOLS[pt.run],
    // Runs off the frontier are rings, so the accent stands out.
    itemStyle:
      board && !onFront.has(pt)
        ? { color: p.paper, borderColor: p.ink3, borderWidth: 2 }
        : { color: colour(pt), borderColor: p.paper, borderWidth: 2 },
    label: label(pt),
  });

  const best = front.at(-1);
  const frontierSeries = board
    ? [
        {
          // The corner more accurate and cheaper than every run so far.
          type: "custom",
          silent: true,
          data: [[xOf(front[0]!), best!.acc * 100]],
          renderItem: (
            _params: unknown,
            api: { value: (i: number) => number; coord: (v: number[]) => number[] },
          ) => {
            const [x0, y0] = api.coord([xRange.min, yMax]) as [number, number];
            const [x1, y1] = api.coord([api.value(0), api.value(1)]) as [number, number];
            return {
              type: "rect",
              shape: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
              style: { fill: p.frontier, opacity: 0.12 },
            };
          },
          z: 0,
        },
        {
          type: "line",
          silent: true,
          data: steps,
          symbol: "none",
          lineStyle: { color: p.frontier, width: 2 },
          z: 1,
        },
      ]
    : [];

  return {
    ...base(p),
    grid,
    tooltip: {
      ...(base(p).tooltip as object),
      trigger: "item",
      formatter: (params: { dataIndex: number; seriesType: string }) => {
        const pt = shown[params.dataIndex];
        if (!pt || params.seriesType !== "scatter") return "";
        return (
          `<strong>${escapeHtml(pt.label)}</strong><br>` +
          `Accuracy ${pct(pt.acc)} (95% CI ${pct(pt.lo)} to ${pct(pt.hi)})<br>` +
          escapeHtml(formatX(axis, xOf(pt))) +
          (onFront.has(pt) ? "<br>On the frontier" : "")
        );
      },
    },
    xAxis: valueAxis(p, log ? AXES[axis].name : AXES[axis].name.replace(" (log scale)", ""), {
      type: log ? "log" : "value",
      ...xRange,
      nameGap: 36,
      axisLabel: {
        color: p.ink2,
        fontSize: FONT_SIZE,
        formatter: (v: number) => formatX(axis, v).replace(" tokens", ""),
      },
    }),
    yAxis: valueAxis(p, "Accuracy (%)", { type: "value", min: yMin, max: yMax, nameGap: 44 }),
    series: [
      ...frontierSeries,
      {
        type: "custom",
        silent: true,
        data: shown.map((pt) => ({
          value: [xOf(pt), pt.acc * 100, pt.lo * 100, pt.hi * 100],
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
        symbolSize: SYMBOL,
        data: shown.map(datum),
        cursor: "pointer",
        label: {
          show: true,
          position: "right",
          distance: LABEL_GAP,
          formatter: "{b}",
          color: p.ink,
          fontSize: FONT_SIZE,
        },
        // Only matters when the chart's size is unknown and labels were not placed.
        labelLayout: sides.size ? undefined : { hideOverlap: true },
        emphasis: { scale: 1.3, label: { fontWeight: "bold" } },
        z: 2,
      },
    ],
  };
}
