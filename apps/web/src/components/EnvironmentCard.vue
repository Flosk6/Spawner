<template>
  <div class="group relative rounded-2xl p-[1.5px] transition-all duration-300 cursor-pointer"
    :class="gradientBorderClass" @click="$emit('view', environment)">
    <!-- Card Background - adapts to theme -->
    <div class="relative rounded-2xl bg-white dark:bg-dark-800 p-6 h-full overflow-hidden">
      <!-- Top shine effect -->
      <div
        class="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-slate-400/40 dark:via-white/30 to-transparent">
      </div>

      <!-- Status row -->
      <div class="flex items-center justify-between mb-4">
        <div class="flex items-center gap-2">
          <span class="relative flex h-3 w-3">
            <span v-if="environment.status === 'running' || environment.status === 'creating' || environment.status === 'updating'"
              :class="['animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', statusDotColor]"></span>
            <span :class="['relative inline-flex rounded-full h-3 w-3', statusDotColor]"></span>
          </span>
          <span :class="['text-xs font-semibold uppercase tracking-wider', statusTextColor]">
            {{ environment.status }}
          </span>
        </div>
        <span class="text-xs text-slate-500 dark:text-slate-500">{{ timeAgo }}</span>
      </div>

      <!-- Environment name and branch -->
      <div class="flex gap-2">
        <h3
          class="text-xl font-bold text-slate-900 dark:text-white mb-1 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {{ environment.name }}
        </h3>

        <!-- Project badge -->
        <div
          class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-200/80 dark:bg-dark-700/50 backdrop-blur-sm border border-slate-300/50 dark:border-purple-800/30 mb-6">
          <i class="pi pi-folder text-blue-600 dark:text-blue-400 text-xs"></i>
          <span class="text-xs font-medium text-slate-700 dark:text-slate-300">{{ projectName }}</span>
        </div>
      </div>


      <!-- Resources grid -->
      <div class="grid grid-cols-3 gap-3 mb-6">
        <div
          class="bg-slate-200/60 dark:bg-dark-700/50 backdrop-blur-sm rounded-lg p-3 border border-slate-300/50 dark:border-purple-800/30">
          <i
            :class="['text-sm block mb-1', resourcesHealthy ? 'pi pi-check-circle text-green-600 dark:text-green-400' : 'pi pi-exclamation-circle text-red-600 dark:text-red-400']"></i>
          <p class="text-xs text-slate-600 dark:text-slate-500">Resources</p>
          <p class="text-lg font-bold text-slate-900 dark:text-white">{{ resourcesCount }}</p>
        </div>
        <div
          class="bg-slate-200/60 dark:bg-dark-700/50 backdrop-blur-sm rounded-lg p-3 border border-slate-300/50 dark:border-purple-800/30">
          <i class="pi pi-server text-purple-600 dark:text-purple-400 text-sm block mb-1"></i>
          <p class="text-xs text-slate-600 dark:text-slate-500">CPU</p>
          <p class="text-lg font-bold text-slate-900 dark:text-white">{{ cpuUsage }}</p>
        </div>
        <div
          class="bg-slate-200/60 dark:bg-dark-700/50 backdrop-blur-sm rounded-lg p-3 border border-slate-300/50 dark:border-purple-800/30">
          <i class="pi pi-chart-bar text-emerald-600 dark:text-emerald-400 text-sm block mb-1"></i>
          <p class="text-xs text-slate-600 dark:text-slate-500">RAM</p>
          <p class="text-lg font-bold text-slate-900 dark:text-white">{{ memoryUsage }}</p>
        </div>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-2" @click.stop>
        <!-- View Button -->
        <button
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 hover:border-slate-400 dark:hover:border-slate-600 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('view', environment)" v-tooltip.top="'View'">
          <i class="pi pi-eye text-slate-600 dark:text-slate-400 transition-colors"></i>
        </button>

        <!-- Pause Button -->
        <button v-if="environment.status === 'running'"
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 hover:border-slate-400 dark:hover:border-slate-600 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('pause', environment)" v-tooltip.top="'Pause'">
          <i v-if="!loading" class="pi pi-pause text-slate-600 dark:text-slate-400 transition-colors"></i>
          <i v-else class="pi pi-spin pi-spinner text-slate-600 dark:text-slate-400 transition-colors"></i>
        </button>

        <!-- Resume Button -->
        <button v-if="environment.status === 'paused'"
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-green-100 dark:hover:bg-green-900/30 border border-slate-300/50 dark:border-purple-800/30 hover:border-green-400 dark:hover:border-green-500/50 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('resume', environment)" v-tooltip.top="'Resume'">
          <i v-if="!loading"
            class="pi pi-play text-slate-600 dark:text-slate-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"></i>
          <i v-else class="pi pi-spin pi-spinner text-slate-600 dark:text-slate-400 transition-colors"></i>
        </button>

        <!-- Restart Button -->
        <button v-if="environment.status === 'running'"
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 hover:border-slate-400 dark:hover:border-slate-600 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('restart', environment)" v-tooltip.top="'Restart'">
          <i v-if="!loading" class="pi pi-refresh text-slate-600 dark:text-slate-400 transition-colors"></i>
          <i v-else class="pi pi-spin pi-spinner text-slate-600 dark:text-slate-400 transition-colors"></i>
        </button>

        <!-- Update Button -->
        <button v-if="environment.status === 'running' || environment.status === 'paused'"
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-blue-100 dark:hover:bg-blue-900/30 border border-slate-300/50 dark:border-purple-800/30 hover:border-blue-400 dark:hover:border-blue-500/50 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('update', environment)" v-tooltip.top="'Update'">
          <i v-if="!loading"
            class="pi pi-upload text-slate-600 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"></i>
          <i v-else class="pi pi-spin pi-spinner text-slate-600 dark:text-slate-400 transition-colors"></i>
        </button>

        <!-- Delete Button -->
        <button
          :disabled="loading"
          class="flex-1 px-3 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-red-100 dark:hover:bg-red-900/30 border border-slate-300/50 dark:border-purple-800/30 hover:border-red-400 dark:hover:border-red-500/50 rounded-lg transition-all duration-200 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          @click="$emit('delete', environment)" v-tooltip.top="'Delete'">
          <i
            class="pi pi-trash text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"></i>
        </button>
      </div>

      <!-- Hover glow effect -->
      <div
        class="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-10 dark:group-hover:opacity-10 bg-gradient-to-br from-blue-500 to-purple-500 transition-opacity pointer-events-none">
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import axios from 'axios';
import type { Environment } from '../types';

