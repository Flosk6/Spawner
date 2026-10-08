<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-4xl font-bold mb-2">System</h1>
        <p class="text-lg opacity-70">The server, who uses it, and room for more environments</p>
      </div>
      <span v-if="overview?.at" class="text-sm text-slate-500">Sampled {{ timeAgo(overview.at) }}</span>
    </div>

    <UpdatePanel />

    <div v-if="!overview" class="flex justify-center py-20"><ProgressSpinner /></div>

    <template v-else>
      <Message v-for="(alert, index) in overview.alerts" :key="index" :severity="alert.level === 'critical' ? 'error' : 'warn'" :closable="false">
        {{ alert.message }}
        <router-link v-if="alert.environmentId" :to="`/environments/${alert.environmentId}?tab=timeline`" class="underline ml-1">Timeline</router-link>
      </Message>

      <p v-if="!overview.host" class="text-sm text-slate-500">The first sample of the server is taken 30 seconds after Spawner starts.</p>

      <div v-else class="grid gap-6 lg:grid-cols-3">
        <!-- CPU -->
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-microchip text-sm"></i>CPU</h2>
          <p class="text-3xl font-bold">{{ formatPercent(overview.host.cpuPercent) }}</p>
          <p class="text-sm text-slate-500 mt-1">{{ overview.host.cpus }} cores · load {{ overview.host.load.join(' / ') }}</p>
          <p v-if="overview.host.cpuModel" class="text-xs text-slate-500 mt-1 truncate" :title="overview.host.cpuModel">{{ overview.host.cpuModel }}</p>
          <ul v-if="overview.usage" class="mt-4 space-y-1 text-sm">
            <li class="flex justify-between"><span>Environments</span><span class="font-mono text-xs">{{ formatPercent(ofServer(overview.usage.environments.cpuPercent)) }}</span></li>
            <li class="flex justify-between"><span>Spawner</span><span class="font-mono text-xs">{{ formatPercent(ofServer(overview.usage.spawner.cpuPercent)) }}</span></li>
            <li class="flex justify-between"><span>Other containers</span><span class="font-mono text-xs">{{ formatPercent(ofServer(overview.usage.others.cpuPercent)) }}</span></li>
          </ul>
          <p class="field-hint">Shares of the whole server, like the total. Environment pages count cores instead: 200% is two full cores.</p>
        </section>

        <!-- Memory -->
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-server text-sm"></i>Memory</h2>
          <p class="text-3xl font-bold">{{ formatSize(overview.host.memory.availableBytes) }} <span class="text-base font-normal text-slate-500">available</span></p>
          <p class="text-sm text-slate-500 mt-1">of {{ formatSize(overview.host.memory.totalBytes) }}<template v-if="overview.host.memory.swapTotalBytes"> · swap {{ formatSize(overview.host.memory.swapUsedBytes) }} / {{ formatSize(overview.host.memory.swapTotalBytes) }}</template></p>
          <BreakdownBar class="mt-4" :parts="memoryParts" :total="overview.host.memory.totalBytes" />
        </section>

        <!-- Disk -->
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-database text-sm"></i>Disk</h2>
          <p class="text-3xl font-bold">{{ formatSize(overview.host.disk.freeBytes) }} <span class="text-base font-normal text-slate-500">free</span></p>
          <p class="text-sm text-slate-500 mt-1 truncate">of {{ formatSize(overview.host.disk.totalBytes) }} on {{ overview.host.disk.path }}</p>
          <BreakdownBar v-if="overview.disk" class="mt-4" :parts="diskParts" :total="overview.host.disk.totalBytes" />
          <p v-if="overview.disk" class="field-hint">Measured {{ timeAgo(overview.disk.time) }}, every 15 minutes and after builds.</p>
          <p v-else class="field-hint">The first measure comes a minute after Spawner starts.</p>
        </section>
      </div>

      <!-- History -->
      <section class="panel">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="panel-title !mb-0"><i class="pi pi-chart-line text-sm"></i>History</h2>
          <SelectButton v-model="range" :options="ranges" option-label="label" option-value="value" :allow-empty="false" size="small" />
        </div>
        <p v-if="history.length === 0" class="text-sm text-slate-500">Nothing recorded over this period yet.</p>
        <div v-else class="grid gap-6 xl:grid-cols-2">
          <div>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Memory</h3>
            <UsageChart :times="historyTimes" :series="memoryHistory" :format="formatSize" stacked :days="range !== '24h'" bytes />
          </div>
          <div>
            <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">CPU of the server</h3>
            <UsageChart :times="historyTimes" :series="cpuHistory" :format="formatPercent" :days="range !== '24h'" />
          </div>
        </div>
      </section>

      <!-- Projects -->
      <section class="panel">
        <h2 class="panel-title"><i class="pi pi-folder text-sm"></i>Projects</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs uppercase text-slate-500">
              <tr>
                <th class="py-2 pr-4">Project</th>
                <th class="py-2 pr-4">Environments</th>
                <th class="py-2 pr-4">Memory now</th>
                <th class="py-2 pr-4">Disk</th>
                <th class="py-2 pr-4">One environment</th>
                <th class="py-2 pr-4">Room for</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
              <tr v-for="project in projectRows" :key="project.slug">
                <td class="py-2 pr-4 font-medium">
                  <router-link :to="`/projects/${project.slug}`" class="hover:underline">{{ project.name }}</router-link>
                </td>
                <td class="py-2 pr-4">{{ project.running }} running / {{ project.environments }}</td>
                <td class="py-2 pr-4">{{ formatSize(project.memoryBytes) }}</td>
                <td class="py-2 pr-4">{{ formatSize(project.diskBytes) }}</td>
                <td class="py-2 pr-4 text-slate-500">
                  <template v-if="project.capacity">
                    {{ formatSize(project.capacity.memoryBytes) }} memory, {{ formatSize(project.capacity.diskBytes) }} disk
                    <span v-if="project.capacity.basedOn.memory === 'limits'" v-tooltip.top="'No usage measured yet: its declared limits'">*</span>
                  </template>
                </td>
                <td class="py-2 pr-4">
                  <span v-if="project.capacity?.places !== null && project.capacity?.places !== undefined" :class="project.capacity.places === 0 ? 'text-red-600 dark:text-red-400 font-semibold' : 'font-semibold'">
                    {{ project.capacity.places }} more
                  </span>
                  <span v-if="project.capacity?.limitedBy" class="text-xs text-slate-500"> (by {{ project.capacity.limitedBy }})</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="field-hint">Room for: (available memory - 1 GiB) and (free disk - 10 GiB), divided by what one environment of the project uses; the last one must still find the memory a build waits for.</p>
      </section>

      <CleanupPanel />

      <!-- Containers -->
      <div v-if="overview.usage" class="grid gap-6 lg:grid-cols-2">
        <section v-for="group in containerGroups" :key="group.title" class="panel">
          <h2 class="panel-title"><i class="pi pi-box text-sm"></i>{{ group.title }}</h2>
          <p v-if="group.containers.length === 0" class="text-sm text-slate-500">{{ group.empty }}</p>
          <table v-else class="w-full text-sm">
            <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
              <tr v-for="container in group.containers" :key="container.name">
                <td class="py-2 pr-4">
                  <span class="font-medium">{{ container.name }}</span>
                  <span class="block text-xs text-slate-500 truncate max-w-[16rem]" :title="container.image">{{ container.image }}</span>
                </td>
                <td class="py-2 pr-4 text-right font-mono text-xs" title="Share of the whole server">{{ formatPercent(ofServer(container.cpuPercent)) }}</td>
                <td class="py-2 text-right font-mono text-xs">{{ formatSize(container.memoryBytes) }}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import SelectButton from 'primevue/selectbutton';
