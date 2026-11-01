# MemJudge leaderboard

The website for [MemJudge](https://github.com/memjudge/memjudge), the open benchmark for AI
memory systems. It shows verified results: accuracy against context tokens and latency,
where each system fails, every question with the judge's reason, and side-by-side
comparisons of up to four runs.

It is a static site (Astro), deployed as Cloudflare Workers static assets.

## How a result reaches the site

1. A run's signed result is committed to [memjudge/results](https://github.com/memjudge/results)
   (`runs/<run_id>.json`), and its raw files are uploaded to R2.
2. That commit triggers this repo's deploy workflow.
3. `npm run data` (`scripts/build-data.ts`) checks each result:
   - the Ed25519 signature over its RFC 8785 canonical JSON, against the keys in `keys/`;
   - the JSON Schema (`schemas/result.v1.json`, copied from memjudge);
   - the SHA-256 of its `questions-top10.jsonl` and `questions-top30.jsonl` against the hashes
     in the signed result. Every run is listed once per result size, on a Top 10 and a Top 30
     board (memjudge ADR 0018);
   - its judge against its season in `seasons.json` (copied from memjudge's
     `src/memjudge/judge/seasons.json`; copy it again whenever a season is added). A result
     from a season the copy does not list stops the build.

   A file that fails any check is skipped and named in the build log. It never stops the
   build.

4. Astro renders the pages; `wrangler deploy` publishes them.

There is one rule and no hidden setting: the site lists every result signed by a key in
`keys/`, and labels anything unusual about it (local run, unofficial judge, custom
endpoint) on every page where it appears.

## Run it locally

You need Node.js 22.12 or later.

```bash
npm install
```

Build the data from the signed test fixtures, then start the dev server:

```bash
RESULTS_DIR=tests/fixtures/results KEYS_DIR=tests/fixtures/keys ARTIFACTS_DIR=tests/fixtures/artifacts npm run data
```

```bash
npm run dev
```

To preview real results, point `RESULTS_DIR` at a checkout of memjudge/results and
`ARTIFACTS_DIR` at a folder of raw files (`<run_id>/questions-top10.jsonl` and
`questions-top30.jsonl`), or set the `R2_*`
variables below.

| Variable                                                    | Default              | Meaning                                                    |
| ----------------------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `RESULTS_DIR`                                               | `../results`         | Results repo checkout; results are read from `runs/*.json` |
| `KEYS_DIR`                                                  | `keys`               | Trusted public keys (`*.pub`)                              |
| `ARTIFACTS_DIR`                                             | none                 | Local raw files, `<dir>/<run_id>/<name>`                   |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | none                 | Read raw files from R2 instead                             |
| `R2_BUCKET`                                                 | `memjudge-artifacts` | R2 bucket name                                             |

## Checks

```bash
npm test               # signatures, listing rules, artifacts, statistics, formatting
npm run check          # TypeScript and Astro
npm run format:check   # Prettier
```

`tests/fixtures` holds synthetic runs signed by memjudge (Python) with a throwaway key, so
the tests prove the Python signer and this TypeScript checker agree byte for byte. Only the
public key is kept.

## Layout

| Path                    | What it is                                                                    |
| ----------------------- | ----------------------------------------------------------------------------- |
| `scripts/build-data.ts` | Verifies results and writes the data the site is built from                   |
| `src/lib/`              | Verification, boards, naming, formatting, statistics (build time and browser) |
| `src/charts/`           | ECharts option builders: trade-off, categories, latency                       |
| `src/client/`           | Browser code: leaderboard table, verdict quilt, question list, compare        |
| `src/pages/`            | Leaderboard, boards, run pages, compare, 404                                  |
| `keys/`                 | Trusted signing keys                                                          |

## Licence

Apache-2.0. Results shown on the site are CC BY 4.0. The MemJudge name and logo are not
covered by these licences.
