<template>
  <div class="relative h-56">
    <Line :data="data" :options="options" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  color: string;
  /** A dashed line (a limit), not stacked with the others. */
  dashed?: boolean;
}

const props = defineProps<{
  times: string[];
  series: ChartSeries[];
  format: (value: number) => string;
  /** Stack the series (services adding up to their environment). */
  stacked?: boolean;
  /** Show dates rather than times on the axis (ranges of several days). */
  days?: boolean;
  /** Values are bytes: ticks fall on round binary sizes (256 MiB, 512 MiB...). */
  bytes?: boolean;
}>();

/**
 * Step of a byte axis: the smallest power of two of MiB that keeps at most
 * six ticks up to the highest point drawn (stacked series add up).
 */
const byteStep = computed(() => {
  if (!props.bytes) {
    return undefined;
  }
  const value = (series: ChartSeries, index: number) => series.values[index] ?? 0;
  const tops = props.times.map((_, index) => {
    const usage = props.series.filter((series) => !series.dashed).map((series) => value(series, index));
    const limits = props.series.filter((series) => series.dashed).map((series) => value(series, index));
    return Math.max(props.stacked ? usage.reduce((sum, item) => sum + item, 0) : Math.max(0, ...usage), ...limits);
  });
  const top = Math.max(1, ...tops);
  let step = 1024 * 1024;
  while (top / step > 6) {
    step *= 2;
  }
  return step;
});

const data = computed(() => ({
  labels: props.times.map((time) =>
    new Date(time).toLocaleString(undefined, props.days ? { month: 'short', day: 'numeric', hour: '2-digit' } : { hour: '2-digit', minute: '2-digit' }),
  ),
  datasets: props.series.map((series) => ({
    label: series.label,
    data: series.values,
    borderColor: series.color,
    backgroundColor: series.dashed ? 'transparent' : `${series.color}33`,
    borderDash: series.dashed ? [6, 4] : undefined,
    fill: props.stacked && !series.dashed ? 'stack' : false,
    stack: series.dashed ? 'limit' : 'usage',
    borderWidth: series.dashed ? 1.5 : 2,
    pointRadius: 0,
    tension: 0.3,
  })),
}));

const options = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false as const,
  interaction: { mode: 'index' as const, intersect: false },
  plugins: {
    legend: { display: props.series.length > 1, labels: { color: 'rgba(148, 163, 184, 0.9)', boxWidth: 12 } },
    tooltip: { callbacks: { label: (item: { dataset: { label?: string }; parsed: { y: number | null } }) => `${item.dataset.label}: ${props.format(item.parsed.y ?? 0)}` } },
  },
  scales: {
    y: {
      stacked: props.stacked,
      beginAtZero: true,
      grid: { color: 'rgba(148, 163, 184, 0.12)' },
      ticks: { color: 'rgba(148, 163, 184, 0.8)', stepSize: byteStep.value, callback: (value: number | string) => props.format(Number(value)) },
    },
    x: { grid: { display: false }, ticks: { color: 'rgba(148, 163, 184, 0.8)', maxRotation: 0, maxTicksLimit: 8 } },
  },
}));
</script>
