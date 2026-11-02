/**
 * Everything below a run's headline, shared by the run page (one run) and the compare
 * page (two to four): head to head, charts, the verdict quilt and the question list.
 */
import { categoryChartHeight, categoryOption } from "../charts/categories.ts";
import { mountChart } from "../charts/echarts.ts";
import { latencyOption } from "../charts/latency.ts";
import { tradeoffOption, type TradeoffPoint } from "../charts/tradeoff.ts";
import { int, pct, pValue } from "../lib/format.ts";
import { RUN_COLORS, RUN_LETTERS, runKeyHtml } from "../lib/runs.ts";
import type { QuestionsFile } from "../lib/site-types.ts";
import { mcnemarExact } from "../lib/stats.ts";
import { esc } from "./dom.ts";
import { QuestionList } from "./list.ts";
import {
  buildItems,
  loadRuns,
  matches,
  outcomeOptions,
  type Filter,
  type Item,
  type ViewRun,
} from "./model.ts";
import { renderQuilt } from "./quilt.ts";

const motion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

export function mountRunsView(root: HTMLElement, runs: ViewRun[], questions: QuestionsFile): void {
  const compared = runs.length > 1;
  const view = (name: string) => root.querySelector<HTMLElement>(`[data-view="${name}"]`);
  const labels = runs.map((r) => r.summary.label);
  const items = buildItems(runs, questions);
  const categories = [
    ...new Set(runs.flatMap((r) => Object.keys(r.summary.metrics.by_category))),
  ].sort();

  mountCharts(view, runs, categories, compared);
  if (compared) renderCategoryTable(view("category-table"), runs, categories);

  const filter: Filter = { outcome: "all", category: "", search: "" };
  let focus: string | null = null;
  const listEl = view("list");
  const quiltEl = view("quilt");
  if (!listEl || !quiltEl) return;

  renderLegend(view("legend"), labels.length);
  const quilt = renderQuilt(quiltEl, items, labels, (id) => {
    focus = id;
    refresh();
    listEl.scrollIntoView({ behavior: motion(), block: "start" });
  });
  const list = new QuestionList(listEl, runs, () => {
    focus = null;
    refresh();
  });

  const refresh = () => {
    const matching = items.filter((i) => matches(i, filter));
    const keep = new Set(matching.map((i) => i.id));
    quilt.setDimmed((item) => !keep.has(item.id));
    quilt.setSelected(focus);
    if (focus)
      list.show(
        items.filter((i) => i.id === focus),
        items.length,
        true,
      );
    else list.show(matching, items.length, false);
  };

  const outcome = renderFilters(view("filters"), labels, categories, (change) => {
    Object.assign(filter, change);
    focus = null;
    refresh();
  });

  if (compared) {
    renderHeadToHead(view("h2h"), runs, items, (value) => {
      filter.outcome = value;
      if (outcome) outcome.value = value;
      focus = null;
      refresh();
      quiltEl.scrollIntoView({ behavior: motion(), block: "start" });
    });
  }
  refresh();
}

function mountCharts(
  view: (name: string) => HTMLElement | null,
  runs: ViewRun[],
  categories: string[],
  compared: boolean,
): void {
  const runIndex = (k: number) => (compared ? k : null);
  const categoriesEl = view("categories");
  if (categoriesEl) {
    categoriesEl.style.height = `${categoryChartHeight(categories.length)}px`;
    mountChart(categoriesEl, (p) =>
      categoryOption(
        categories,
        runs.map((r, k) => ({
          label: r.summary.label,
          run: runIndex(k),
          byCategory: r.summary.metrics.by_category,
        })),
        p,
      ),
    );
  }
  const latencyEl = view("latency");
  if (latencyEl) {
    mountChart(
      latencyEl,
      (p) =>
        latencyOption(
          runs.map((r, k) => ({
            label: r.summary.label,
            run: runIndex(k),
            seconds: [...r.rows.values()]
              .map((row) => row[4])
              .filter((s): s is number => s !== null),
          })),
          p,
        ),
      "No run reported retrieval times.",
    );
  }
  const tradeoffEl = view("tradeoff");
  if (tradeoffEl) {
    const points: TradeoffPoint[] = runs.map((r, k) => {
      const o = r.summary.metrics.overall;
      return {
        id: r.summary.id,
        label: r.summary.label,
        acc: o.accuracy,
        lo: o.accuracy_ci95[0],
        hi: o.accuracy_ci95[1],
        tokens: o.context_tokens_mean,
        latency: o.retrieval_latency_p50_s,
        run: k,
      };
    });
    mountChart(tradeoffEl, (p, width, height) =>
      tradeoffOption(points, "tokens", p, width, height),
    );
  }
}

