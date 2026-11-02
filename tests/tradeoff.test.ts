import { describe, expect, it } from "vitest";
import type { Palette } from "../src/charts/echarts.ts";
import {
  frontier,
  placeLabels,
  tradeoffOption,
  type LabelItem,
  type TradeoffPoint,
} from "../src/charts/tradeoff.ts";

const palette: Palette = {
  paper: "#fff",
  ink: "#000",
  ink2: "#333",
  ink3: "#777",
  rule: "#ddd",
  wash: "#eee",
  runs: ["#00a", "#a50", "#0a5", "#a0a"],
  frontier: "#b70",
  font: "sans-serif",
};
const run = (id: string, acc: number, tokens: number, k?: number): TradeoffPoint => ({
  id,
  label: id,
  acc,
  lo: acc - 0.02,
  hi: acc + 0.02,
  tokens,
  latency: null,
  run: k,
});
type Series = { type: string; data: { itemStyle?: { color: string } }[] };
const seriesOf = (points: TradeoffPoint[]) =>
  (tradeoffOption(points, "tokens", palette)!.series as Series[]).map((s) => s);

describe("tradeoffOption", () => {
  it("draws the frontier on the leaderboard, in the accent", () => {
    const series = seriesOf([run("a", 0.88, 460), run("b", 0.86, 1200)]);
    expect(series.map((s) => s.type)).toEqual(["custom", "line", "custom", "scatter"]);
    const dots = series.at(-1)!.data.map((d) => d.itemStyle);
    expect(dots[0]).toMatchObject({ color: "#b70" });
    expect(dots[1]).toMatchObject({ color: "#fff", borderColor: "#777" });
  });

  it("leaves the frontier off compared runs, which keep their run colours", () => {
    const series = seriesOf([run("a", 0.88, 460, 0), run("b", 0.86, 1200, 1)]);
    expect(series.map((s) => s.type)).toEqual(["custom", "scatter"]);
    const dots = series.at(-1)!.data.map((d) => d.itemStyle?.color);
    expect(dots).toEqual(["#00a", "#a50"]);
  });
});

type P = { id: string; x: number; y: number };
const ids = (ps: P[]) => ps.map((p) => p.id);
const front = (ps: P[]) =>
  ids(
    frontier(
      ps,
      (p) => p.x,
      (p) => p.y,
    ),
  );

describe("frontier", () => {
  it("keeps runs no other run beats on both, in order of spend", () => {
    const ps = [
      { id: "a", x: 6, y: 70 },
      { id: "b", x: 287, y: 85 },
      { id: "c", x: 592, y: 84 },
      { id: "d", x: 1560, y: 88 },
      { id: "e", x: 2800, y: 53 },
    ];
    expect(front(ps)).toEqual(["a", "b", "d"]);
  });

  it("is one run when it is both the cheapest and the most accurate", () => {
    const ps = [
      { id: "a", x: 460, y: 88 },
      { id: "b", x: 1199, y: 86 },
      { id: "c", x: 1357, y: 86 },
    ];
    expect(front(ps)).toEqual(["a"]);
  });

  it("drops ties that are worse on the other axis", () => {
    const ps = [
      { id: "a", x: 100, y: 80 },
      { id: "b", x: 100, y: 85 },
      { id: "c", x: 200, y: 85 },
    ];
    expect(front(ps)).toEqual(["b"]);
  });
});

describe("placeLabels", () => {
  const bounds = { x: 0, y: 0, w: 800, h: 400 };

  it("puts a label on the right when there is room", () => {
    expect(placeLabels([{ x: 100, y: 100, width: 80 }], bounds)).toEqual(["right"]);
  });

  it("moves a label that would cover the next marker", () => {
    // Two runs at the same accuracy, 34 px apart: the first label goes left.
    const items = [
      { x: 300, y: 100, width: 150 },
      { x: 334, y: 100, width: 120 },
    ];
    expect(placeLabels(items, bounds)).toEqual(["left", "right"]);
  });

  it("goes left at the right edge and leaves a label off when no side fits", () => {
    expect(placeLabels([{ x: 780, y: 200, width: 100 }], bounds)).toEqual(["left"]);
    // Markers close on every side and both diagonals of the first run.
    const crowded: LabelItem[] = [
      { x: 100, y: 100, width: 60 },
      { x: 130, y: 100, width: 10 },
      { x: 70, y: 100, width: 10 },
      { x: 100, y: 75, width: 10 },
      { x: 100, y: 125, width: 10 },
      { x: 130, y: 82, width: 10 },
      { x: 130, y: 118, width: 10 },
    ];
    expect(placeLabels(crowded, bounds)[0]).toBeNull();
    // A required label still gets a side.
    crowded[0] = { ...crowded[0]!, required: true };
    expect(placeLabels(crowded, bounds)[0]).toBe("right");
  });

  it("keeps labels off the lines drawn on the chart", () => {
    // A horizontal line through the marker, as the frontier staircase draws.
    const line = { x: 0, y: 98, w: 800, h: 4 };
    expect(placeLabels([{ x: 100, y: 100, width: 80 }], bounds, [line])).toEqual(["top"]);
  });
});
