/**
 * The current Terms of Use version. The Terms page shows it, and every new hosted run sends
 * it, so the runner records which terms its submitter agreed to. Change it with the terms.
 */
export const TERMS_UPDATED = "2026-10-29";

/** "2026-10-17" -> "17 October 2026". */
export function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
