/**
 * The /run page: GitHub sign-in, the hosted-run form and the run's live status, all
 * against the Runner API. Keys typed here go straight to the API over HTTPS and are
 * never stored in the browser; the session token stays in this tab's sessionStorage.
 */
import { commitRef, shortDigest } from "../lib/build.ts";
import { datasetName, modelsLabel } from "../lib/naming.ts";
import {
  type ConnectorOption,
  costLine,
  errorMessage,
  isActive,
  loginError,
  logText,
  ownLogin,
  readFragment,
  rejudgeBody,
  rejudgeCostLine,
  resumeBody,
  resumeNote,
  type RunLog,
  type RunnerOptions,
  type RunStatus,
  runSteps,
  runSummary,
  shownStatus,
  signInUrl,
  startBody,
  startedText,
  stateText,
} from "../lib/run.ts";
import { seasonName, type Season } from "../lib/seasons.ts";
import { SIZES, type SignedResult } from "../lib/types.ts";
import { API } from "./api.ts";
import { esc } from "./dom.ts";

const TOKEN_KEY = "mj-run-token";
const RUN_KEY = "mj-run";
const REJUDGE_KEY = "mj-rejudge"; // the run to re-judge, kept across the GitHub sign-in
const LOGIN_KEY = "mj-login"; // the id of the sign-in this browser started
const POLL_MS = 10_000;
const ANOTHER_SYSTEM = "another";

interface Remembered {
  id: string;
}

class ApiError extends Error {}

let token: string | null = null;
let options: RunnerOptions | null = null;
let pollTimer: number | undefined;
let runs: RunStatus[] = []; // the signed-in user's, newest first
let shown: string | null = null; // the run in the status panel
const live = new Set<string>(); // finished runs whose result page the site already serves

const el = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null; // storage blocked: works for this page view only
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // storage blocked
  }
}

const session = () => sessionStorage;
const local = () => localStorage;

/** The id the sign-in link carries. Kept in localStorage, so a sign-in opened in another
 * tab still matches; a new one is made after each sign-in. */
function pendingLogin(): string {
  let id = read(local, LOGIN_KEY);
  if (!id) {
    id = crypto.randomUUID();
    write(local, LOGIN_KEY, id);
  }
  return id;
}

function remembered(): Remembered | null {
  try {
    const value = JSON.parse(read(local, RUN_KEY) ?? "null") as Remembered | null;
    return value && typeof value.id === "string" ? value : null;
  } catch {
    return null;
  }
}

function notice(text: string | null): void {
  const box = el("[data-notice]");
  box.textContent = text ?? "";
  box.hidden = !text;
}

function show(panel: "signin" | "start" | "status" | "rejudge"): void {
  el("[data-loading]").hidden = true;
  el("[data-signin]").hidden = panel !== "signin";
  el("[data-start]").hidden = panel !== "start";
  el("[data-status]").hidden = panel !== "status";
  el("[data-rejudge-form]").hidden = panel !== "rejudge";
}

function signedOut(message: string | null): void {
  token = null;
  write(session, TOKEN_KEY, null);
  clearTimeout(pollTimer);
  notice(message);
  show("signin");
  el("[data-runs]").hidden = true;
  el("[data-account]").hidden = true;
}

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Could not reach the runner. Check your connection and try again.");
  }
  const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
  if (res.status === 401) {
    signedOut("Your sign-in has expired. Sign in again.");
    throw new ApiError("Your sign-in has expired.");
  }
  if (!res.ok) throw new ApiError(errorMessage(data.detail, res.status));
  return data as T;
}

function showError(selector: string, error: unknown): void {
  const box = el(selector);
  box.textContent = error instanceof Error ? error.message : String(error);
  box.hidden = false;
}

function keyField(name: string, label: string): string {
  return `<label class="field">${esc(label)}
    <input type="password" name="${esc(name)}" autocomplete="off" spellcheck="false" required />
  </label>`;
}

function connectorById(id: string): ConnectorOption | undefined {
  return options?.connectors.find((c) => c.id === id);
}

function connectorName(id: string, preset?: string | null): string {
  const name = connectorById(id)?.target ?? id;
  return preset ? `${name} (${preset})` : name;
}

