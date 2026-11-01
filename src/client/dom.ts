/** Tiny DOM and fetch helpers for the browser code. */

export function esc(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const requests = new Map<string, Promise<unknown>>();

/** Fetch JSON once per URL; failures are not cached, so a retry can succeed. */
export function fetchJson<T>(url: string): Promise<T> {
  let pending = requests.get(url) as Promise<T> | undefined;
  if (!pending) {
    pending = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.json() as Promise<T>;
    });
    pending.catch(() => requests.delete(url));
    requests.set(url, pending);
  }
  return pending;
}

export function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1).trimEnd()}…`;
}
