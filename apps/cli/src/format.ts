/**
 * Bytes for humans: "512 B", "2.3 MiB".
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${value} B` : `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/**
 * A duration for humans: "45s", "1m 42s", "71h", "3d 4h".
 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) {
    return `${s}s`;
  }
  if (s < 3600) {
    return s % 60 === 0 ? `${s / 60}m` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  if (s < 3 * 86400) {
    const minutes = Math.floor((s % 3600) / 60);
    return minutes === 0 || s >= 10 * 3600 ? `${Math.round(s / 3600)}h` : `${Math.floor(s / 3600)}h ${minutes}m`;
  }
  const hours = Math.round((s % 86400) / 3600);
  return hours === 0 ? `${Math.floor(s / 86400)}d` : `${Math.floor(s / 86400)}d ${hours}h`;
}

/**
 * A moment relative to now: "in 71h", "5m ago".
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) {
    return "-";
  }
  const seconds = (new Date(iso).getTime() - now) / 1000;
  return seconds >= 0 ? `in ${formatDuration(seconds)}` : `${formatDuration(-seconds)} ago`;
}

const ANSI = /\x1b\[[0-9;]*m/g;

/**
 * Lays out rows in aligned columns, two spaces apart. Colors do not count in
 * the widths.
 */
export function table(rows: string[][], header?: string[]): string {
  const all = header ? [header, ...rows] : rows;
  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index] ?? 0, cell.replace(ANSI, "").length);
    });
  }
  return all
    .map((row) =>
      row
        .map((cell, index) => (index === row.length - 1 ? cell : cell + " ".repeat(widths[index] - cell.replace(ANSI, "").length)))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}