// --- the start form -------------------------------------------------------------

function selected(form: HTMLFormElement, name: string): string {
  return (form.elements.namedItem(name) as RadioNodeList | HTMLSelectElement | null)?.value ?? "";
}

/** Whether every required confirmation (terms, keys made for the run) is ticked. */
function agreed(form: HTMLFormElement): boolean {
  return [...form.querySelectorAll<HTMLInputElement>("[data-agree]")].every((c) => c.checked);
}

function updateForm(form: HTMLFormElement): void {
  if (!options) return;
  const connector = connectorById(selected(form, "connector"));
  const keys = connector?.required_keys ?? [];
  const presets = connector?.presets ?? [];
  const models = connector?.models;
  const used = modelsLabel(
    models === "vendor"
      ? models
      : models?.[presets.length ? selected(form, "preset") || (presets[0] ?? "") : ""],
  );
  el("[data-connector-note]").textContent = connector
    ? `${connector.label === "vendor-maintained" ? "Connector maintained by the vendor" : "Connector written by MemJudge"}.${used ? ` Models: ${used}.` : ""}${keys.length ? "" : " It runs inside the runner and needs no key."}`
    : "";
  const presetSelect = el<HTMLSelectElement>("[data-preset]");
  if (presetSelect.dataset.for !== connector?.id) {
    presetSelect.innerHTML = presets
      .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
      .join("");
    presetSelect.dataset.for = connector?.id ?? "";
  }
  el("[data-preset-field]").hidden = presets.length === 0;
  const keysBox = el("[data-keys]");
  const wanted = keys.map((k) => `key:${k}`).join(",");
  if (keysBox.dataset.for !== wanted) {
    keysBox.innerHTML = keys.map((k) => keyField(`key:${k}`, k)).join("");
    keysBox.dataset.for = wanted;
  }
  const route = options.judge_routes.find((r) => r.route === selected(form, "route"));
  const judgeBox = el("[data-judge-key]");
  if (route && judgeBox.dataset.for !== route.route) {
    judgeBox.innerHTML = keyField("judge_key", route.key_name);
    judgeBox.dataset.for = route.route;
  }
  el("[data-system]").hidden = selected(form, "affiliated") !== "yes";
  el<HTMLButtonElement>("[data-submit]").disabled = !agreed(form);
  const estimate = options.estimates[selected(form, "dataset")]?.[route?.route ?? ""];
  el("[data-cost]").textContent = costLine(estimate, options.budget_tokens);
}

