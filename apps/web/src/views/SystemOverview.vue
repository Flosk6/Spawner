<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">System</h1>
      <p class="page-lead">The server, who uses it, and room for more environments.</p>
    </div>
    <span v-if="overview?.at" class="field-hint">Sampled {{ timeAgo(overview.at) }}</span>
  </div>

  <UpdatePanel />

  <div v-if="!overview" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <template v-else>
    <div v-for="(alert, index) in overview.alerts" :key="index" class="alert" :class="alert.level === 'critical' ? 'tone-danger' : 'tone-warn'">
      <TriangleAlert />
      <div class="alert-body"><span class="alert-title">{{ alert.message }}</span></div>
      <div v-if="alert.environmentId" class="alert-actions">
        <RouterLink :to="`/environments/${alert.environmentId}?tab=timeline`" class="btn btn-secondary btn-sm">Timeline</RouterLink>
      </div>
    </div>

    <div v-if="!overview.host" class="card empty">
      <Activity class="size-5" />
      <span>The first sample of the server is taken 30 seconds after Spawner starts.</span>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-3">
      <section class="card">
        <div class="card-head">
          <div class="card-title"><Cpu />CPU</div>
          <span class="field-hint">{{ overview.host.cpus }} core{{ overview.host.cpus === 1 ? '' : 's' }}</span>
        </div>
        <div class="card-body flex flex-col gap-4">
          <div class="min-w-0">
            <div class="stat-value">{{ formatPercent(overview.host.cpuPercent) }}</div>
            <p class="stat-meta tabular-nums">Load {{ overview.host.load.join(' / ') }}</p>
            <p v-if="overview.host.cpuModel" class="stat-meta truncate" :title="overview.host.cpuModel">{{ overview.host.cpuModel }}</p>
          </div>
          <div v-if="cpuParts.length > 0" class="flex flex-col gap-3">
            <div class="bar bar-lg">
              <span
                v-for="part in cpuParts.filter((item) => item.percent > 0)"
                :key="part.label"
                class="bar-fill"
                :style="{ width: `${Math.min(100, part.percent)}%`, background: part.color }"
                :title="`${part.label}: ${formatPercent(part.percent)}`"
              ></span>
            </div>
            <ul class="flex flex-col gap-1.5 text-[13px]">
              <li v-for="part in cpuParts" :key="part.label" class="flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-2 text-fg-2">
                  <span class="swatch" :style="{ background: part.color }"></span><span class="truncate">{{ part.label }}</span>
                </span>
                <span class="flex-none font-mono text-xs">{{ formatPercent(part.percent) }}</span>
              </li>
            </ul>
          </div>
          <p class="field-hint">Shares of the whole server, like the total. Environment pages count cores instead: 200% is two full cores.</p>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title"><MemoryStick />Memory</div>
          <span class="field-hint">{{ formatSize(overview.host.memory.totalBytes) }} in all</span>
        </div>
        <div class="card-body flex flex-col gap-4">
          <div>
            <div class="stat-value">{{ formatSize(overview.host.memory.availableBytes) }}<small>available</small></div>
            <p v-if="overview.host.memory.swapTotalBytes" class="stat-meta">
              Swap {{ formatSize(overview.host.memory.swapUsedBytes) }} of {{ formatSize(overview.host.memory.swapTotalBytes) }} used
            </p>
          </div>
          <BreakdownBar v-if="memoryParts.length > 0" :parts="memoryParts" :total="overview.host.memory.totalBytes" />
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="card-title"><HardDrive />Disk</div>
          <span class="field-hint">{{ formatSize(overview.host.disk.totalBytes) }} in all</span>
        </div>
        <div class="card-body flex flex-col gap-4">
          <div class="min-w-0">
            <div class="stat-value">{{ formatSize(overview.host.disk.freeBytes) }}<small>free</small></div>
            <p class="stat-meta truncate" :title="overview.host.disk.path">On <span class="font-mono">{{ overview.host.disk.path }}</span></p>
          </div>
          <BreakdownBar v-if="overview.disk" :parts="diskParts" :total="overview.host.disk.totalBytes" />
          <p v-if="overview.disk" class="field-hint">Measured {{ timeAgo(overview.disk.time) }}, every 15 minutes and after builds.</p>
          <p v-else class="field-hint">The first measure comes a minute after Spawner starts.</p>
        </div>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <div class="card-title"><ChartLine />History</div>
        <SegmentedControl v-model="range" :options="RANGES" label="Range" />
      </div>
      <div v-if="history.length === 0" class="empty">Nothing recorded over this period yet.</div>
      <div v-else class="card-body grid gap-6 xl:grid-cols-2">
        <div class="min-w-0">
          <h3 class="mb-2 text-[13px] font-medium text-fg-2">Memory</h3>
          <UsageChart :times="historyTimes" :series="memoryHistory" :format="formatSize" stacked :days="range !== '24h'" bytes />
        </div>
        <div class="min-w-0">
          <h3 class="mb-2 text-[13px] font-medium text-fg-2">CPU of the server</h3>
          <UsageChart :times="historyTimes" :series="cpuHistory" :format="formatPercent" :days="range !== '24h'" />
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head is-flush">
        <div class="card-title"><FolderGit2 />Projects<span class="count">{{ projectRows.length }}</span></div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Environments</th>
              <th class="hidden md:table-cell">Memory now</th>
              <th class="hidden md:table-cell">Disk</th>
              <th class="hidden lg:table-cell">One environment</th>
              <th>Room for</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="project in projectRows" :key="project.slug">
              <td class="max-w-[16rem]">
                <RouterLink :to="`/projects/${project.slug}`" class="row-title block">{{ project.name }}</RouterLink>
              </td>
              <td class="tabular-nums text-fg-2">{{ project.running }} running / {{ project.environments }}</td>
              <td class="hidden tabular-nums md:table-cell">{{ formatSize(project.memoryBytes) }}</td>
              <td class="hidden tabular-nums md:table-cell">{{ formatSize(project.diskBytes) }}</td>
              <td class="hidden tabular-nums text-fg-2 lg:table-cell">
                <template v-if="project.capacity">
                  {{ formatSize(project.capacity.memoryBytes) }} memory, {{ formatSize(project.capacity.diskBytes) }} disk
                  <span
                    v-if="project.capacity.basedOn.memory === 'limits'"
                    v-tooltip.top="'No usage measured yet: its declared limits'"
                    class="cursor-help text-fg-3"
                  >*</span>
                </template>
                <span v-else class="text-fg-3">-</span>
              </td>
              <td class="whitespace-nowrap">
                <template v-if="project.capacity?.places !== null && project.capacity?.places !== undefined">
                  <span class="font-semibold tabular-nums" :class="{ 'text-danger-text': project.capacity.places === 0 }">
                    {{ project.capacity.places }} more
                  </span>
                  <span v-if="project.capacity.limitedBy" class="text-xs text-fg-3"> (by {{ project.capacity.limitedBy }})</span>
                </template>
                <span v-else class="text-fg-3">-</span>
              </td>
            </tr>
            <tr v-if="projectRows.length === 0">
              <td colspan="6"><div class="empty">No project yet.</div></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="card-foot">
        <p>
          Room for: (available memory - 1 GiB) and (free disk - 10 GiB), divided by what one environment of the project uses; the last one must
          still find the memory a build waits for.
        </p>
      </div>
    </section>

    <CleanupPanel />

    <div v-if="overview.usage" class="grid items-start gap-4 lg:grid-cols-2">
      <section v-for="group in containerGroups" :key="group.title" class="card">
        <div class="card-head" :class="{ 'is-flush': group.containers.length > 0 }">
          <div class="card-title"><Container />{{ group.title }}<span class="count">{{ group.containers.length }}</span></div>
        </div>
        <div v-if="group.containers.length === 0" class="empty">{{ group.empty }}</div>
        <div v-else class="table-wrap">
          <table class="table is-compact">
            <thead>
              <tr>
                <th>Container</th>
                <th class="text-right" title="Share of the whole server">CPU</th>
                <th class="text-right">Memory</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="container in group.containers" :key="container.name">
                <td class="w-full max-w-0">
                  <div class="truncate font-mono text-[12.5px] font-medium" :title="container.name">{{ container.name }}</div>
                  <div class="truncate text-xs text-fg-3" :title="container.image">{{ container.image }}</div>
                </td>
                <td class="whitespace-nowrap text-right tabular-nums" title="Share of the whole server">
                  {{ formatPercent(ofServer(container.cpuPercent)) }}
                </td>
                <td class="whitespace-nowrap text-right tabular-nums">{{ formatSize(container.memoryBytes) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Activity, ChartLine, Container, Cpu, FolderGit2, HardDrive, LoaderCircle, MemoryStick, TriangleAlert } from 'lucide-vue-next';
import BreakdownBar from '../components/BreakdownBar.vue';
import CleanupPanel from '../components/CleanupPanel.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import UpdatePanel from '../components/UpdatePanel.vue';
import UsageChart, { type ChartSeries } from '../components/UsageChart.vue';
import { systemApi } from '../services/api';
import type { Capacity, MetricRange, SystemMetrics, SystemOverview } from '../types';
import { timeAgo } from '../utils/format';
import { formatPercent, formatSize } from '../utils/palette';

const RANGES: { label: string; value: MetricRange }[] = [
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
  { label: '30d', value: '30d' },
];

/** One color per group of containers, the same on the bars and the charts. */
const GROUP_COLORS = { environments: 'var(--svc-1)', spawner: 'var(--svc-2)', others: 'var(--svc-3)' };

const overview = ref<SystemOverview | null>(null);
const capacity = ref<Capacity | null>(null);
const metrics = ref<SystemMetrics | null>(null);
const range = ref<MetricRange>('24h');
let timer: ReturnType<typeof setInterval> | null = null;

/** The CPU of each group of containers, as a share of the whole server. */
const cpuParts = computed(() => {
  const usage = overview.value?.usage;
  if (!usage) {
    return [];
  }
  return [
    { label: 'Environments', percent: ofServer(usage.environments.cpuPercent), color: GROUP_COLORS.environments },
    { label: 'Spawner', percent: ofServer(usage.spawner.cpuPercent), color: GROUP_COLORS.spawner },
    { label: 'Other containers', percent: ofServer(usage.others.cpuPercent), color: GROUP_COLORS.others },
  ];
});

const memoryParts = computed(() => {
  const value = overview.value;
  if (!value?.host || !value.usage) {
    return [];
  }
  const total = value.host.memory.totalBytes;
  const available = value.host.memory.availableBytes;
  const containers = value.usage.environments.memoryBytes + value.usage.spawner.memoryBytes + value.usage.others.memoryBytes;
  return [
    { label: `Environments (${value.usage.environments.count})`, bytes: value.usage.environments.memoryBytes, color: GROUP_COLORS.environments },
    { label: 'Spawner', bytes: value.usage.spawner.memoryBytes, color: GROUP_COLORS.spawner },
    { label: 'Other containers', bytes: value.usage.others.memoryBytes, color: GROUP_COLORS.others },
    { label: 'System and cache', bytes: Math.max(0, total - available - containers), color: 'var(--muted)' },
    { label: 'Available', bytes: available, color: 'transparent' },
  ];
});

const diskParts = computed(() => {
  const value = overview.value;
  if (!value?.disk || !value.host) {
    return [];
  }
  const details = value.disk.details;
  const known = details.imagesBytes + details.buildCacheBytes + details.volumesBytes + details.writableBytes + details.sourcesBytes + details.logsBytes;
  const used = value.host.disk.totalBytes - value.host.disk.freeBytes;
  return [
    { label: 'Images', bytes: details.imagesBytes, color: 'var(--svc-1)' },
    { label: 'Build cache', bytes: details.buildCacheBytes, color: 'var(--svc-6)' },
    { label: 'Volumes', bytes: details.volumesBytes, color: 'var(--svc-2)' },
    { label: 'Written by containers', bytes: details.writableBytes, color: 'var(--svc-3)' },
    { label: 'Sources', bytes: details.sourcesBytes, color: 'var(--svc-4)' },
    { label: 'Logs and recordings', bytes: details.logsBytes, color: 'var(--svc-5)' },
    { label: 'Everything else', bytes: Math.max(0, used - known), color: 'var(--muted)' },
    { label: 'Free', bytes: value.host.disk.freeBytes, color: 'transparent' },
  ];
});

const history = computed(() => metrics.value?.points ?? []);
const historyTimes = computed(() => history.value.map((point) => point.time));
const memoryHistory = computed<ChartSeries[]>(() => [
  { label: 'Environments', color: GROUP_COLORS.environments, values: history.value.map((point) => point.environments) },
  { label: 'Spawner', color: GROUP_COLORS.spawner, values: history.value.map((point) => point.spawner) },
  { label: 'Other containers', color: GROUP_COLORS.others, values: history.value.map((point) => point.others) },
  { label: 'Server total', color: 'var(--danger)', dashed: true, values: history.value.map((point) => point.memoryTotalBytes) },
]);
const cpuHistory = computed<ChartSeries[]>(() => [{ label: 'CPU', color: 'var(--accent)', values: history.value.map((point) => point.cpuPercent) }]);

const projectRows = computed(() =>
  (overview.value?.projects ?? []).map((project) => ({ ...project, capacity: capacity.value?.projects.find((entry) => entry.project === project.slug) ?? null })),
);

/**
 * Docker counts the CPU of a container in cores (200% is two cores); the
 * server's total is a share of all its cores.
 */
function ofServer(percent: number): number {
  return percent / Math.max(1, overview.value?.host?.cpus ?? 1);
}

const containerGroups = computed(() =>
  overview.value?.usage
    ? [
        { title: "Spawner's containers", containers: overview.value.usage.spawner.containers, empty: 'Spawner does not run in a container here.' },
        { title: 'Other containers of the server', containers: overview.value.usage.others.containers, empty: 'None: the server runs Spawner only.' },
      ]
    : [],
);

async function load() {
  const [nextOverview, nextCapacity] = await Promise.all([systemApi.overview().catch(() => null), systemApi.capacity().catch(() => null)]);
  overview.value = nextOverview ?? overview.value;
  capacity.value = nextCapacity ?? capacity.value;
}

async function loadMetrics() {
  metrics.value = await systemApi.metrics(range.value).catch(() => null);
}

watch(range, loadMetrics);

onMounted(() => {
  load();
  loadMetrics();
  timer = setInterval(() => {
    load();
    loadMetrics();
  }, 30_000);
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
  }
});
</script>
