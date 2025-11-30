<template>
  <div>
    <Card>
      <template #title>
        <div class="flex items-center justify-between">
          <span>Resource Usage</span>
          <Button
            icon="pi pi-refresh"
            text
            rounded
            @click="fetchHistory"
            :loading="loading"
            v-tooltip.top="'Refresh'"
          />
        </div>
      </template>
      <template #content>
        <div v-if="loading && !chartData" class="flex justify-center py-8">
          <ProgressSpinner />
        </div>

        <div v-else-if="!chartData || chartData.labels.length === 0" class="text-center py-8">
          <p class="opacity-60">No data available yet. Stats are collected every minute.</p>
        </div>

        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- CPU Chart -->
          <div class="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-300 dark:border-slate-700">
            <h3 class="text-lg font-semibold mb-4 text-slate-900 dark:text-white">CPU Usage</h3>
            <Line :data="cpuChartData" :options="chartOptions" />
          </div>

          <!-- Memory Chart -->
          <div class="bg-slate-100 dark:bg-slate-800/50 p-4 rounded-lg border border-slate-300 dark:border-slate-700">
            <h3 class="text-lg font-semibold mb-4 text-slate-900 dark:text-white">Memory Usage</h3>
            <Line :data="memoryChartData" :options="chartOptions" />
          </div>
        </div>
      </template>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import axios from 'axios';
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import Card from 'primevue/card';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface Props {
  environmentId: string;
}

const props = defineProps<Props>();

const loading = ref(false);
const chartData = ref<{
  labels: string[];
  cpu: number[];
  memory: number[];
} | null>(null);

let refreshInterval: ReturnType<typeof setInterval> | null = null;

async function fetchHistory() {
  loading.value = true;
  try {
    const response = await axios.get(`/api/environments/${props.environmentId}/stats/history`);
    const data = response.data;

    if (data.length === 0) {
      chartData.value = null;
      return;
    }

    chartData.value = {
      labels: data.map((d: any) => {
        const date = new Date(d.time);
        return date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit'
        });
      }),
      cpu: data.map((d: any) => d.cpuPercent),
      memory: data.map((d: any) => d.memoryUsageGB),
    };
  } catch (error) {
    console.error('Failed to fetch stats history:', error);
  } finally {
    loading.value = false;
  }
}

const cpuChartData = computed(() => ({
  labels: chartData.value?.labels || [],
  datasets: [
    {
      label: 'CPU %',
      data: chartData.value?.cpu || [],
      borderColor: 'rgb(59, 130, 246)',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: true,
      tension: 0.4,
    }
  ]
}));

const memoryChartData = computed(() => ({
  labels: chartData.value?.labels || [],
  datasets: [
    {
      label: 'Memory (GB)',
      data: chartData.value?.memory || [],
      borderColor: 'rgb(16, 185, 129)',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.4,
    }
  ]
}));

const chartOptions = {
  responsive: true,
  maintainAspectRatio: true,
  aspectRatio: 2,
  plugins: {
    legend: {
      display: false,
    },
    tooltip: {
      mode: 'index' as const,
      intersect: false,
    }
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(148, 163, 184, 0.1)',
      },
      ticks: {
        color: 'rgba(148, 163, 184, 0.8)',
      }
    },
    x: {
      grid: {
        display: false,
      },
      ticks: {
        color: 'rgba(148, 163, 184, 0.8)',
        maxRotation: 0,
        maxTicksLimit: 10,
      }
    }
  }
};

onMounted(() => {
  fetchHistory();

  refreshInterval = setInterval(() => {
    fetchHistory();
  }, 60000);
});

onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
});
</script>
