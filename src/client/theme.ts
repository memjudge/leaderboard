/**
 * Theme switch: system, light or dark, saved per browser. Charts listen for
 * `mj:theme` to redraw with the new colours.
 */
const ORDER = ["system", "light", "dark"] as const;
type Theme = (typeof ORDER)[number];

function saved(): Theme {
  try {
    const value = localStorage.getItem("mj-theme");
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem("mj-theme");
    else localStorage.setItem("mj-theme", theme);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
  window.dispatchEvent(new Event("mj:theme"));
}

export function initThemeSwitch(): void {
  const button = document.querySelector<HTMLButtonElement>("[data-theme-switch]");
  let theme = saved();
  const label = () => {
    if (button) button.textContent = `Theme: ${theme}`;
  };
  label();
  button?.addEventListener("click", () => {
    theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]!;
    apply(theme);
    label();
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => window.dispatchEvent(new Event("mj:theme")));
}
