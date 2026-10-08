/** How many service colors styles/tokens.css defines (--svc-1 to --svc-8), for each theme. */
const SERVICE_COLORS = 8;

/**
 * A stable color per name: the same service keeps its color in the logs and
 * the charts of a page. It is a CSS variable, so it follows the theme; charts
 * resolve it with `resolveColor`.
 */
export function colorFor(name: string, names: string[]): string {
  const index = [...names].sort().indexOf(name);
  return `var(--svc-${((index < 0 ? 0 : index) % SERVICE_COLORS) + 1})`;
}

/**
 * The value of a color for a canvas, which knows no CSS variable: "var(--ok)"
 * gives the token's color in the current theme; other colors pass through.
 */
export function resolveColor(color: string): string {
  const variable = /^var\((--[\w-]+)\)$/.exec(color)?.[1];
  return variable ? getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || color : color;
}

/** Bytes in IEC units, as the API counts them: "512 MiB", "1.5 GiB". */
export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '-';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? '-' : `${value < 10 ? value.toFixed(1) : Math.round(value)}%`;
}

/** "45s", "1m 42s", "12m". */
export function formatSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) {
    return '-';
  }
  const rounded = Math.round(seconds);
  if (rounded < 60) {
    return `${rounded}s`;
  }
  const minutes = Math.floor(rounded / 60);
  return rounded % 60 === 0 || minutes >= 10 ? `${minutes}m` : `${minutes}m ${rounded % 60}s`;
}
