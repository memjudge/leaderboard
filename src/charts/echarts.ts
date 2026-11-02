/**
 * ECharts setup shared by every chart: only the chart types used, SVG output, colours
 * read from the CSS tokens, redrawn on resize and theme change.
 */
import { CustomChart, LineChart, ScatterChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { RUN_COLORS } from "../lib/runs.ts";

echarts.use([ScatterChart, LineChart, CustomChart, GridComponent, TooltipComponent, SVGRenderer]);

export type Option = echarts.EChartsCoreOption;

export interface Palette {
  paper: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  wash: string;
  runs: string[];
  /** The leaderboard chart's accent for runs on the frontier. */
  frontier: string;
  font: string;
}

export function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    paper: v("--paper"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    ink3: v("--ink-3"),
    rule: v("--rule"),
    wash: v("--wash"),
    runs: RUN_COLORS.map(v),
    frontier: v("--frontier"),
    font: getComputedStyle(document.body).fontFamily,
  };
}

/** Defaults every chart shares: quiet axes, the page font, a tooltip in page colours. */
export function base(p: Palette): Option {
  return {
    animation: false,
    textStyle: { fontFamily: p.font, color: p.ink, fontSize: 13 },
    tooltip: {
      confine: true,
      backgroundColor: p.paper,
      borderColor: p.rule,
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: p.ink, fontFamily: p.font, fontSize: 13 },
      extraCssText: "box-shadow:none;border-radius:4px;max-width:22rem;white-space:normal;",
    },
  };
}

export function valueAxis(p: Palette, name: string, extra: Record<string, unknown> = {}): object {
  return {
    name,
    nameLocation: "middle",
    nameTextStyle: { color: p.ink2, fontSize: 12 },
    axisLine: { show: true, onZero: false, lineStyle: { color: p.ink3 } },
    axisTick: { show: false },
    axisLabel: { color: p.ink2, fontSize: 12 },
    splitLine: { lineStyle: { color: p.rule, width: 1 } },
    ...extra,
  };
}

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export interface Mounted {
  redraw(): void;
  chart: echarts.ECharts;
}

/**
 * Draw `build(palette, width, height)` into `el`, and again on resize or theme change, so a
 * chart can adapt to narrow screens. When `build` returns null the chart is replaced by `empty`.
 */
export function mountChart(
  el: HTMLElement,
  build: (p: Palette, width: number, height: number) => Option | null,
  empty = "Nothing to show.",
): Mounted {
  const chart = echarts.init(el, null, { renderer: "svg" });
  const redraw = () => {
    const option = build(palette(), el.clientWidth, el.clientHeight);
    el.querySelector(".chart-empty")?.remove();
    if (option === null) {
      chart.clear();
      const note = document.createElement("p");
      note.className = "chart-empty muted small";
      note.textContent = empty;
      el.append(note);
      return;
    }
    chart.setOption(option, { notMerge: true });
  };
  redraw();
  let width = el.clientWidth;
  let frame = 0;
  new ResizeObserver(() => {
    if (el.clientWidth === width) return;
    width = el.clientWidth;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      chart.resize();
      redraw();
    });
  }).observe(el);
  window.addEventListener("mj:theme", redraw);
  return { redraw, chart };
}
