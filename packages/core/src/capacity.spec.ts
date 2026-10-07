import { describe, expect, it } from 'vitest';
import { capacity, median } from './capacity';

const GiB = 1024 ** 3;

describe('capacity', () => {
  it('keeps the reserves free and counts whole environments', () => {
    expect(capacity({ availableMemoryBytes: 6.5 * GiB, freeDiskBytes: 100 * GiB, envMemoryBytes: 1.5 * GiB, envDiskBytes: 2 * GiB })).toEqual({
      places: 3,
      byMemory: 3,
      byDisk: 45,
      byQuota: null,
      limitedBy: 'memory',
    });
  });

  it('is limited by the disk, or the quota, when they are shorter', () => {
    expect(capacity({ availableMemoryBytes: 30 * GiB, freeDiskBytes: 14 * GiB, envMemoryBytes: GiB, envDiskBytes: 1.5 * GiB })).toMatchObject({
      places: 2,
      limitedBy: 'disk',
    });
    expect(capacity({ availableMemoryBytes: 30 * GiB, freeDiskBytes: 300 * GiB, envMemoryBytes: GiB, envDiskBytes: GiB, quotaRemaining: 1 })).toMatchObject({
      places: 1,
      limitedBy: 'quota',
    });
  });

  it('never goes below zero', () => {
    expect(capacity({ availableMemoryBytes: 0.5 * GiB, freeDiskBytes: 5 * GiB, envMemoryBytes: GiB, envDiskBytes: GiB, quotaRemaining: -2 })).toMatchObject({
      places: 0,
      byMemory: 0,
      byDisk: 0,
      byQuota: 0,
    });
  });
});

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
