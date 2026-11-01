/**
 * The question list: question, gold answer and, per run, the verdict, the judge's reason
 * and the retrieved context (loaded only when asked for).
 */
import { date, int, secs } from "../lib/format.ts";
import {
  FLAG_GOLD_SUSPECT,
  FLAG_STALE,
  FLAG_TRUNCATED,
  type Row,
  type Verdict,
} from "../lib/questions.ts";
import { runKeyHtml } from "../lib/runs.ts";
import { esc, fetchJson } from "./dom.ts";
import type { Item, ViewRun } from "./model.ts";

const PAGE = 20;

function verdictChip(v: Verdict): string {
  if (v === 1) return '<span class="verdict correct">Correct</span>';
  if (v === 0) return '<span class="verdict incorrect">Incorrect</span>';
  return '<span class="verdict none">No verdict</span>';
}

function runBlock(item: Item, run: ViewRun, k: number, compared: boolean): string {
  const row = item.rows[k] as Row | undefined;
  if (!row) return "";
  const [, verdict, flags, tokens, seconds, reason, error] = row;
  const notes = [
    `${int(tokens)} tokens`,
    seconds == null ? null : secs(seconds),
    flags & FLAG_TRUNCATED ? "cut to the budget" : null,
    flags & FLAG_GOLD_SUSPECT ? "the judge doubts the gold answer" : null,
    flags & FLAG_STALE ? "contains a stale fact" : null,
  ].filter(Boolean);
  const who = compared
    ? `${runKeyHtml(k)}<span class="run-name">${esc(run.summary.label)}</span>`
    : "";
  return `
    <div class="q-run" data-run="${k}">
      <div class="q-run-head">${who}${verdictChip(verdict)}</div>
      ${error ? `<p class="q-error">${esc(error)}</p>` : ""}
      ${reason ? `<p class="q-reason">${esc(reason)}</p>` : ""}
      <p class="q-notes num">${notes.map((n) => esc(String(n))).join('<span aria-hidden="true">, </span>')}</p>
      <button type="button" class="ctx-toggle" aria-expanded="false" data-ctx="${k}">Show retrieved context</button>
      <pre class="ctx" hidden></pre>
    </div>`;
}

export class QuestionList {
  private items: Item[] = [];
  private shown = 0;
  private readonly list: HTMLElement;
  private readonly more: HTMLButtonElement;
  private readonly count: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly runs: ViewRun[],
    private readonly onShowAll: () => void,
  ) {
    root.innerHTML = `
      <p class="list-count" aria-live="polite"></p>
      <div class="q-list"></div>
      <button type="button" class="button quiet more" hidden></button>`;
    this.count = root.querySelector(".list-count")!;
    this.list = root.querySelector(".q-list")!;
    this.more = root.querySelector(".more")!;
    this.more.addEventListener("click", () => this.page());
    root.addEventListener("click", (e) => this.onClick(e));
  }

  /** Show `items` from the start; `focused` means one question picked in the quilt. */
  show(items: Item[], total: number, focused: boolean): void {
    this.items = items;
    this.shown = 0;
    this.list.replaceChildren();
    if (focused) {
      this.count.innerHTML = `Showing one question. <button type="button" class="link show-all">Show all matching questions</button>`;
    } else if (items.length === 0) {
      this.count.textContent = "No question matches these filters.";
    } else {
      this.count.textContent =
        items.length === total
          ? `${int(total)} questions.`
          : `${int(items.length)} of ${int(total)} questions match.`;
    }
    this.page();
  }

  private page(): void {
    const next = this.items.slice(this.shown, this.shown + PAGE);
    const compared = this.runs.length > 1;
    this.list.insertAdjacentHTML(
      "beforeend",
      next
        .map((item) => {
          const [conv, category, kind, question, gold, askedAt] = item.info;
          const meta = [
            esc(category),
            `<span class="mono">${esc(item.id)}</span>`,
            askedAt ? `asked ${esc(date(askedAt))}` : null,
            kind === "abstention" ? "abstention: correct when the context holds no answer" : null,
          ].filter(Boolean);
          return `
          <article class="q" data-id="${esc(item.id)}" data-conv="${esc(conv)}">
            <h3 class="q-text">${esc(question || item.id)}</h3>
            <p class="q-meta">${meta.join('<span class="sep" aria-hidden="true"></span>')}</p>
            <p class="q-gold"><span class="q-gold-label">Gold answer</span> ${esc(gold)}</p>
            <div class="q-runs${compared ? " compared" : ""}">
              ${this.runs.map((run, k) => runBlock(item, run, k, compared)).join("")}
            </div>
          </article>`;
        })
        .join(""),
    );
    this.shown += next.length;
    const left = this.items.length - this.shown;
    this.more.hidden = left <= 0;
    this.more.textContent = `Show ${Math.min(PAGE, left)} more`;
  }

  private onClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (target.closest(".show-all")) {
      this.onShowAll();
      return;
    }
    const toggle = target.closest<HTMLButtonElement>(".ctx-toggle");
    if (toggle) void this.toggleContext(toggle);
  }

  private async toggleContext(button: HTMLButtonElement): Promise<void> {
    const block = button.closest(".q-run")!;
    const pre = block.querySelector<HTMLPreElement>(".ctx")!;
    const open = button.getAttribute("aria-expanded") === "true";
    if (open) {
      pre.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.textContent = "Show retrieved context";
      return;
    }
    const id = button.closest<HTMLElement>(".q")!.dataset.id!;
    const run = this.runs[Number(button.dataset.ctx)]!;
    if (!pre.dataset.loaded) {
      button.textContent = "Loading context…";
      try {
        const chunk = Math.floor(run.position.get(id)! / run.chunkSize);
        const contexts = await fetchJson<Record<string, string>>(
          `/data/ctx/${run.summary.id}/${chunk}.json`,
        );
        const text = contexts[id] ?? "";
        pre.textContent = text || "The system returned no context for this question.";
        pre.dataset.loaded = "1";
      } catch {
        button.textContent = "Show retrieved context";
        pre.hidden = false;
        pre.textContent = "The context could not be loaded. Check your connection and try again.";
        return;
      }
    }
    pre.hidden = false;
    button.setAttribute("aria-expanded", "true");
    button.textContent = "Hide retrieved context";
  }
}
