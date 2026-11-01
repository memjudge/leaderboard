/** Leaderboard page: the trade-off chart, table sorting and filtering, and picking runs to compare. */
import { mountChart } from "../charts/echarts.ts";
import {
  missingOn,
  tradeoffOption,
  type TradeoffAxis,
  type TradeoffPoint,
} from "../charts/tradeoff.ts";
import { MAX_COMPARED } from "../lib/runs.ts";
import { API } from "./api.ts";

type SortKey = "rank" | "acc" | "tokens" | "eff" | "p50";
/** Direction that puts the best value first. */
const BEST_FIRST: Record<SortKey, 1 | -1> = {
  rank: 1,
  acc: -1,
  tokens: 1,
  eff: -1,
  p50: 1,
};

export function initBoard(): void {
  initVariantSelect();
  initTradeoff();
  initTable();
  void initRejudges();
}

/** Older runs' Re-judge buttons show re-judges already running or done (runner state). */
async function initRejudges(): Promise<void> {
  const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-rejudge]")];
  if (links.length === 0) return;
  let runs: Record<string, { state: string; run_id: string }>;
  try {
    const resp = await fetch(`${API}/rejudges`);
    if (!resp.ok) return;
    ({ runs } = (await resp.json()) as { runs: typeof runs });
  } catch {
    return; // the runner is unreachable: the buttons stay as they are
  }
  for (const link of links) {
    const state = runs[link.dataset.rejudge!]?.state;
    if (state !== "active" && state !== "done") continue;
    link.textContent = state === "active" ? "Re-judging…" : "Re-judged: published soon";
    link.setAttribute("aria-disabled", "true");
    link.removeAttribute("href");
  }
}

function initVariantSelect(): void {
  const select = document.querySelector<HTMLSelectElement>("[data-board-variant]");
  select?.addEventListener("change", () => (window.location.href = select.value));
}

function initTradeoff(): void {
  const el = document.querySelector<HTMLElement>("[data-tradeoff]");
  const data = document.getElementById("board-data");
  if (!el || !data) return;
  const { points } = JSON.parse(data.textContent ?? "{}") as { points: TradeoffPoint[] };
  const note = document.querySelector<HTMLElement>("[data-tradeoff-note]");
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-axis]")];
  let axis: TradeoffAxis = "tokens";

  const mounted = mountChart(
    el,
    (p, width) => tradeoffOption(points, axis, p, width),
    "No run reported this yet.",
  );
  mounted.chart.on("click", (params) => {
    const id = (params.data as { id?: string } | undefined)?.id;
    if (id) window.location.href = `/runs/${id}/`;
  });
  const describe = () => {
    const missing = missingOn(points, axis);
    if (note) {
      note.textContent =
        missing === 0
          ? ""
          : `${missing} of ${points.length} runs did not report this, so they are not shown.`;
    }
  };
  describe();
  for (const button of buttons) {
    button.addEventListener("click", () => {
      axis = button.dataset.axis as TradeoffAxis;
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      mounted.redraw();
      describe();
    });
  }
}

function initTable(): void {
  const table = document.querySelector<HTMLTableElement>(".board-table");
  const body = table?.tBodies[0];
  if (!table || !body) return;
  // Sorting reorders the ranked runs; earlier seasons' runs stay below them.
  const rows = [...body.rows].filter((r) => r.dataset.system !== undefined);
  const older = [...(table.tBodies[1]?.rows ?? [])].filter((r) => r.dataset.system !== undefined);

  const sortBy = (key: SortKey) => {
    const value = (row: HTMLTableRowElement) => {
      const raw = row.dataset[key] ?? "";
      return raw === "" ? null : Number(raw);
    };
    const sorted = [...rows].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null) return vb === null ? 0 : 1;
      if (vb === null) return -1;
      return (va - vb) * BEST_FIRST[key] || Number(a.dataset.rank) - Number(b.dataset.rank);
    });
    body.append(...sorted);
    for (const th of table.querySelectorAll<HTMLElement>("th[data-sort]")) {
      if (th.dataset.sort === key) {
        th.setAttribute("aria-sort", BEST_FIRST[key] === 1 ? "ascending" : "descending");
      } else th.removeAttribute("aria-sort");
    }
    const select = document.querySelector<HTMLSelectElement>("[data-sort-select]");
    if (select && [...select.options].some((o) => o.value === key)) select.value = key;
  };
  for (const th of table.querySelectorAll<HTMLElement>("th[data-sort]")) {
    th.querySelector("button")?.addEventListener("click", () => sortBy(th.dataset.sort as SortKey));
  }
  document
    .querySelector<HTMLSelectElement>("[data-sort-select]")
    ?.addEventListener("change", (e) => sortBy((e.target as HTMLSelectElement).value as SortKey));

  const filter = document.querySelector<HTMLSelectElement>("[data-system-filter]");
  filter?.addEventListener("change", () => {
    for (const row of [...rows, ...older]) {
      row.hidden = filter.value !== "" && row.dataset.system !== filter.value;
    }
  });

  initCompareSelection([...rows, ...older]);
}

function initCompareSelection(rows: HTMLTableRowElement[]): void {
  const boxes = rows
    .map((r) => r.querySelector<HTMLInputElement>("input[data-compare]"))
    .filter((b): b is HTMLInputElement => b !== null);
  const bar = document.querySelector<HTMLElement>("[data-compare-bar]");
  const count = document.querySelector<HTMLElement>("[data-compare-count]");
  const link = document.querySelector<HTMLAnchorElement>("[data-compare-link]");
  let picked: string[] = [];

  const update = () => {
    for (const box of boxes) {
      box.checked = picked.includes(box.dataset.compare!);
      box.disabled = !box.checked && picked.length >= MAX_COMPARED;
      box.closest("tr")?.classList.toggle("selected", box.checked);
    }
    if (!bar || !count || !link) return;
    bar.hidden = picked.length === 0;
    const more = picked.length < 2 ? " Pick at least one more." : "";
    const full = picked.length === MAX_COMPARED ? " That is the most you can compare." : "";
    count.textContent = `${picked.length} selected.${more}${full}`;
    link.href = `/compare/?runs=${picked.join(",")}`;
    link.textContent = `Compare ${picked.length} runs`;
    link.setAttribute("aria-disabled", String(picked.length < 2));
  };
  for (const box of boxes) {
    box.addEventListener("change", () => {
      const id = box.dataset.compare!;
      picked = box.checked ? [...picked, id] : picked.filter((p) => p !== id);
      update();
    });
  }
  link?.addEventListener("click", (e) => {
    if (picked.length < 2) e.preventDefault();
  });
  document.querySelector("[data-compare-clear]")?.addEventListener("click", () => {
    picked = [];
    update();
  });
  update();
}
