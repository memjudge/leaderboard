/**
 * Verify the signed results and write everything the site is built from.
 *
 * - Reads RESULTS_DIR/runs/*.json (default ../results) and trusts the keys in KEYS_DIR
 *   (default ./keys). A file with a bad signature or schema is skipped and reported.
 * - Checks each run's question files (questions-top10.jsonl, questions-top30.jsonl) against
 *   their signed hashes. They are read from R2 (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 *   R2_SECRET_ACCESS_KEY, R2_BUCKET) or ARTIFACTS_DIR.
 * - Lists every run once per result size (Top 10, Top 30), as `<run id>-top10` and
 *   `<run id>-top30`, each on its own board.
 * - Every result that passes these checks is listed, labelled with anything unusual about it
 *   (local run, unofficial judge, custom endpoint). Which keys are trusted is the only rule.
 * - Reads SEASONS_FILE (default ./seasons.json, a copy of memjudge's). An official result
 *   whose judge differs from its season's is skipped; one from a season the file does not
 *   list stops the build, because the copy is out of date.
 *
 * Writes src/generated/site.json for the pages, and public/data + public/results for
 * the browser. Run with `npm run data`.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  ArtifactMismatch,
  ArtifactMissing,
  loadArtifact,
  localSource,
  r2Source,
  type ArtifactSource,
} from "../src/lib/artifacts.ts";
import { groupBoards, judgeKey, judgeLabel } from "../src/lib/boards.ts";
import { shortHash } from "../src/lib/format.ts";
import { modelsLabel, runLabels, settingLabels, systemName } from "../src/lib/naming.ts";
import {
  CHUNK_SIZE,
  contextChunks,
  parseQuestions,
  toInfo,
  toRow,
  type QuestionInfo,
  type Row,
} from "../src/lib/questions.ts";
import { readSignedResults, runNotices, type LoadedRun } from "../src/lib/results.ts";
import { makeResultValidator } from "../src/lib/schema.ts";
import { currentSeason, seasonProblem, type Season } from "../src/lib/seasons.ts";
import type { RunEntry, RunFile, SiteData } from "../src/lib/site-types.ts";
import { SIZES, sizeView, type RunResult } from "../src/lib/types.ts";
import { loadTrustedKeys } from "../src/lib/verify.ts";

const env = process.env;
const root = process.cwd();
const resultsDir = resolve(env.RESULTS_DIR ?? "../results");
const keysDir = resolve(env.KEYS_DIR ?? "keys");
const seasonsFile = resolve(env.SEASONS_FILE ?? "seasons.json");
const publicDir = join(root, "public");
const generatedDir = join(root, "src", "generated");
const cacheDir = join(root, ".cache", "artifacts");

function artifactSource(): ArtifactSource | null {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  if (R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY) {
    return r2Source({
      accountId: R2_ACCOUNT_ID,
      bucket: env.R2_BUCKET || "memjudge-artifacts",
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    });
  }
  return env.ARTIFACTS_DIR ? localSource(resolve(env.ARTIFACTS_DIR)) : null;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

const questionsPath = (r: RunResult) => `/data/questions/${shortHash(r.dataset.hash, 16)}.json`;

async function main(): Promise<void> {
  const trusted = loadTrustedKeys(keysDir);
  const schema = JSON.parse(readFileSync(join(root, "schemas", "result.v1.json"), "utf8"));
  const { runs, skipped } = readSignedResults(
    join(resultsDir, "runs"),
    trusted,
    makeResultValidator(schema),
  );
  const files = runs.length + skipped.length;
  const seasons = JSON.parse(readFileSync(seasonsFile, "utf8")) as Season[];

  rmSync(join(publicDir, "data"), { recursive: true, force: true });
  rmSync(join(publicDir, "results"), { recursive: true, force: true });
  rmSync(generatedDir, { recursive: true, force: true });

  // Pass 1: check each run's per-question files against their signed hashes, write the
  // context chunks and keep the compact rows, per result size.
  const source = artifactSource();
  const listed: LoadedRun[] = [];
  const rows = new Map<string, Row[]>();
  const questions = new Map<string, Record<string, QuestionInfo>>();
  run: for (const run of runs) {
    const r = run.result;
    const problem = seasonProblem(r, seasons);
    if (problem) {
      skipped.push({ file: run.file, reason: `season ${r.judge.season}: ${problem} differs` });
      continue;
    }
    const sized = new Map<string, Row[]>();
    for (const size of SIZES) {
      const artifact = r.artifacts.find((a) => a.name === `questions-${size}.jsonl`);
      if (!artifact || !source) continue;
      let text: string;
      try {
        text = Buffer.from(await loadArtifact(source, r.run_id, artifact, cacheDir)).toString(
          "utf8",
        );
      } catch (err) {
        if (!(err instanceof ArtifactMismatch || err instanceof ArtifactMissing)) throw err;
        skipped.push({ file: run.file, reason: `artifact: ${err.message}` });
        continue run;
      }
      const records = parseQuestions(text);
      const id = sizeView(r, size).run_id;
      sized.set(id, records.map(toRow));
      contextChunks(records).forEach((chunk, i) =>
        writeJson(join(publicDir, "data", "ctx", id, `${i}.json`), chunk),
      );
      const known = questions.get(r.dataset.hash) ?? {};
      for (const rec of records) known[rec.question_id] ??= toInfo(rec);
      questions.set(r.dataset.hash, known);
    }
    for (const [id, sizeRows] of sized) rows.set(id, sizeRows);
    listed.push(run);
  }

  // Pass 2: boards, labels and the files that need them. Each run is listed once per size.
  const results = listed.flatMap((run) => SIZES.map((size) => sizeView(run.result, size)));
  const boards = groupBoards(results, seasons);
  const site: SiteData = {
    generatedAt: new Date().toISOString(),
    keys: [...trusted.keys()],
    seasons,
    currentSeason: currentSeason(seasons)?.id ?? null,
    boards,
    runs: {},
    skipped,
  };
  for (const board of boards) {
    const boardResults = board.runIds.map((id) => results.find((r) => r.run_id === id)!);
    const labels = runLabels(boardResults);
    const settings = settingLabels(boardResults);
    for (const r of boardResults) {
      const run = listed.find((l) => l.result.run_id === r.signed_run_id)!;
      const runRows = rows.get(r.run_id);
      const entry: RunEntry = {
        id: r.run_id,
        board: board.slug,
        label: labels.get(r.run_id)!,
        system: systemName(r),
        settings: settings.get(r.run_id) ?? [],
        result: r,
        keyId: run.keyId,
        notices: runNotices(r),
        dataFile: runRows ? `/data/runs/${r.run_id}.json` : null,
        questionsFile: runRows ? questionsPath(r) : null,
        signedFile: `/results/${r.signed_run_id}.json`,
      };
      site.runs[r.run_id] = entry;
      writeFileSync(mkdirFor(join(publicDir, "results", `${r.signed_run_id}.json`)), run.raw);
      if (runRows) {
        const file: RunFile = {
          summary: {
            id: r.run_id,
            label: entry.label,
            system: entry.system,
            board: board.slug,
            boardTitle: board.title,
            size: r.size,
            connector: r.connector.id,
            vendorMaintained: r.connector.label === "vendor-maintained",
            affiliated: r.affiliation.affiliated,
            affiliatedSystem: r.affiliation.system ?? null,
            datasetHash: r.dataset.hash,
            judgeKey: judgeKey(r),
            judgeLabel: judgeLabel(board.judge, seasons),
            models: modelsLabel(r.connector.models),
            budget: r.config.budget_tokens,
            finished: r.finished_at,
            metrics: r.metrics,
            runPage: `/runs/${r.run_id}/`,
            questionsFile: questionsPath(r),
          },
          chunkSize: CHUNK_SIZE,
          rows: runRows,
        };
        writeJson(join(publicDir, "data", "runs", `${r.run_id}.json`), file);
      }
    }
  }
  for (const [hash, known] of questions) {
    writeJson(join(publicDir, "data", "questions", `${shortHash(hash, 16)}.json`), known);
  }
  writeJson(join(generatedDir, "site.json"), site);

  console.log(
    `MemJudge data: ${runs.length} of ${files} files verified with ${trusted.size} trusted ` +
      `key(s); ${listed.length} runs listed at ${SIZES.length} sizes on ${boards.length} ` +
      `board(s).`,
  );
  if (!source) {
    console.warn("  No artifact source (R2_* or ARTIFACTS_DIR): pages show totals only.");
  }
  for (const s of skipped) console.warn(`  skipped ${s.file}: ${s.reason}`);
}

function mkdirFor(path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

await main();
