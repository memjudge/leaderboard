/**
 * Compare page: the runs named in `?runs=` (two to four), shown with their letters,
 * colours and shapes, a side-by-side table, then the shared runs view.
 */
import {
  ci,
  duration,
  fixed,
  ingestionTotalNote,
  int,
  pct,
  rate,
  secs,
  usd,
} from "../lib/format.ts";
import { MAX_COMPARED, runKeyHtml } from "../lib/runs.ts";
import type { RunIndexEntry, RunSummary } from "../lib/site-types.ts";
import { sizeLabel } from "../lib/types.ts";
import { esc } from "./dom.ts";
import { loadRuns, type ViewRun } from "./model.ts";
import { mountRunsView } from "./runs-view.ts";

function chosenIds(index: RunIndexEntry[]): string[] {
  const known = new Set(index.map((r) => r.id));
  const raw = new URLSearchParams(window.location.search).get("runs") ?? "";
  return [...new Set(raw.split(",").map((s) => s.trim()))]
    .filter((id) => known.has(id))
    .slice(0, MAX_COMPARED);
}

function go(ids: string[]): void {
  const url = new URL(window.location.href);
  if (ids.length) url.searchParams.set("runs", ids.join(","));
  else url.searchParams.delete("runs");
  window.location.href = url.toString();
}

export async function initCompare(): Promise<void> {
  const index = JSON.parse(
    document.getElementById("run-index")?.textContent ?? "[]",
  ) as RunIndexEntry[];
  const ids = chosenIds(index);
  renderPicker(index, ids);

  const empty = document.querySelector<HTMLElement>("[data-empty]")!;
  const content = document.querySelector<HTMLElement>("[data-compare]")!;
  if (ids.length < 2) {
    empty.hidden = false;
    return;
  }
  let loaded: Awaited<ReturnType<typeof loadRuns>>;
  try {
    loaded = await loadRuns(ids);
  } catch {
    showWarning("These runs could not be loaded. Reload the page to try again.");
    return;
  }
  const { runs, questions } = loaded;
  warnIfNotComparable(runs.map((r) => r.summary));
  content.hidden = false;
  renderSideBySide(runs);
  mountRunsView(content.querySelector<HTMLElement>("[data-runs-view]")!, runs, questions);
}

function renderPicker(index: RunIndexEntry[], ids: string[]): void {
  const chips = document.querySelector<HTMLElement>("[data-chips]")!;
  chips.innerHTML = ids
    .map((id, k) => {
      const run = index.find((r) => r.id === id)!;
      return `<li class="chip">${runKeyHtml(k)}
        <a href="/runs/${esc(id)}/">${esc(run.label)}</a>
        <span class="muted small">${esc(run.boardTitle)}</span>
        <button type="button" data-remove="${esc(id)}" aria-label="Remove ${esc(run.label)}">×</button></li>`;
    })
    .join("");
  chips.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("button[data-remove]");
    if (button) go(ids.filter((id) => id !== button.dataset.remove));
  });

  const add = document.querySelector<HTMLSelectElement>("[data-add]")!;
  const field = add.closest<HTMLElement>(".field")!;
  if (ids.length >= MAX_COMPARED) {
    field.hidden = true;
    return;
  }
  // Runs on the same board as the first chosen run come first: they compare question by question.
  const firstBoard = index.find((r) => r.id === ids[0])?.board;
  const boards = [...new Set(index.map((r) => r.board))].sort(
    (a, b) => Number(b === firstBoard) - Number(a === firstBoard),
  );
  add.insertAdjacentHTML(
    "beforeend",
    boards
      .map((board) => {
        const runs = index.filter((r) => r.board === board && !ids.includes(r.id));
        if (runs.length === 0) return "";
        return `<optgroup label="${esc(runs[0]!.boardTitle)}">${runs
          .map((r) => `<option value="${esc(r.id)}">${esc(r.label)}, ${pct(r.accuracy)}</option>`)
          .join("")}</optgroup>`;
      })
      .join(""),
  );
  add.addEventListener("change", () => {
    if (add.value) go([...ids, add.value]);
  });
}

function showWarning(text: string): void {
  const el = document.querySelector<HTMLElement>("[data-warning]")!;
  el.textContent = text;
  el.hidden = false;
}

function warnIfNotComparable(runs: RunSummary[]): void {
  const differs = (key: (r: RunSummary) => string | number) => new Set(runs.map(key)).size > 1;
  if (differs((r) => r.board)) {
    const what = [
      differs((r) => r.datasetHash) ? "dataset" : null,
      differs((r) => r.judgeKey) ? "judge" : null,
      differs((r) => r.budget) ? "token budget" : null,
      differs((r) => r.size) ? "results per question" : null,
    ].filter(Boolean);
    showWarning(
      `These runs are on different boards${what.length ? ` (different ${what.join(", ")})` : ""}. ` +
        "Their numbers are not directly comparable, and only questions all of them answered are " +
        "lined up below.",
    );
  }
}

