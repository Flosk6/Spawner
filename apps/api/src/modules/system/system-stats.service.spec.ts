import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'os';
import { SystemStatsService } from './system-stats.service';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, totalmem: vi.fn(), freemem: vi.fn() };
});

const GB = 1024 ** 3;

describe('SystemStatsService.checkMemoryAvailability', () => {
  const service = new SystemStatsService();
  service.meminfoPath = '/nonexistent/meminfo';

  beforeEach(() => {
    vi.mocked(os.totalmem).mockReturnValue(16 * GB);
  });

  it('allows a build when enough memory is free', () => {
    vi.mocked(os.freemem).mockReturnValue(6 * GB);

    const result = service.checkMemoryAvailability(2 * GB);

    expect(result.available).toBe(true);
    expect(result.details.memoryAvailableGB).toBe('6.00');
  });

  it('refuses a build below the threshold and says how much is missing', () => {
    vi.mocked(os.freemem).mockReturnValue(1.5 * GB);

    const result = service.checkMemoryAvailability(2 * GB);

    expect(result.available).toBe(false);
    expect(result.message).toContain('1.50GB available, 2.00GB required');
  });

  it('accepts exactly the threshold', () => {
    vi.mocked(os.freemem).mockReturnValue(2 * GB);

    expect(service.checkMemoryAvailability(2 * GB).available).toBe(true);
  });

  it('reports memory usage as a percentage with one decimal', () => {
    vi.mocked(os.freemem).mockReturnValue(4 * GB);

    expect(service.getMemoryStats().usagePercent).toBe(75);
  });
});

describe('SystemStatsService on Linux', () => {
  it('counts the memory the kernel can hand out, cache included', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const file = path.join(fs.mkdtempSync(path.join((await vi.importActual<typeof import('os')>('os')).tmpdir(), 'meminfo-')), 'meminfo');
    fs.writeFileSync(file, 'MemTotal: 8388608 kB\nMemFree: 524288 kB\nMemAvailable: 4194304 kB\n');
    const service = new SystemStatsService();
    service.meminfoPath = file;
    expect(service.getMemoryStats()).toMatchObject({ total: 8 * GB, free: 4 * GB, used: 4 * GB, usagePercent: 50 });
  });
});
