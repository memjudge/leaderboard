/** Display names for datasets, systems and run settings. */
import type { RunResult } from "./types.ts";

const DATASET_TITLES: Record<string, string> = {
  locomo: "LoCoMo",
  "longmemeval-s": "LongMemEval-S",
  "longmemeval-oracle": "LongMemEval oracle",
};

export function datasetTitle(name: string, version: string): string {
  return `${datasetName(name)} ${version}`;
}

export function datasetName(name: string): string {
  return DATASET_TITLES[name] ?? name;
}

/** Systems whose recorded results the offline replay connector can play back. */
const REPLAY_TOOLS: Record<string, string> = { mem0: "Mem0" };

/** "Mem0 Platform (hosted API, v3)" -> "Mem0 Platform". A replay is named after its source. */
export function systemName(result: RunResult): string {
  const { id, target, settings } = result.connector;
  if (id === "offline/replay" && typeof settings.tool === "string") {
    return `${REPLAY_TOOLS[settings.tool] ?? settings.tool} (replayed)`;
  }
  return target.replace(/\s*\(.*\)\s*$/, "") || target;
}

/** The part of the connector's target in brackets: "hosted API, v3". */
export function targetDetail(target: string): string | null {
  return /\(([^)]*)\)\s*$/.exec(target)?.[1] ?? null;
}

/** Settings that are bookkeeping, never what tells two configurations apart. */
const IGNORED_SETTINGS = new Set(["path", "base_url", "max_retries", "timeout_s"]);

/**
 * Short labels for the settings that differ between runs of the same connector, so
 * "Recalld" becomes "Recalld, limit 30" and "Recalld, limit 52" side by side.
 */
export function settingLabels(results: RunResult[]): Map<string, string[]> {
  const byConnector = new Map<string, RunResult[]>();
  for (const r of results) {
    const group = byConnector.get(r.connector.id) ?? [];
    group.push(r);
    byConnector.set(r.connector.id, group);
  }
  const labels = new Map<string, string[]>();
  for (const group of byConnector.values()) {
    const keys = [...new Set(group.flatMap((r) => Object.keys(r.connector.settings)))].filter(
      (k) =>
        !IGNORED_SETTINGS.has(k) &&
        new Set(group.map((r) => JSON.stringify(r.connector.settings[k] ?? null))).size > 1,
    );
    for (const r of group) {
      labels.set(
        r.run_id,
        keys.map((k) => `${k.replaceAll("_", " ")} ${settingValue(r.connector.settings[k])}`),
      );
    }
  }
  return labels;
}

/** The models a run used, for display: their distinct names, the vendor notice, or "". */
export function modelsLabel(models: Record<string, unknown> | "vendor" | undefined): string {
  if (models === "vendor") return "chosen by the vendor, not disclosed";
  return [...new Set(Object.values(models ?? {}).map(settingValue))].join(", ");
}

export function settingValue(value: unknown): string {
  if (value === null || value === undefined) return "default";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** "Recalld, limit 30"; identical labels within a board get the end of the run id. */
export function runLabels(results: RunResult[]): Map<string, string> {
  const settings = settingLabels(results);
  const labels = new Map(
    results.map((r) => [r.run_id, [systemName(r), ...(settings.get(r.run_id) ?? [])].join(", ")]),
  );
  const counts = new Map<string, number>();
  for (const label of labels.values()) counts.set(label, (counts.get(label) ?? 0) + 1);
  for (const r of results) {
    const label = labels.get(r.run_id)!;
    if ((counts.get(label) ?? 0) > 1) {
      labels.set(r.run_id, `${label} (run ${r.signed_run_id.slice(-6)})`);
    }
  }
  return labels;
}
