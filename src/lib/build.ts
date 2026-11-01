/**
 * What is live: the site and results commits are stamped in when the site is built
 * (PUBLIC_SITE_COMMIT, PUBLIC_RESULTS_COMMIT); the runner reports its own in /options.
 * Shown so anyone can match the live site against GitHub.
 */

export interface CommitRef {
  label: string;
  url: string;
}

/** A link to `sha` in memjudge/`repo`, or null when there is no (valid) commit. */
export function commitRef(repo: string, sha: string | null | undefined): CommitRef | null {
  if (!sha || !/^[0-9a-f]{7,40}$/.test(sha)) return null;
  return { label: sha.slice(0, 7), url: `https://github.com/memjudge/${repo}/commit/${sha}` };
}

/** "sha256:d980e18e0dfa…" -> "sha256:d980e18e0dfa". */
export function shortDigest(digest: string | null | undefined): string | null {
  return digest?.match(/^sha256:[0-9a-f]{12}/)?.[0] ?? null;
}