function renderForm(form: HTMLFormElement, opts: RunnerOptions): void {
  el("[data-datasets]").innerHTML = opts.datasets
    .map(
      (d, i) => `<label class="choice">
        <input type="radio" name="dataset" value="${esc(d.name)}"${i === 0 ? " checked" : ""} />
        <span>${esc(datasetName(d.name))}
          <span class="muted">${d.conversations.toLocaleString("en-GB")} conversations,
          ${d.questions.toLocaleString("en-GB")} questions${d.license ? `, licence ${esc(d.license)}` : ""}</span>
        </span>
      </label>`,
    )
    .join("");
  el<HTMLSelectElement>("[data-systems]").innerHTML = [
    '<option value="" disabled selected>Choose a system</option>',
    ...opts.affiliations.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`),
    `<option value="${ANOTHER_SYSTEM}">Another memory system</option>`,
  ].join("");
  el<HTMLSelectElement>("[data-connector]").innerHTML = opts.connectors
    .map((c) => `<option value="${esc(c.id)}">${esc(c.target)}</option>`)
    .join("");
  el("[data-routes]").innerHTML = routeChoices(opts);
  form.addEventListener("change", () => updateForm(form));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void startRun(form);
  });
  updateForm(form);
}

function routeChoices(opts: RunnerOptions): string {
  return opts.judge_routes
    .map(
      (r, i) => `<label class="choice">
        <input type="radio" name="route" value="${esc(r.route)}"${i === 0 ? " checked" : ""} />
        <span>${r.route === "openrouter" ? "OpenRouter, pinned to Anthropic" : "Anthropic, direct"}
          <span class="muted mono">${esc(r.spec)}</span>
        </span>
      </label>`,
    )
    .join("");
}

// --- the re-judge form ----------------------------------------------------------

function seasonsData(): Season[] {
  return JSON.parse(document.getElementById("seasons-data")?.textContent ?? "[]") as Season[];
}

/** Show the form to re-judge published run ``id``; false if the site does not list it. */
async function showRejudge(id: string, opts: RunnerOptions): Promise<boolean> {
  let envelope: { payload: SignedResult };
  try {
    const resp = await fetch(`/results/${encodeURIComponent(id)}.json`, { cache: "no-store" });
    if (!resp.ok) return false;
    envelope = (await resp.json()) as { payload: SignedResult };
  } catch {
    return false;
  }
  const r = envelope.payload;
  const seasons = seasonsData();
  el("[data-rejudge-about]").innerHTML =
    `<strong>${esc(connectorName(r.connector.id))} on ${esc(datasetName(r.dataset.name))}</strong>, ` +
    `run <span class="mono">${esc(r.run_id)}</span>: from ${esc(seasonName(seasons, r.judge.season))} ` +
    `into ${esc(seasonName(seasons, opts.judge_season))}.`;
  // Both result sizes are judged again (memjudge ADR 0018).
  const spent = SIZES.map((size) => r.metrics[size].cost.judge_usd);
  el("[data-rejudge-cost]").textContent = rejudgeCostLine(
    spent.some((v) => v == null) ? null : spent.reduce((a, b) => a! + b!, 0),
  );
  el("[data-rejudge-routes]").innerHTML = routeChoices(opts);
  const form = el<HTMLFormElement>("[data-rejudge-form]");
  const submit = el<HTMLButtonElement>("[data-rejudge-submit]");
  const update = () => {
    const route = opts.judge_routes.find((x) => x.route === selected(form, "route"));
    const box = el("[data-rejudge-key]");
    if (route && box.dataset.for !== route.route) {
      box.innerHTML = keyField("judge_key", route.key_name);
      box.dataset.for = route.route;
    }
    submit.disabled = !agreed(form);
  };
  form.onchange = update;
  form.onsubmit = (event) => {
    event.preventDefault();
    void startRejudge(form, envelope);
  };
  update();
  show("rejudge");
  return true;
}

async function startRejudge(
  form: HTMLFormElement,
  envelope: { payload: SignedResult },
): Promise<void> {
  el("[data-rejudge-error]").hidden = true;
  const key = String(new FormData(form).get("judge_key") ?? "");
  if (!key.trim()) {
    showError("[data-rejudge-error]", new Error("Enter the judge key."));
    return;
  }
  const submit = el<HTMLButtonElement>("[data-rejudge-submit]");
  submit.disabled = true;
  submit.textContent = "Checking the key and starting…";
  try {
    const { run_id } = await api<{ run_id: string }>(
      `/runs/${encodeURIComponent(envelope.payload.run_id)}/rejudge`,
      "POST",
      rejudgeBody(envelope, selected(form, "route"), key),
    );
    form.querySelector<HTMLInputElement>('input[type="password"]')!.value = "";
    write(session, REJUDGE_KEY, null);
    write(local, RUN_KEY, JSON.stringify({ id: run_id } satisfies Remembered));
    history.replaceState(null, "", location.pathname);
    await showRun(run_id);
  } catch (error) {
    showError("[data-rejudge-error]", error);
  } finally {
    submit.disabled = !agreed(form);
    submit.textContent = "Re-judge the run";
  }
}

async function startRun(form: HTMLFormElement): Promise<void> {
  const errorBox = el("[data-start-error]");
  errorBox.hidden = true;
  const data = new FormData(form);
  const keys: Record<string, string> = {};
  for (const [name, value] of data) {
    if (name.startsWith("key:")) keys[name.slice(4)] = String(value);
  }
  const affiliation = selected(form, "affiliated");
  const system = selected(form, "system");
  const missing =
    Object.values(keys).some((v) => !v.trim()) ||
    !String(data.get("judge_key") ?? "").trim() ||
    !affiliation ||
    (affiliation === "yes" && !system);
  if (missing) {
    showError(
      "[data-start-error]",
      new Error("Fill in every key and answer the affiliation question."),
    );
    return;
  }
  const route = selected(form, "route");
  const submit = el<HTMLButtonElement>("[data-submit]");
  submit.disabled = true;
  submit.textContent = "Checking the keys and starting…";
  try {
    const { run_id } = await api<{ run_id: string }>(
      "/runs",
      "POST",
      startBody({
        dataset: selected(form, "dataset"),
        connector: selected(form, "connector"),
        preset: selected(form, "preset"),
        judgeRoute: route,
        keys,
        judgeKey: String(data.get("judge_key") ?? ""),
        affiliated: affiliation === "yes",
        system: system === ANOTHER_SYSTEM ? "" : system,
      }),
    );
    form.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((i) => {
      i.value = "";
    });
    // the next run needs new keys, so it asks again
    form.querySelector<HTMLInputElement>('[name="agree_keys"]')!.checked = false;
    write(local, RUN_KEY, JSON.stringify({ id: run_id } satisfies Remembered));
    await showRun(run_id);
  } catch (error) {
    showError("[data-start-error]", error);
  } finally {
    submit.disabled = !agreed(form);
    submit.textContent = "Start the run";
  }
}

/** The footer line naming the live runner's release, commit and image. */
function renderRunner(runner: RunnerOptions["runner"]): void {
  const commit = commitRef("memjudge", runner.commit);
  const digest = shortDigest(runner.image_digest);
  const box = el("[data-runner]");
  box.innerHTML =
    `Runner ${esc(runner.version)}` +
    (commit ? `, commit <a class="mono" href="${esc(commit.url)}">${esc(commit.label)}</a>` : "") +
    (digest ? `, image <span class="mono">${esc(digest)}</span>` : "");
  box.hidden = false;
}

// --- the user's runs ------------------------------------------------------------

function renderRuns(): void {
  el("[data-runs]").hidden = runs.length === 0;
  el("[data-run-list]").innerHTML = runs
    .map((r) => {
      const current = r.run_id === shown;
      const action = current
        ? '<span class="muted small">Shown above</span>'
        : `<button type="button" class="button quiet" data-open="${esc(r.run_id)}">Open</button>`;
      return `<li class="run-item"${current ? ' aria-current="true"' : ""}>
        <span><strong>${esc(datasetName(r.dataset))} · ${esc(connectorName(r.connector, r.preset))}</strong>
          <span class="muted small">${esc(runSummary(r))}</span></span>
        ${action}
      </li>`;
    })
    .join("");
}

async function loadRuns(): Promise<void> {
  try {
    runs = (await api<{ runs: RunStatus[] }>("/runs")).runs;
  } catch {
    runs = []; // the list is a convenience: the page works without it
  }
  renderRuns();
}

/** Keep the list in step with the run the status panel shows. */
function trackRun(status: RunStatus): void {
  shown = status.run_id;
  const i = runs.findIndex((r) => r.run_id === status.run_id);
  if (i >= 0) runs[i] = status;
  else runs.unshift(status);
  renderRuns();
}

// --- the run's status -----------------------------------------------------------

function renderStatus(served: RunStatus): void {
  const status = shownStatus(served, live.has(served.run_id));
  el("[data-run-title]").textContent =
    `${status.rejudge_of ? "Re-judge · " : ""}${datasetName(status.dataset)} · ${connectorName(status.connector, status.preset)}`;
  el("[data-run-meta]").innerHTML = [
    `Run <span class="mono">${esc(status.run_id)}</span>`,
    esc(startedText(status)),
    ...(status.resumes ? [`Resumed ${status.resumes} of 3 times`] : []),
  ].join(" · ");
  const active = isActive(status);
  el("[data-state]").hidden = active;
  el("[data-state]").textContent = active ? "" : stateText(status);
  el("[data-steps]").hidden = !active;
  el("[data-steps]").innerHTML = active
    ? runSteps(status)
        .map(
          (s) => `<li class="run-step" data-step="${s.state}">
        <span class="run-step-label">${esc(s.label)}</span>
        ${s.count ? `<span class="muted small">${esc(s.count)}</span>` : ""}
        ${s.state === "active" && s.total ? `<progress class="run-progress" max="${s.total}" value="${s.done}"></progress>` : ""}
      </li>`,
        )
        .join("")
    : "";
  trackRun(status);

  const errorBox = el("[data-run-error]");
  errorBox.hidden = !status.error;
  errorBox.textContent = status.error ?? "";

  const note = resumeNote(status);
  el("[data-resume-note]").hidden = !note;
  el("[data-resume-note]").textContent = note ?? "";

  // The site rebuilds after the result is committed, so the run shows as publishing, without
  // the link, until the page is live.
  const result = el<HTMLAnchorElement>("[data-result]");
  result.hidden = status.state !== "done";
  if (status.result_url) result.href = status.result_url;
  el("[data-done-note]").hidden = !(served.state === "done" && status.state === "publishing");
  el("[data-stop]").hidden = !(status.state === "retrieving" || status.state === "judging");
  el("[data-another]").hidden = isActive(status);

  const resume = el<HTMLFormElement>("[data-resume]");
  const resumable = status.state === "stopped" && Boolean(status.resume_until);
  if (resumable && resume.hidden) {
    const route = options?.judge_routes.find((r) => r.route === status.judge_route);
    el("[data-resume-keys]").innerHTML = [
      ...status.key_names.map((k) => keyField(`key:${k}`, k)),
      keyField("judge_key", route ? route.key_name : "Judge API key (same provider as before)"),
    ].join("");
    el("[data-resume-error]").hidden = true;
  }
  resume.hidden = !resumable;
}

async function showRun(id: string): Promise<void> {
  clearTimeout(pollTimer);
  notice(null);
  let status: RunStatus;
  try {
    status = await api<RunStatus>(`/runs/${encodeURIComponent(id)}`);
  } catch (error) {
    if (!token) return; // signed out by the 401 handler
    if (error instanceof ApiError && /No such run/.test(error.message)) {
      write(local, RUN_KEY, null);
      shown = null;
      renderRuns();
      show("start");
      return;
    }
    notice(`Could not load your run: ${(error as Error).message}`);
    pollTimer = window.setTimeout(() => void showRun(id), POLL_MS);
    return;
  }
  if (!token) return; // signed out while it loaded
  renderStatus(status);
  show("status");
  void loadLog(id);
  if (isActive(status)) {
    pollTimer = window.setTimeout(() => void showRun(id), POLL_MS);
  } else if (status.state === "done" && status.result_url && !live.has(id)) {
    if (await pageIsLive(status.result_url)) {
      live.add(id);
      if (shown === id) renderStatus(status);
    } else if (shown === id) {
      pollTimer = window.setTimeout(() => void showRun(id), POLL_MS);
    }
  }
}

/** The run's log, while the Log section is open: read when it opens, then at each poll. */
async function loadLog(id: string): Promise<void> {
  if (!el<HTMLDetailsElement>("[data-log]").open) return;
  let log: RunLog;
  try {
    log = await api<RunLog>(`/runs/${encodeURIComponent(id)}/log`);
  } catch (error) {
    if (shown === id) showError("[data-log-error]", error);
    return;
  }
  if (shown !== id) return; // another run was opened meanwhile
  const box = el("[data-log-lines]");
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  box.textContent = logText(log.lines);
  if (atEnd) box.scrollTop = box.scrollHeight; // follow new lines unless scrolled up
  const error = el("[data-log-error]");
  error.hidden = !log.error;
  error.textContent = log.error ?? "";
}

/** Whether this site already serves the result page (checked on this origin, so it
 * works on preview deployments too). */
async function pageIsLive(url: string): Promise<boolean> {
  try {
    const resp = await fetch(new URL(url).pathname, { method: "HEAD", cache: "no-store" });
    return resp.ok;
  } catch {
    return false;
  }
}

function initStatusActions(): void {
  el("[data-stop]").addEventListener("click", () => {
    const run = remembered();
    if (!run) return;
    const ok = window.confirm(
      "Stop this run? Its progress is kept, and you can resume it within 48 hours.",
    );
    if (!ok) return;
    void api<RunStatus>(`/runs/${encodeURIComponent(run.id)}/stop`, "POST")
      .then(() => showRun(run.id))
      .catch((error) => showError("[data-run-error]", error));
  });
  el("[data-another]").addEventListener("click", () => {
    clearTimeout(pollTimer);
    write(local, RUN_KEY, null);
    shown = null;
    renderRuns();
    show("start");
  });
  const log = el<HTMLDetailsElement>("[data-log]");
  log.addEventListener("toggle", () => {
    if (log.open && shown) void loadLog(shown);
  });
  el("[data-run-list]").addEventListener("click", (event) => {
    const id = (event.target as HTMLElement).closest<HTMLElement>("[data-open]")?.dataset.open;
    if (!id) return;
    write(local, RUN_KEY, JSON.stringify({ id } satisfies Remembered));
    el<HTMLFormElement>("[data-resume]").hidden = true; // rebuilt with this run's keys
    el("[data-log-lines]").textContent = ""; // the other run's
    el("[data-log-error]").hidden = true;
    void showRun(id).then(() => el("[data-status]").scrollIntoView({ block: "start" }));
  });
  const resume = el<HTMLFormElement>("[data-resume]");
  resume.addEventListener("submit", (event) => {
    event.preventDefault();
    const run = remembered();
    if (!run) return;
    const data = new FormData(resume);
    const keys: Record<string, string> = {};
    for (const [name, value] of data) {
      if (name.startsWith("key:")) keys[name.slice(4)] = String(value);
    }
    const button = resume.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    void api(
      `/runs/${encodeURIComponent(run.id)}/resume`,
      "POST",
      resumeBody(keys, String(data.get("judge_key") ?? "")),
    )
      .then(() => {
        resume.hidden = true;
        return showRun(run.id);
      })
      .catch((error) => showError("[data-resume-error]", error))
      .finally(() => {
        button.disabled = false;
      });
  });
}

export async function initRun(): Promise<void> {
  const fragment = readFragment(location.hash);
  if (fragment.token) {
    if (ownLogin(fragment, read(local, LOGIN_KEY))) {
      write(session, TOKEN_KEY, fragment.token);
      write(local, LOGIN_KEY, null);
    } else {
      notice(loginError("login-expired"));
    }
  }
  if (fragment.token || fragment.error) {
    history.replaceState(null, "", location.pathname + location.search); // drop the token
  }
  if (fragment.error) notice(loginError(fragment.error));
  el<HTMLAnchorElement>("[data-signin-link]").href = signInUrl(API, pendingLogin());
  // The sign-in comes back to /run without the query, so the run to re-judge waits here.
  const asked = new URLSearchParams(location.search).get("rejudge");
  if (asked) write(session, REJUDGE_KEY, asked);

  token = read(session, TOKEN_KEY);
  if (!token) {
    show("signin");
    return;
  }
  el("[data-account]").hidden = false;
  el("[data-signout]").addEventListener("click", () => {
    // Forget this browser's run too, so the next account starts clean.
    write(local, RUN_KEY, null);
    write(session, REJUDGE_KEY, null);
    shown = null;
    signedOut("You are signed out.");
  });
  el("[data-loading]").hidden = false;
  const form = el<HTMLFormElement>("[data-start]");
  try {
    options = await api<RunnerOptions>("/options");
  } catch (error) {
    el("[data-loading]").hidden = true;
    if (token) notice(`Could not load the runner's options: ${(error as Error).message}`);
    return;
  }
  renderRunner(options.runner);
  renderForm(form, options);
  initStatusActions();
  await loadRuns();
  const rejudge = read(session, REJUDGE_KEY);
  if (rejudge) {
    if (await showRejudge(rejudge, options)) return;
    write(session, REJUDGE_KEY, null);
    notice(`Run ${rejudge} is not published on this site, so it cannot be re-judged.`);
  }
  // This browser's last run, else one still running (started in another browser).
  const run = remembered()?.id ?? runs.find(isActive)?.run_id;
  if (run) await showRun(run);
  else show("start");
}
