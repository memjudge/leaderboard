/**
 * Number formatting shared by the pages and the browser code. A missing value is shown
 * as "not reported" (the system did not report it) and never replaced by a guess; an
 * empty rate (no questions of that kind) is shown as "n/a".
 */
import type { Ingestion, Rate } from "./types.ts";

export const NOT_REPORTED = "not reported";

const grouped = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function int(value: number | null | undefined): string {
  return value == null ? NOT_REPORTED : grouped.format(value);
}

export function fixed(value: number | null | undefined, digits = 1): string {
  return value == null
    ? NOT_REPORTED
    : value.toLocaleString("en-GB", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });
}

/** 0.8236 -> "82.4%". */
export function pct(value: number | null | undefined, digits = 1): string {
  return value == null ? NOT_REPORTED : `${(value * 100).toFixed(digits)}%`;
}

/** 0.8236 -> "82.4" (for tables whose header carries the unit). */
export function pctNumber(value: number, digits = 1): string {
  return (value * 100).toFixed(digits);
}

export function ci(range: [number, number], digits = 1): string {
  return `${pctNumber(range[0], digits)} to ${pctNumber(range[1], digits)}`;
}

/** Seconds, switching to milliseconds and microseconds for small values. */
export function secs(value: number | null | undefined): string {
  if (value == null) return NOT_REPORTED;
  if (value >= 100) return `${grouped.format(value)} s`;
  if (value >= 1) return `${value.toFixed(2)} s`;
  // Number() turns toPrecision's exponent form ("1.6e+2") back into plain digits.
  if (value >= 0.001) return `${Number((value * 1000).toPrecision(3))} ms`;
  if (value > 0) return `${Number((value * 1e6).toPrecision(2))} µs`;
  return "0 s";
}

/** Long durations: "4 min 12 s", "2 h 05 min". */
export function duration(value: number | null | undefined): string {
  if (value == null) return NOT_REPORTED;
  if (value < 60) return secs(value);
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return `${minutes} min ${String(Math.round(value % 60)).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

/** Shown after a batch run's ingestion times: the upload's wall-clock time, not a sum (ADR 0017). */
export function ingestionNote(ingestion: Ingestion): string {
  return ingestion.mode === "batch" ? " (batch, wall-clock)" : "";
}

/** Shown after a run's total ingestion time. A per-session total adds up every conversation's
 * time, so it is not how long the run took (ADR 0017). */
export function ingestionTotalNote(ingestion: Ingestion): string {
  return ingestion.mode === "batch" ? ingestionNote(ingestion) : " (all conversations added up)";
}

export function usd(value: number | null | undefined): string {
  if (value == null) return NOT_REPORTED;
  if (value === 0) return "$0";
  if (value < 0.01) return "under $0.01";
  return `$${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function rate(value: Rate | null | undefined, digits = 1): string {
  if (value == null) return NOT_REPORTED;
  return value.n === 0 || value.value == null ? "n/a" : pct(value.value, digits);
}

/** "2026-10-05T16:44:13.123Z" -> "5 Oct 2026". */
export function date(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "2026-10-05T16:44:13.123Z" -> "5 Oct 2026, 16:44 UTC". */
export function dateTime(iso: string): string {
  const text = new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  return `${text} UTC`;
}

/** "sha256:9c7812f2f45c…" -> "9c7812f2f45c" (enough to tell hashes apart on screen). */
export function shortHash(hash: string, length = 12): string {
  return hash.replace(/^sha256:/, "").slice(0, length);
}

/** p-values in plain notation: "0.03", "0.0012", "4 × 10⁻⁵". */
export function pValue(p: number): string {
  if (p >= 0.01) return p.toFixed(2);
  if (p >= 0.001) return p.toFixed(4);
  if (p < 1e-15) return `under 10${superscript(-15)}`;
  let exponent = Math.floor(Math.log10(p));
  let mantissa = Math.round(p / 10 ** exponent);
  if (mantissa === 10) {
    mantissa = 1;
    exponent += 1;
  }
  return `${mantissa} × 10${superscript(exponent)}`;
}

function superscript(n: number): string {
  const digits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return (n < 0 ? "⁻" : "") + [...String(Math.abs(n))].map((d) => digits[Number(d)]).join("");
}