/** Compare page: accuracy per category and run, the text view of the dot plot. */
function renderCategoryTable(el: HTMLElement | null, runs: ViewRun[], categories: string[]): void {
  if (!el) return;
  const head = runs.map((_, k) => `<th class="n" scope="col">${runKeyHtml(k)}</th>`).join("");
  const body = categories
    .map((c) => {
      const cells = runs
        .map((r) => {
          const m = r.summary.metrics.by_category[c];
          return m
            ? `<td class="n">${pct(m.accuracy)}<span class="cell-sub">${int(m.correct)} of ${int(m.questions)}</span></td>`
            : '<td class="n muted">not run</td>';
        })
        .join("");
      return `<tr><th scope="row">${esc(c)}</th>${cells}</tr>`;
    })
    .join("");
  el.innerHTML = `<table class="data category-table"><caption class="visually-hidden">Accuracy by category</caption><thead><tr><th>Category</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderLegend(el: HTMLElement | null, runs: number): void {
  if (!el) return;
  if (runs === 1) {
    el.classList.add("q1");
    el.innerHTML = `
      <span><i class="cell sample r0" aria-hidden="true"></i>Correct</span>
      <span><i class="cell sample" aria-hidden="true"></i>Incorrect</span>
      <span><i class="cell sample x0" aria-hidden="true"></i>No verdict (call failed)</span>
      <span><i class="cell sample flag" aria-hidden="true"></i>Flagged by the judge</span>`;
    return;
  }
  const layout =
    runs === 4
      ? "A top left, B top right, C bottom left, D bottom right"
      : `${RUN_LETTERS.slice(0, runs).join(", ")} from left to right`;
  const all = Array.from({ length: runs }, (_, k) => `r${k}`).join(" ");
  el.innerHTML = `
    <span class="q${runs} legend-sample"><i class="cell sample ${all}" aria-hidden="true"></i>All correct</span>
    <span class="q${runs} legend-sample"><i class="cell sample r0" aria-hidden="true"></i>Only A correct</span>
    <span class="q${runs} legend-sample"><i class="cell sample" aria-hidden="true"></i>None correct</span>
    <span class="legend-note">Each square is split into one part per run (${layout}).</span>`;
}

function renderFilters(
  el: HTMLElement | null,
  labels: string[],
  categories: string[],
  onChange: (change: Partial<Filter>) => void,
): HTMLSelectElement | null {
  if (!el) return null;
  const pairs =
    labels.length > 1
      ? labels.flatMap((_, i) =>
          labels.flatMap((__, j) =>
            i === j
              ? []
              : [[`beat:${i}:${j}`, `${RUN_LETTERS[i]} correct, ${RUN_LETTERS[j]} not`] as const],
          ),
        )
      : [];
  el.innerHTML = `
    <label class="field">Show
      <select data-f="outcome">
        ${outcomeOptions(labels.length)
          .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
          .join("")}
        ${
          pairs.length
            ? `<optgroup label="Head to head">${pairs
                .map(([v, l]) => `<option value="${v}">${esc(l)}</option>`)
                .join("")}</optgroup>`
            : ""
        }
      </select>
    </label>
    <label class="field">Category
      <select data-f="category">
        <option value="">All categories</option>
        ${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
      </select>
    </label>
    <label class="field search">Search
      <input type="search" data-f="search" placeholder="Words in a question, answer or judge reason" />
    </label>`;
  const outcome = el.querySelector<HTMLSelectElement>('[data-f="outcome"]');
  outcome?.addEventListener("change", () => onChange({ outcome: outcome.value }));
  const category = el.querySelector<HTMLSelectElement>('[data-f="category"]');
  category?.addEventListener("change", () => onChange({ category: category.value }));
  const search = el.querySelector<HTMLInputElement>('[data-f="search"]');
  let timer: number | undefined;
  search?.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => onChange({ search: search.value }), 150);
  });
  return outcome;
}

function renderHeadToHead(
  el: HTMLElement | null,
  runs: ViewRun[],
  items: Item[],
  onPick: (outcome: string) => void,
): void {
  if (!el) return;
  const rows: string[] = [];
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const onlyI = items.filter((it) => it.verdicts[i] === 1 && it.verdicts[j] !== 1).length;
      const onlyJ = items.filter((it) => it.verdicts[j] === 1 && it.verdicts[i] !== 1).length;
      const same = items.length - onlyI - onlyJ;
      const p = mcnemarExact(onlyI, onlyJ);
      rows.push(`
        <li class="pair">
          <p class="pair-names">${runKeyHtml(i)} <span>${esc(runs[i]!.summary.label)}</span>
            <span class="vs">and</span> ${runKeyHtml(j)} <span>${esc(runs[j]!.summary.label)}</span></p>
          <div class="pair-bar" aria-hidden="true">
            <span style="flex:${onlyI};background:var(${RUN_COLORS[i]})"></span>
            <span class="same" style="flex:${same}"></span>
            <span style="flex:${onlyJ};background:var(${RUN_COLORS[j]})"></span>
          </div>
          <div class="pair-counts">
            <button type="button" class="count" data-outcome="beat:${i}:${j}">
              <strong class="num">${int(onlyI)}</strong> correct only for ${RUN_LETTERS[i]}</button>
            <span class="agree num">${int(same)} the same</span>
            <button type="button" class="count" data-outcome="beat:${j}:${i}">
              <strong class="num">${int(onlyJ)}</strong> correct only for ${RUN_LETTERS[j]}</button>
            <span class="p num">p = ${pValue(p)}</span>
          </div>
        </li>`);
    }
  }
  el.innerHTML = `<ul class="pairs">${rows.join("")}</ul>`;
  el.addEventListener("click", (e) => {
    const button = (e.target as Element).closest<HTMLButtonElement>("button[data-outcome]");
    if (button) onPick(button.dataset.outcome!);
  });
}

/** Run page: load the run named in `data-run-ids` and draw its views. */
export async function mountFromPage(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-runs-view][data-mode="run"]');
  if (!root) return;
  const ids = JSON.parse(root.dataset.runIds ?? "[]") as string[];
  if (ids.length === 0) return;
  try {
    const { runs, questions } = await loadRuns(ids);
    mountRunsView(root, runs, questions);
  } catch {
    const list = root.querySelector<HTMLElement>('[data-view="list"]');
    if (list) {
      list.textContent =
        "The per-question results could not be loaded. Reload the page to try again.";
    }
  }
}