interface Props {
  environment: Environment;
  loading?: boolean;
}

const props = defineProps<Props>();

defineEmits<{
  view: [environment: Environment];
  delete: [environment: Environment];
  pause: [environment: Environment];
  resume: [environment: Environment];
  restart: [environment: Environment];
  update: [environment: Environment];
}>();

const stats = ref<{
  cpuPercent: number;
  memoryUsageGB: number;
  memoryLimitGB: number;
} | null>(null);

async function fetchStats() {
  if (props.environment.status !== 'running') {
    return;
  }

  try {
    const response = await axios.get(`/api/environments/${props.environment.id}/stats`);
    stats.value = response.data;
  } catch (error) {
    console.error('Failed to fetch stats:', error);
  }
}

onMounted(() => {
  fetchStats();
});

const gradientBorderClass = computed(() => {
  const gradients = {
    running: 'bg-gradient-to-br from-emerald-500 via-green-500 to-teal-600 hover:shadow-2xl hover:shadow-green-500/20',
    creating: 'bg-gradient-to-br from-blue-500 via-cyan-500 to-sky-600 hover:shadow-2xl hover:shadow-blue-500/20',
    updating: 'bg-gradient-to-br from-blue-500 via-cyan-500 to-sky-600 hover:shadow-2xl hover:shadow-blue-500/20',
    failed: 'bg-gradient-to-br from-red-500 via-rose-500 to-pink-600 hover:shadow-2xl hover:shadow-red-500/20',
    paused: 'bg-gradient-to-br from-amber-500 via-orange-500 to-yellow-600 hover:shadow-2xl hover:shadow-orange-500/20',
    deleting: 'bg-gradient-to-br from-orange-500 via-amber-500 to-yellow-600 hover:shadow-2xl hover:shadow-orange-500/20'
  };
  return gradients[props.environment.status as keyof typeof gradients] || gradients.failed;
});

const statusDotColor = computed(() => {
  const colors = {
    running: 'bg-green-500',
    creating: 'bg-blue-500',
    updating: 'bg-blue-500',
    failed: 'bg-red-500',
    paused: 'bg-amber-500',
    deleting: 'bg-orange-500'
  };
  return colors[props.environment.status as keyof typeof colors] || colors.failed;
});

const statusTextColor = computed(() => {
  const colors = {
    running: 'text-green-400',
    creating: 'text-blue-400',
    updating: 'text-blue-400',
    failed: 'text-red-400',
    paused: 'text-amber-400',
    deleting: 'text-orange-400'
  };
  return colors[props.environment.status as keyof typeof colors] || colors.failed;
});

const projectName = computed(() => {
  return props.environment.project?.name || 'Unknown Project';
});

const resourcesCount = computed(() => {
  const resources = (props.environment as any).resources;
  if (!resources || resources.length === 0) {
    return '-';
  }
  const total = resources.length;

  if (props.environment.status === 'running') {
    return `${total}/${total}`;
  } else if (props.environment.status === 'creating') {
    return `0/${total}`;
  } else if (props.environment.status === 'failed') {
    return `0/${total}`;
  }

  return `${total}/${total}`;
});

const resourcesHealthy = computed(() => {
  return props.environment.status === 'running';
});

const cpuUsage = computed(() => {
  if (props.environment.status === 'running' && stats.value) {
    return stats.value.cpuPercent.toFixed(1) + '%';
  }
  return '-';
});

const memoryUsage = computed(() => {
  if (props.environment.status === 'running' && stats.value) {
    return stats.value.memoryUsageGB.toFixed(1) + 'G';
  }
  return '-';
});

const timeAgo = computed(() => {
  if (!props.environment.createdAt) return '';

  const date = new Date(props.environment.createdAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
});
</script>