import BreakdownBar from '../components/BreakdownBar.vue';
import CleanupPanel from '../components/CleanupPanel.vue';
import UpdatePanel from '../components/UpdatePanel.vue';
import UsageChart, { type ChartSeries } from '../components/UsageChart.vue';
import { systemApi } from '../services/api';
import type { Capacity, MetricRange, SystemMetrics, SystemOverview } from '../types';
import { timeAgo } from '../utils/format';
import { formatPercent, formatSize } from '../utils/palette';

const ranges = [
  { label: '24 h', value: '24h' },
  { label: '7 d', value: '7d' },
  { label: '30 d', value: '30d' },
];

const overview = ref<SystemOverview | null>(null);
const capacity = ref<Capacity | null>(null);
const metrics = ref<SystemMetrics | null>(null);
const range = ref<MetricRange>('24h');
let timer: ReturnType<typeof setInterval> | null = null;

const memoryParts = computed(() => {
  const value = overview.value;
  if (!value?.host || !value.usage) {
    return [];
  }
  const total = value.host.memory.totalBytes;
  const available = value.host.memory.availableBytes;
  const containers = value.usage.environments.memoryBytes + value.usage.spawner.memoryBytes + value.usage.others.memoryBytes;
  return [
    { label: `Environments (${value.usage.environments.count})`, bytes: value.usage.environments.memoryBytes, color: '#8b5cf6' },
    { label: 'Spawner', bytes: value.usage.spawner.memoryBytes, color: '#06b6d4' },
    { label: 'Other containers', bytes: value.usage.others.memoryBytes, color: '#f59e0b' },
    { label: 'System and cache', bytes: Math.max(0, total - available - containers), color: '#94a3b8' },
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
    { label: 'Images', bytes: details.imagesBytes, color: '#8b5cf6' },
    { label: 'Build cache', bytes: details.buildCacheBytes, color: '#a78bfa' },
    { label: 'Volumes', bytes: details.volumesBytes, color: '#06b6d4' },
    { label: 'Written by containers', bytes: details.writableBytes, color: '#f59e0b' },
    { label: 'Sources', bytes: details.sourcesBytes, color: '#10b981' },
    { label: 'Logs and recordings', bytes: details.logsBytes, color: '#ec4899' },
    { label: 'Everything else', bytes: Math.max(0, used - known), color: '#94a3b8' },
    { label: 'Free', bytes: value.host.disk.freeBytes, color: 'transparent' },
  ];
});

const history = computed(() => metrics.value?.points ?? []);
const historyTimes = computed(() => history.value.map((point) => point.time));
const memoryHistory = computed<ChartSeries[]>(() => [
  { label: 'Environments', color: '#8b5cf6', values: history.value.map((point) => point.environments) },
  { label: 'Spawner', color: '#06b6d4', values: history.value.map((point) => point.spawner) },
  { label: 'Other containers', color: '#f59e0b', values: history.value.map((point) => point.others) },
  { label: 'Server total', color: '#ef4444', dashed: true, values: history.value.map((point) => point.memoryTotalBytes) },
]);
const cpuHistory = computed<ChartSeries[]>(() => [{ label: 'CPU', color: '#06b6d4', values: history.value.map((point) => point.cpuPercent) }]);

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
