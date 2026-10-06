const DURATION_UNITS: Record<string, number> = {
  ns: 1e-9,
  us: 1e-6,
  µs: 1e-6,
  ms: 1e-3,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parses a duration such as "90s", "1m30s", "72h" or "14d" into seconds.
 * Accepts Go-style units (as Compose does) plus "d" for days.
 *
 * @returns The duration in seconds, or null when the value is not a duration
 */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }
  const pattern = /(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h|d)/gy;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    total += parseFloat(match[1]) * DURATION_UNITS[match[2]];
    consumed = pattern.lastIndex;
  }
  return consumed === value.length ? total : null;
}

const SIZE_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
};

/**
 * Parses a byte size the way Docker does: "512m", "1g", "1.5gb", or a plain
 * number of bytes. Units are binary (1k = 1024 bytes).
 *
 * @returns The size in bytes, or null when the value is not a size
 */
export function parseSize(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/i.exec(value.trim());
  if (!match || !(match[2].toLowerCase() in SIZE_UNITS)) {
    return null;
  }
  return Math.floor(parseFloat(match[1]) * SIZE_UNITS[match[2].toLowerCase()]);
}

/**
 * Formats bytes for messages: "512 MiB", "2 GiB".
 */
export function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3 && bytes % 1024 ** 3 === 0) {
    return `${bytes / 1024 ** 3} GiB`;
  }
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}
