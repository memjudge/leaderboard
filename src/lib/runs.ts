/** Identity of compared runs (A to D): colour, marker shape and letter always travel together. */

export const MAX_COMPARED = 4;
export const RUN_LETTERS = ["A", "B", "C", "D"] as const;
export const RUN_COLORS = ["--run-a", "--run-b", "--run-c", "--run-d"] as const;
/** ECharts symbol names, in the same order. */
export const RUN_SYMBOLS = ["circle", "rect", "triangle", "diamond"] as const;

const SHAPES = [
  '<circle cx="6" cy="6" r="5.2"/>',
  '<rect x="1" y="1" width="10" height="10" rx="1"/>',
  '<path d="M6 .8 11.4 11H.6z"/>',
  '<path d="M6 .4 11.6 6 6 11.6.4 6z"/>',
];

/** The run's marker as inline SVG, filled with its colour token. */
export function markerSvg(index: number): string {
  return `<svg viewBox="0 0 12 12" aria-hidden="true" style="fill:var(${RUN_COLORS[index]})">${SHAPES[index]}</svg>`;
}

/** Marker plus letter, e.g. for chips and table headers. */
export function runKeyHtml(index: number): string {
  return `<span class="run-key">${markerSvg(index)}${RUN_LETTERS[index]}</span>`;
}
