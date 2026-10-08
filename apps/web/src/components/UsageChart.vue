<template>
  <div class="relative h-56">
    <Line :data="data" :options="options" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Line } from 'vue-chartjs';
import { CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from 'chart.js';
import { useTheme } from '../composables/useTheme';
import { resolveColor } from '../utils/palette';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export interface ChartSeries {
  label: string;
  values: (number | null)[];
  /** A CSS color, or a token such as "var(--svc-2)": the chart follows the theme. */
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

const { resolved } = useTheme();

/** The colors of the theme in effect: a canvas cannot read CSS variables by itself. */
const palette = computed(() => {
  void resolved.value;
  return {
    text: resolveColor('var(--text-3)'),
    grid: resolveColor('var(--chart-grid)'),
    overlay: resolveColor('var(--overlay)'),
    border: resolveColor('var(--border)'),
    title: resolveColor('var(--text)'),
    body: resolveColor('var(--text-2)'),
    series: props.series.map((series) => resolveColor(series.color)),
  };
});

/** A hex color with transparency, for the area under a line; other colors keep theirs. */
function translucent(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}2e` : color;
}

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
  datasets: props.series.map((series, index) => {
    const color = palette.value.series[index];
    return {
      label: series.label,
      data: series.values,
      borderColor: color,
      backgroundColor: series.dashed ? 'transparent' : translucent(color),
      borderDash: series.dashed ? [6, 4] : undefined,
      fill: props.stacked && !series.dashed ? 'stack' : !series.dashed && props.series.length === 1 ? 'origin' : false,
      stack: series.dashed ? 'limit' : 'usage',
      borderWidth: series.dashed ? 1.25 : 1.75,
      pointRadius: 0,
      pointHoverRadius: 3,
      tension: 0.3,
    };
  }),
}));

const options = computed(() => {
  const colors = palette.value;
  const font = { family: "'Geist Mono Variable', ui-monospace, monospace", size: 11 };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        display: props.series.length > 1,
        position: 'bottom' as const,
        labels: { color: colors.text, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded' as const, font: { ...font, size: 11.5 } },
      },
      tooltip: {
        backgroundColor: colors.overlay,
        borderColor: colors.border,
        borderWidth: 1,
        titleColor: colors.title,
        bodyColor: colors.body,
        titleFont: font,
        bodyFont: font,
        padding: 10,
        boxPadding: 4,
        callbacks: { label: (item: { dataset: { label?: string }; parsed: { y: number | null } }) => ` ${item.dataset.label}: ${props.format(item.parsed.y ?? 0)}` },
      },
    },
    scales: {
      y: {
        stacked: props.stacked,
        beginAtZero: true,
        border: { display: false },
        grid: { color: colors.grid },
        ticks: { color: colors.text, font, stepSize: byteStep.value, callback: (value: number | string) => props.format(Number(value)) },
      },
      x: {
        grid: { display: false },
        border: { color: colors.grid },
        ticks: { color: colors.text, font, maxRotation: 0, maxTicksLimit: 8, autoSkip: true, autoSkipPadding: 16 },
      },
    },
  };
});
</script>
