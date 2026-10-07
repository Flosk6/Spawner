<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-slate-500">
        <template v-if="metrics?.now">
          Now: {{ formatPercent(metrics.now.cpuPercent) }} CPU, {{ formatSize(metrics.now.memoryBytes) }} of {{ formatSize(metrics.now.memoryLimitBytes) }} memory
        </template>
        <template v-else>Not running.</template>
      </p>
      <SelectButton v-model="range" :options="ranges" option-label="label" option-value="value" :allow-empty="false" size="small" />
    </div>

    <p v-if="!loading && points.length === 0" class="text-sm text-slate-500 py-6 text-center">
      Nothing measured yet over this period: usage is averaged every minute while the environment runs.
    </p>
    <div v-else class="grid gap-6 xl:grid-cols-2">
      <div>
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Memory{{ perService ? ' by service' : '' }}</h3>
        <UsageChart :times="times" :series="memorySeries" :format="formatSize" :stacked="perService" :days="days" bytes />
      </div>
      <div>
        <h3 class="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">CPU{{ perService ? ' by service' : '' }}</h3>
        <UsageChart :times="times" :series="cpuSeries" :format="formatPercent" :stacked="perService" :days="days" />
      </div>
    </div>

    <div v-if="serviceNames.length" class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="text-left text-xs uppercase text-slate-500">
          <tr>
            <th class="py-2 pr-4">Service</th>
            <th class="py-2 pr-4">CPU now</th>
            <th class="py-2 pr-4">Memory now</th>
            <th class="py-2 pr-4">Limit</th>
            <th class="py-2 pr-4">Peak ({{ range }})</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
          <tr v-for="name in serviceNames" :key="name">
            <td class="py-2 pr-4 font-medium">
              <span class="inline-block h-2 w-2 rounded-full mr-2" :style="{ background: colorFor(name, serviceNames) }"></span>{{ name }}
            </td>
            <td class="py-2 pr-4">{{ formatPercent(metrics?.now?.services[name]?.cpuPercent) }}</td>
            <td class="py-2 pr-4">{{ formatSize(metrics?.now?.services[name]?.memoryBytes) }}</td>
            <td class="py-2 pr-4">{{ formatSize(metrics?.now?.services[name]?.memoryLimitBytes) }}</td>
            <td class="py-2 pr-4">{{ formatSize(metrics?.peaks[name]) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SelectButton from 'primevue/selectbutton';
import UsageChart, { type ChartSeries } from './UsageChart.vue';
import { environmentsApi } from '../services/api';
import type { EnvironmentMetrics, MetricRange } from '../types';
import { colorFor, formatPercent, formatSize } from '../utils/palette';

const props = defineProps<{ environmentId: string }>();

const ranges = [
  { label: '1 h', value: '1h' },
  { label: '6 h', value: '6h' },
  { label: '24 h', value: '24h' },
  { label: '7 d', value: '7d' },
];
const range = ref<MetricRange>('24h');
const metrics = ref<EnvironmentMetrics | null>(null);
const loading = ref(true);
let timer: ReturnType<typeof setInterval> | null = null;

const points = computed(() => metrics.value?.points ?? []);
const times = computed(() => points.value.map((point) => point.time));
const days = computed(() => range.value === '7d');
const serviceNames = computed(() => {
  const names = new Set<string>(Object.keys(metrics.value?.now?.services ?? {}));
  points.value.forEach((point) => Object.keys(point.services ?? {}).forEach((name) => names.add(name)));
  return [...names].sort();
});
const perService = computed(() => points.value.some((point) => point.services && Object.keys(point.services).length > 0));

const memorySeries = computed<ChartSeries[]>(() => {
  const series: ChartSeries[] = perService.value
    ? serviceNames.value.map((name) => ({ label: name, color: colorFor(name, serviceNames.value), values: points.value.map((point) => point.services?.[name]?.memory ?? 0) }))
    : [{ label: 'Memory', color: '#8b5cf6', values: points.value.map((point) => point.memoryBytes) }];
  if (points.value.some((point) => point.memoryLimitBytes)) {
    series.push({ label: 'Limit', color: '#ef4444', dashed: true, values: points.value.map((point) => point.memoryLimitBytes ?? null) });
  }
  if (!perService.value && points.value.some((point) => point.memoryMaxBytes)) {
    series.push({ label: 'Peak', color: '#f59e0b', dashed: true, values: points.value.map((point) => point.memoryMaxBytes ?? null) });
  }
  return series;
});

const cpuSeries = computed<ChartSeries[]>(() =>
  perService.value
    ? serviceNames.value.map((name) => ({ label: name, color: colorFor(name, serviceNames.value), values: points.value.map((point) => point.services?.[name]?.cpu ?? 0) }))
    : [{ label: 'CPU', color: '#06b6d4', values: points.value.map((point) => point.cpuPercent) }],
);

async function load() {
  try {
    metrics.value = await environmentsApi.metrics(props.environmentId, range.value);
  } catch {
    metrics.value = null;
  } finally {
    loading.value = false;
  }
}

watch(range, () => {
  loading.value = true;
  load();
});

onMounted(() => {
  load();
  timer = setInterval(load, 60_000);
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
  }
});
</script>
