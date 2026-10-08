<template>
  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <p class="text-sm text-fg-3">
        <template v-if="metrics?.now">
          Now: <span class="font-medium text-fg-2">{{ formatPercent(metrics.now.cpuPercent) }}</span> CPU,
          <span class="font-medium text-fg-2">{{ formatSize(metrics.now.memoryBytes) }}</span> of {{ formatSize(metrics.now.memoryLimitBytes) }} memory
        </template>
        <template v-else>Not running.</template>
      </p>
      <SegmentedControl v-model="range" :options="RANGES" label="Range" />
    </div>

    <div v-if="!loading && points.length === 0" class="card empty">
      <Activity class="size-5" />
      <span>Nothing measured yet over this period: usage is averaged every minute while the environment runs.</span>
    </div>
    <div v-else class="grid gap-4 xl:grid-cols-2">
      <section class="card">
        <div class="card-head">
          <div class="card-title"><MemoryStick />Memory{{ perService ? ' by service' : '' }}</div>
          <span class="field-hint">Without reclaimable cache</span>
        </div>
        <div class="card-body"><UsageChart :times="times" :series="memorySeries" :format="formatSize" :stacked="perService" :days="days" bytes /></div>
      </section>
      <section class="card">
        <div class="card-head">
          <div class="card-title"><Cpu />CPU{{ perService ? ' by service' : '' }}</div>
          <span class="field-hint">100% is one full core</span>
        </div>
        <div class="card-body"><UsageChart :times="times" :series="cpuSeries" :format="formatPercent" :stacked="perService" :days="days" /></div>
      </section>
    </div>

    <section v-if="serviceNames.length" class="card">
      <div class="card-head is-flush"><div class="card-title">Services</div></div>
      <div class="table-wrap">
        <table class="table is-compact">
          <thead>
            <tr>
              <th>Service</th>
              <th>CPU now</th>
              <th>Memory now</th>
              <th class="hidden sm:table-cell">Limit</th>
              <th class="hidden sm:table-cell">Peak ({{ range }})</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="name in serviceNames" :key="name">
              <td>
                <span class="flex items-center gap-2 font-medium"><span class="swatch" :style="{ background: colorFor(name, serviceNames) }"></span>{{ name }}</span>
              </td>
              <td class="tabular-nums">{{ formatPercent(metrics?.now?.services[name]?.cpuPercent) }}</td>
              <td class="tabular-nums">{{ formatSize(metrics?.now?.services[name]?.memoryBytes) }}</td>
              <td class="hidden tabular-nums text-fg-3 sm:table-cell">{{ formatSize(metrics?.now?.services[name]?.memoryLimitBytes) }}</td>
              <td class="hidden tabular-nums sm:table-cell">{{ formatSize(metrics?.peaks[name]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Activity, Cpu, MemoryStick } from 'lucide-vue-next';
import SegmentedControl from './SegmentedControl.vue';
import UsageChart, { type ChartSeries } from './UsageChart.vue';
import { environmentsApi } from '../services/api';
import type { EnvironmentMetrics, MetricRange } from '../types';
import { colorFor, formatPercent, formatSize } from '../utils/palette';

const props = defineProps<{ environmentId: string }>();

const RANGES: { label: string; value: MetricRange }[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '7d', value: '7d' },
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
    : [{ label: 'Memory', color: 'var(--accent)', values: points.value.map((point) => point.memoryBytes) }];
  if (points.value.some((point) => point.memoryLimitBytes)) {
    series.push({ label: 'Limit', color: 'var(--danger)', dashed: true, values: points.value.map((point) => point.memoryLimitBytes ?? null) });
  }
  if (!perService.value && points.value.some((point) => point.memoryMaxBytes)) {
    series.push({ label: 'Peak', color: 'var(--warn)', dashed: true, values: points.value.map((point) => point.memoryMaxBytes ?? null) });
  }
  return series;
});

const cpuSeries = computed<ChartSeries[]>(() =>
  perService.value
    ? serviceNames.value.map((name) => ({ label: name, color: colorFor(name, serviceNames.value), values: points.value.map((point) => point.services?.[name]?.cpu ?? 0) }))
    : [{ label: 'CPU', color: 'var(--svc-2)', values: points.value.map((point) => point.cpuPercent) }],
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