export interface MetricRow {
  label: string;
  value: (r: RunSummary) => string;
  /** Number used to find the best value; null means "do not mark a best". */
  score?: (r: RunSummary) => number | null;
  better?: "higher" | "lower";
  /** A best is marked only when this is the same for every run. */
  kind?: (r: RunSummary) => string;
}

export const ROWS: (MetricRow | string)[] = [
  "Accuracy",
  {
    label: "Accuracy",
    value: (r) => pct(r.metrics.overall.accuracy),
    score: (r) => r.metrics.overall.accuracy,
    better: "higher",
  },
  { label: "95% CI", value: (r) => ci(r.metrics.overall.accuracy_ci95) },
  {
    label: "Correct",
    value: (r) => `${int(r.metrics.overall.correct)} of ${int(r.metrics.overall.questions)}`,
  },
  {
    label: "Abstention accuracy",
    value: (r) => rate(r.metrics.overall.abstention_accuracy),
    score: (r) => r.metrics.overall.abstention_accuracy.value,
    better: "higher",
  },
  "Context",
  {
    label: "Tokens per question",
    value: (r) => int(r.metrics.overall.context_tokens_mean),
    score: (r) => r.metrics.overall.context_tokens_mean,
    better: "lower",
  },
  {
    label: "Tokens, 95th percentile",
    value: (r) => int(r.metrics.overall.context_tokens_p95),
    score: (r) => r.metrics.overall.context_tokens_p95,
    better: "lower",
  },
  {
    label: "Accuracy per 1,000 tokens",
    value: (r) => fixed(r.metrics.overall.efficiency),
    score: (r) => r.metrics.overall.efficiency,
    better: "higher",
  },
  "Speed",
  {
    label: "Retrieval, median",
    value: (r) => secs(r.metrics.overall.retrieval_latency_p50_s),
    score: (r) => r.metrics.overall.retrieval_latency_p50_s,
    better: "lower",
  },
  {
    label: "Retrieval, 95th percentile",
    value: (r) => secs(r.metrics.overall.retrieval_latency_p95_s),
    score: (r) => r.metrics.overall.retrieval_latency_p95_s,
    better: "lower",
  },
  {
    label: "Ingestion, total",
    value: (r) => duration(r.metrics.ingestion.total_s) + ingestionTotalNote(r.metrics.ingestion),
    score: (r) => r.metrics.ingestion.total_s,
    better: "lower",
    // Batch time is wall-clock, per-session time a sum: not comparable (ADR 0017).
    kind: (r) => r.metrics.ingestion.mode ?? "per-session",
  },
  "Checks",
  {
    label: "No verdict (call failed)",
    value: (r) => int(r.metrics.overall.errors),
    score: (r) => r.metrics.overall.errors,
    better: "lower",
  },
  { label: "Flagged by the judge", value: (r) => int(r.metrics.overall.flagged) },
  { label: "Judge", value: (r) => r.judgeLabel },
  { label: "Judge cost", value: (r) => usd(r.metrics.cost.judge_usd) },
  { label: "Results per question", value: (r) => sizeLabel(r.size) },
  { label: "Context budget", value: (r) => `${int(r.budget)} tokens` },
  { label: "Models", value: (r) => r.models || "none recorded" },
];

/** The best score on a row, or null when the row marks no best for these runs. */
export function bestScore(row: MetricRow, runs: RunSummary[]): number | null {
  if (!row.score || !row.better) return null;
  if (row.kind && new Set(runs.map(row.kind)).size > 1) return null;
  const known = runs.map(row.score).filter((s): s is number => s !== null);
  if (known.length < 2 || new Set(known).size < 2) return null;
  return row.better === "higher" ? Math.max(...known) : Math.min(...known);
}

function renderSideBySide(runs: ViewRun[]): void {
  const summaries = runs.map((r) => r.summary);
  const head = summaries
    .map(
      (s, k) =>
        `<th scope="col" class="n">${runKeyHtml(k)}<span class="run-label">${esc(s.label)}</span></th>`,
    )
    .join("");
  const body = ROWS.map((row) => {
    if (typeof row === "string") {
      return `<tr class="group"><th scope="rowgroup" colspan="${summaries.length + 1}">${esc(row)}</th></tr>`;
    }
    const scores = row.score ? summaries.map(row.score) : [];
    const best = bestScore(row, summaries);
    const cells = summaries
      .map((s, k) => {
        const isBest = best !== null && scores[k] === best;
        return `<td class="n${isBest ? " best" : ""}">${esc(row.value(s))}${isBest ? '<span class="visually-hidden"> (best)</span>' : ""}</td>`;
      })
      .join("");
    return `<tr><th scope="row">${esc(row.label)}</th>${cells}</tr>`;
  }).join("");
  document.querySelector<HTMLElement>("[data-side]")!.innerHTML =
    `<table class="data side-table"><thead><tr><th><span class="visually-hidden">Metric</span></th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}
