/** Small statistics and ordering helpers, used at build time and in the browser. */

/**
 * Exact two-sided McNemar test: given the questions where two runs disagree
 * (`b` = only the first was right, `c` = only the second was right), the chance of a
 * split at least this uneven if both runs were equally good.
 */
export function mcnemarExact(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  // P(X <= k) for X ~ Binomial(n, 1/2), summed in log space so large n cannot overflow.
  const logHalfN = -n * Math.LN2;
  let logChoose = 0;
  let tail = Math.exp(logHalfN);
  for (let i = 1; i <= k; i++) {
    logChoose += Math.log((n - i + 1) / i);
    tail += Math.exp(logChoose + logHalfN);
  }
  return Math.min(1, 2 * tail);
}

/** Order ids like "conv-9:q10" < "conv-10:q2" by their numbers, not character by character. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b);
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });

/** Points of the empirical cumulative distribution: share of values at or below each x. */
export function ecdf(values: number[]): [number, number][] {
  const sorted = [...values].sort((x, y) => x - y);
  const n = sorted.length;
  const points: [number, number][] = [];
  sorted.forEach((x, i) => {
    const last = points[points.length - 1];
    if (last && last[0] === x) last[1] = (i + 1) / n;
    else points.push([x, (i + 1) / n]);
  });
  return points;
}
