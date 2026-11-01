import { describe, expect, it } from "vitest";
import { commitRef, shortDigest } from "../src/lib/build.ts";
import { longDate, TERMS_UPDATED } from "../src/lib/legal.ts";
import {
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
  type RunStatus,
  runSummary,
  shownStatus,
  signInUrl,
  startBody,
  runSteps,
  stateText,
} from "../src/lib/run.ts";

const status = (over: Partial<RunStatus>): RunStatus => ({
  run_id: "20261016T120000Z-abc123",
  dataset: "locomo",
  connector: "zep/cloud",
  judge_route: "anthropic",
  state: "retrieving",
  done: 0,
  total: 1986,
  ingested: 0,
  ingest_total: 0,
  ingest_unit: "sessions",
  error: null,
  result_url: null,
  resumes: 0,
  resume_from: null,
  key_names: ["ZEP_API_KEY"],
  resume_until: null,
  created_at: "2026-10-17T11:43:26Z",
  ...over,
});

describe("re-judge", () => {
  it("sends the signed result as served, with the terms date and a trimmed key", () => {
    const envelope = { payload: { run_id: "r" }, signature: {} };
    expect(rejudgeBody(envelope, "anthropic", " sk-1 ")).toEqual({
      envelope,
      judge_route: "anthropic",
      judge_key: "sk-1",
      terms: TERMS_UPDATED,
    });
  });

  it("estimates from the original run's judge cost", () => {
    expect(rejudgeCostLine(14.58)).toBe(
      "Judge: about US$14.58, what judging this run cost the first time.",
    );
    expect(rejudgeCostLine(null)).toMatch(/could not be estimated/);
  });

  it("shows only judging and publishing, and is never resumable", () => {
    const steps = runSteps(status({ state: "judging", rejudge_of: "x", done: 10, total: 20 }));
    expect(steps.map((s) => s.label)).toEqual([
      "Starting the job",
      "Judging the answers",
      "Signing and publishing the result",
    ]);
    expect(resumeNote(status({ state: "stopped", rejudge_of: "x" }))).toMatch(/cannot be resumed/);
  });
});

describe("sign-in fragment", () => {
  it("reads the session token or the error the API sent back", () => {
    expect(readFragment("#token=abc.def&login_id=L1")).toEqual({
      token: "abc.def",
      loginId: "L1",
    });
    expect(readFragment("#error=not-allowed")).toEqual({ error: "not-allowed" });
    expect(readFragment("")).toEqual({});
  });

  it("takes a token only from a sign-in this browser started", () => {
    const fragment = readFragment("#token=abc.def&login_id=L1");
    expect(ownLogin(fragment, "L1")).toBe(true);
    expect(ownLogin(fragment, "L2")).toBe(false); // someone else's sign-in
    expect(ownLogin(fragment, null)).toBe(false); // this browser started none
    expect(ownLogin(readFragment("#token=abc.def"), "L1")).toBe(false);
  });

  it("sends the login id with the sign-in link", () => {
    expect(signInUrl("https://api.test", "L 1")).toBe("https://api.test/auth/login?login_id=L%201");
  });

  it("explains each sign-in error", () => {
    expect(loginError("login-failed")).toMatch(/GitHub sign-in/);
    expect(loginError("something-new")).toBe("Sign-in failed. Try again.");
  });
});

describe("request bodies", () => {
  it("builds the start request with trimmed keys and the affiliation", () => {
    const body = startBody({
      dataset: "locomo",
      connector: "zep/cloud",
      preset: "",
      judgeRoute: "anthropic",
      keys: { ZEP_API_KEY: "  z-key \n" },
      judgeKey: " sk-ant ",
      affiliated: true,
      system: "Zep",
    });
    expect(body).toEqual({
      dataset: "locomo",
      connector: "zep/cloud",
      judge_route: "anthropic",
      connector_keys: { ZEP_API_KEY: "z-key" },
      judge_key: "sk-ant",
      affiliation: { affiliated: true, system: "Zep" },
      terms: TERMS_UPDATED,
    });
    const form = {
      dataset: "locomo",
      connector: "baselines/bm25",
      preset: "",
      judgeRoute: "openrouter",
      keys: {},
      judgeKey: "k",
      affiliated: false,
      system: "ignored",
    };
    expect(startBody(form).affiliation).toEqual({ affiliated: false });
    const another = startBody({ ...form, affiliated: true, system: "" });
    expect(another.affiliation).toEqual({ affiliated: true }); // another memory system
    expect(startBody({ ...form, preset: "search-sources" }).preset).toBe("search-sources");
    expect("preset" in startBody(form)).toBe(false); // no presets: the field is left out
  });

  it("asks for every key again on resume", () => {
    expect(resumeBody({ ZEP_API_KEY: " z " }, " j ")).toEqual({
      connector_keys: { ZEP_API_KEY: "z" },
      judge_key: "j",
    });
  });
});

