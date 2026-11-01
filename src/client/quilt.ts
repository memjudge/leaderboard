/**
 * The verdict quilt: one small square per question, grouped by category. With one run a
 * square is filled (correct), hollow (incorrect) or hatched (no verdict); with two to four
 * runs it is split into one part per run, filled in that run's colour where it was correct.
 * Arrow keys move between squares; Enter opens the question in the list.
 */
import { RUN_LETTERS } from "../lib/runs.ts";
import { esc, truncate } from "./dom.ts";
import type { Item } from "./model.ts";

export interface Quilt {
  setDimmed(isDimmed: (item: Item) => boolean): void;
  setSelected(id: string | null): void;
}

const VERDICT_WORD = { 1: "correct", 0: "incorrect", null: "no verdict" } as const;

function describe(item: Item, labels: string[]): string {
  const verdicts =
    labels.length === 1
      ? VERDICT_WORD[`${item.verdicts[0]}` as "1" | "0" | "null"]
      : item.verdicts
          .map((v, k) => `${RUN_LETTERS[k]} ${VERDICT_WORD[`${v}` as "1" | "0" | "null"]}`)
          .join(", ");
  return `${item.id}, ${item.info[1]}: ${verdicts}${item.flagged ? ", flagged by the judge" : ""}`;
}

export function renderQuilt(
  root: HTMLElement,
  items: Item[],
  labels: string[],
  onOpen: (id: string) => void,
): Quilt {
  const runs = labels.length;
  root.replaceChildren();
  root.classList.add("quilt", `q${runs}`);
  const tip = document.createElement("div");
  tip.className = "quilt-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");

  const cells: HTMLButtonElement[] = [];
  const byId = new Map<string, Item>();
  const categories = [...new Set(items.map((i) => i.info[1]))];
  for (const category of categories) {
    const group = items.filter((i) => i.info[1] === category);
    const section = document.createElement("div");
    section.className = "quilt-group";
    const correct = group.filter((i) => i.verdicts[0] === 1).length;
    const summary =
      runs === 1
        ? `${correct} of ${group.length} correct`
        : `${group.length} ${group.length === 1 ? "question" : "questions"}`;
    section.innerHTML = `<h3 class="quilt-label">${esc(category)} <span class="muted num">${summary}</span></h3>`;
    const grid = document.createElement("div");
    grid.className = "quilt-grid";
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", `${category}, ${summary}`);
    for (const item of group) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "cell";
      item.verdicts.forEach((v, k) => {
        if (v === 1) cell.classList.add(`r${k}`);
        else if (v === null) cell.classList.add(`x${k}`);
      });
      if (item.flagged) cell.classList.add("flag");
      cell.dataset.id = item.id;
      cell.tabIndex = cells.length === 0 ? 0 : -1;
      cell.setAttribute("aria-label", describe(item, labels));
      grid.append(cell);
      cells.push(cell);
      byId.set(item.id, item);
    }
    section.append(grid);
    root.append(section);
  }
  root.append(tip);

  let current = 0;
  const focusCell = (index: number) => {
    const next = cells[index];
    if (!next) return;
    cells[current]!.tabIndex = -1;
    next.tabIndex = 0;
    current = index;
    next.focus();
  };

  /** The nearest square in the next row up or down, by horizontal position. */
  const vertical = (from: number, dir: 1 | -1): number => {
    const origin = cells[from]!.getBoundingClientRect();
    let best = from;
    let bestDx = Infinity;
    let rowDy = Infinity;
    for (let i = from + dir; i >= 0 && i < cells.length; i += dir) {
      const r = cells[i]!.getBoundingClientRect();
      const dy = (r.top - origin.top) * dir;
      if (dy <= 1) continue;
      if (dy > rowDy + 1) break;
      rowDy = dy;
      const dx = Math.abs(r.left - origin.left);
      if (dx < bestDx) {
        best = i;
        bestDx = dx;
      }
    }
    return best;
  };

  const showTip = (cell: HTMLButtonElement) => {
    const item = byId.get(cell.dataset.id ?? "");
    if (!item) return;
    const lines =
      runs === 1
        ? ""
        : `<span class="tip-runs">${item.verdicts
            .map(
              (v, k) =>
                `<span>${RUN_LETTERS[k]}: ${VERDICT_WORD[`${v}` as "1" | "0" | "null"]}</span>`,
            )
            .join("")}</span>`;
    tip.innerHTML =
      `<span class="tip-q">${esc(truncate(item.info[3] || item.id, 150))}</span>` +
      `<span class="tip-meta">${esc(item.info[1])}, ${esc(item.id)}</span>${lines}`;
    tip.hidden = false;
    const box = root.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const left = Math.min(Math.max(c.left - box.left - 12, 0), Math.max(0, box.width - 320));
    tip.style.left = `${left}px`;
    tip.style.top = `${c.top - box.top - tip.offsetHeight - 8}px`;
  };

  root.addEventListener("click", (e) => {
    const cell = (e.target as Element).closest<HTMLButtonElement>("button.cell");
    if (!cell) return;
    focusCell(cells.indexOf(cell));
    onOpen(cell.dataset.id!);
  });
  root.addEventListener("keydown", (e) => {
    const index = cells.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    const moves: Record<string, () => number> = {
      ArrowRight: () => Math.min(index + 1, cells.length - 1),
      ArrowLeft: () => Math.max(index - 1, 0),
      ArrowDown: () => vertical(index, 1),
      ArrowUp: () => vertical(index, -1),
      Home: () => 0,
      End: () => cells.length - 1,
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    focusCell(move());
  });
  root.addEventListener("mouseover", (e) => {
    const cell = (e.target as Element).closest<HTMLButtonElement>("button.cell");
    if (cell) showTip(cell);
  });
  root.addEventListener("mouseleave", () => (tip.hidden = true));
  root.addEventListener("focusin", (e) => {
    const cell = (e.target as Element).closest<HTMLButtonElement>("button.cell");
    if (cell) showTip(cell);
  });
  root.addEventListener("focusout", () => (tip.hidden = true));

  return {
    setDimmed(isDimmed) {
      for (const cell of cells) {
        const item = byId.get(cell.dataset.id!)!;
        cell.classList.toggle("dim", isDimmed(item));
      }
    },
    setSelected(id) {
      for (const cell of cells) cell.classList.toggle("selected", cell.dataset.id === id);
    },
  };
}
