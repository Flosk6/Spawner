export function timeAgo(date: string | null | undefined): string {
  if (!date) {
    return '';
  }
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const units: [number, string][] = [
    [60 * 60 * 24, 'day'],
    [60 * 60, 'hour'],
    [60, 'minute'],
  ];
  for (const [size, unit] of units) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return `${count} ${unit}${count > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

/** "in 3 days", "in 5 hours", or "expired". */
export function timeLeft(date: string | null | undefined): string {
  if (!date) {
    return '';
  }
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  if (seconds <= 0) {
    return 'expired';
  }
  const hours = Math.floor(seconds / 3600);
  if (hours >= 48) {
    return `in ${Math.floor(hours / 24)} days`;
  }
  if (hours >= 1) {
    return `in ${hours} hour${hours > 1 ? 's' : ''}`;
  }
  const minutes = Math.max(1, Math.floor(seconds / 60));
  return `in ${minutes} minute${minutes > 1 ? 's' : ''}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) {
    return '';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