describe("what the page says", () => {
  it("shows the judge's typical cost, then its upper bound", () => {
    const line = costLine(
      { questions: 1986, judge_cost_usd_typical: 22.364694, judge_cost_usd_upper_bound: 59.25663 },
      8192,
    );
    expect(line).toContain("usually under US$22.36");
    expect(line).toContain("at most US$59.26");
    expect(line).toContain("1,986 questions, each judged at Top 10 and Top 30");
    expect(line).toContain("These are estimates only");
    expect(costLine(undefined, 8192)).toMatch(/could not be estimated/);
  });

  it("counts questions while the run works", () => {
    expect(stateText(status({ done: 120 }))).toBe(
      "Storing the conversations and searching for each question: 120 of 1,986 searches",
    );
    expect(stateText(status({ state: "done" }))).toBe("Published");
    expect(isActive(status({ state: "judging" }))).toBe(true);
    expect(isActive(status({ state: "stopped" }))).toBe(false);
  });

  it("lists the steps with counts while the run works", () => {
    const steps = runSteps(status({ done: 40, ingested: 312, ingest_total: 1092 }));
    expect(steps.map((s) => s.state)).toEqual(["done", "active", "active", "waiting", "waiting"]);
    expect(steps[1]?.count).toBe("312 of 1,092 sessions · 28%");
    expect(steps[2]?.count).toBe("40 of 1,986 searches · 2%");
    expect(steps[3]?.count).toBeNull();

    const batch = runSteps(status({ ingested: 5, ingest_total: 20, ingest_unit: "turns" }));
    expect(batch[1]?.count).toBe("5 of 20 turns · 25%");

    const stored = runSteps(status({ ingested: 1092, ingest_total: 1092 }));
    expect(stored[1]?.state).toBe("done");

    const judging = runSteps(status({ state: "judging", done: 993 }));
    expect(judging.map((s) => s.state)).toEqual(["done", "done", "done", "active", "waiting"]);
    expect(judging[2]?.count).toBeNull();
    expect(judging[3]?.count).toBe("993 of 1,986 answers · 50%");

    // a run started before the runner reported ingestion has no session count
    expect(runSteps(status({}))[1]?.count).toBeNull();
  });

  it("stays on starting the job until the job reports in", () => {
    const starting = runSteps(status({ job_started: false, ingested: 5, ingest_total: 272 }));
    expect(starting.map((s) => s.state)).toEqual([
      "active",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(starting[0]?.count).toBe("usually 1–2 minutes");
    expect(starting[1]?.count).toBeNull(); // an earlier attempt's count waits too

    const started = runSteps(status({ job_started: true, ingested: 5, ingest_total: 272 }));
    expect(started.map((s) => s.state)).toEqual(["done", "active", "active", "waiting", "waiting"]);
    expect(started[0]?.count).toBeNull();

    const judging = runSteps(status({ state: "judging", job_started: false, done: 993 }));
    expect(judging.map((s) => s.state)).toEqual(["done", "done", "done", "active", "waiting"]);
    expect(judging[3]?.count).toBe("Starting the job, usually 1–2 minutes");

    // a runner from before job_started: as soon as the job is created
    expect(runSteps(status({}))[0]?.state).toBe("done");
  });

  it("stays on publishing until the result page is live", () => {
    const finished = status({ state: "done", result_url: "https://memjudge.org/runs/x/" });
    const waiting = shownStatus(finished, false);
    expect(isActive(waiting)).toBe(true);
    expect(runSteps(waiting).map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active",
    ]);
    expect(shownStatus(finished, true)).toBe(finished);
    expect(shownStatus(status({ state: "stopped" }), false).state).toBe("stopped");
  });

  it("says until when a stopped run can be resumed", () => {
    expect(resumeNote(status({}))).toBeNull();
    const until = resumeNote(status({ state: "stopped", resume_until: "2026-10-18T12:00:00Z" }));
    expect(until).toMatch(/^You can resume it until 18 Oct/);
    expect(resumeNote(status({ state: "stopped" }))).toMatch(/can no longer be resumed/);
  });

  it("turns API errors into one message", () => {
    expect(errorMessage("You already have a run in progress.", 429)).toBe(
      "You already have a run in progress.",
    );
    expect(errorMessage([{ loc: ["body"], msg: "x" }], 422)).toMatch(/missing or invalid/);
    expect(errorMessage(undefined, 503)).toMatch(/\(503\)/);
  });

  it("shows the log one line each, with the time and the job", () => {
    expect(logText([])).toBe("No log lines yet.");
    const text = logText([
      {
        at: "2026-10-28T21:23:54Z",
        job: "retrieve",
        text: "INFO memjudge.harness: ingesting conv-26",
      },
      { at: "2026-10-28T21:40:02Z", job: "finish", text: "<b>not markup</b>" },
    ]);
    const lines = text.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\d{2}:\d{2}:\d{2} {2}retrieve {2}INFO memjudge\.harness: ingesting/);
    expect(lines[1]).toMatch(/^\d{2}:\d{2}:\d{2} {2}finish {4}<b>not markup<\/b>$/);
  });
});

describe("runs list", () => {
  it("says when each run started and whether it can still be resumed", () => {
    expect(runSummary(status({ state: "done" }))).toMatch(/^Started .+ · Published$/);
    expect(runSummary(status({ state: "stopped", resume_until: "2026-10-19T11:47:00Z" }))).toMatch(
      /Stopped, can be resumed$/,
    );
    expect(runSummary(status({ state: "stopped" }))).toMatch(/· Stopped$/);
  });
});

describe("terms date", () => {
  it("is an ISO date the runner accepts, shown as a long date", () => {
    expect(TERMS_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(longDate("2026-10-17")).toBe("17 October 2026");
  });
});

describe("live build", () => {
  it("links a commit on GitHub and shortens the image digest", () => {
    const sha = "49d9f13a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e";
    expect(commitRef("leaderboard", sha)).toEqual({
      label: "49d9f13",
      url: `https://github.com/memjudge/leaderboard/commit/${sha}`,
    });
    expect(commitRef("results", undefined)).toBeNull();
    expect(commitRef("results", "not a sha")).toBeNull();
    expect(shortDigest(`sha256:${"d980e18e0dfa".padEnd(64, "0")}`)).toBe("sha256:d980e18e0dfa");
    expect(shortDigest(null)).toBeNull();
  });
});
