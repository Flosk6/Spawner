<template>
  <div class="space-y-6">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">System Overview</h1>
      <p class="mt-2 text-sm text-gray-600 dark:text-slate-400">
        Monitor host system and Spawner environments resources
      </p>
    </div>

    <!-- System Resources -->
    <div class="bg-white dark:bg-dark-800 shadow rounded-lg p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-semibold">System Resources</h2>
          <p class="text-sm text-gray-600 dark:text-slate-400 mt-1">Host machine resources</p>
        </div>
        <button
          @click="refreshSystemStats"
          :disabled="loadingSystemStats"
          class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-purple-500/10 dark:bg-dark-700 disabled:opacity-50"
        >
          {{ loadingSystemStats ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="hostStats" class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <!-- CPU -->
        <div class="border border-gray-200 dark:border-purple-800/30 rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-slate-300">CPU</h3>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ hostStats.cpu.usage }}%</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-dark-700 rounded-full h-2 mb-2">
            <div
              class="h-2 rounded-full transition-all duration-300"
              :class="hostStats.cpu.usage > 80 ? 'bg-red-600' : hostStats.cpu.usage > 50 ? 'bg-yellow-500' : 'bg-green-600'"
              :style="{ width: hostStats.cpu.usage + '%' }"
            ></div>
          </div>
          <p class="text-xs text-gray-500 dark:text-slate-500">{{ hostStats.cpu.count }} cores available</p>
        </div>

        <!-- RAM -->
        <div class="border border-gray-200 dark:border-purple-800/30 rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-slate-300">RAM</h3>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ hostStats.memory.usagePercent }}%</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-dark-700 rounded-full h-2 mb-2">
            <div
              class="h-2 rounded-full transition-all duration-300"
              :class="hostStats.memory.usagePercent > 80 ? 'bg-red-600' : hostStats.memory.usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-600'"
              :style="{ width: hostStats.memory.usagePercent + '%' }"
            ></div>
          </div>
          <p class="text-xs text-gray-500 dark:text-slate-500">{{ formatBytes(hostStats.memory.used) }} / {{ formatBytes(hostStats.memory.total) }}</p>
        </div>

        <!-- Disk -->
        <div class="border border-gray-200 dark:border-purple-800/30 rounded-lg p-4">
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-slate-300">Disk</h3>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ hostStats.disk.usagePercent }}%</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-dark-700 rounded-full h-2 mb-2">
            <div
              class="h-2 rounded-full transition-all duration-300"
              :class="hostStats.disk.usagePercent > 80 ? 'bg-red-600' : hostStats.disk.usagePercent > 50 ? 'bg-yellow-500' : 'bg-green-600'"
              :style="{ width: hostStats.disk.usagePercent + '%' }"
            ></div>
          </div>
          <p class="text-xs text-gray-500 dark:text-slate-500">{{ formatBytes(hostStats.disk.used) }} / {{ formatBytes(hostStats.disk.total) }}</p>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-500 dark:text-slate-500">
        <p>Loading system stats...</p>
      </div>
    </div>

    <!-- Spawner Environments -->
    <div class="bg-white dark:bg-dark-800 shadow rounded-lg p-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-semibold">Spawner Environments</h2>
          <p class="text-sm text-gray-600 dark:text-slate-400 mt-1">Active environments resources usage</p>
        </div>
        <button
          @click="refreshSpawnerStats"
          :disabled="loadingSpawnerStats"
          class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-purple-500/10 dark:bg-dark-700 disabled:opacity-50"
        >
          {{ loadingSpawnerStats ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="spawnerStats">
        <!-- Total Stats -->
        <div class="bg-blue-50 dark:bg-purple-900/20 border border-blue-200 dark:border-purple-700/40 rounded-lg p-4 mb-4">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p class="text-xs text-blue-700 dark:text-purple-400">Environments</p>
              <p class="text-2xl font-bold text-blue-900 dark:text-purple-200">{{ spawnerStats.total.environmentCount }}</p>
            </div>
            <div>
              <p class="text-xs text-blue-700 dark:text-purple-400">Containers</p>
              <p class="text-2xl font-bold text-blue-900 dark:text-purple-200">{{ spawnerStats.total.containerCount }}</p>
            </div>
            <div>
              <p class="text-xs text-blue-700 dark:text-purple-400">Total CPU</p>
              <p class="text-2xl font-bold text-blue-900 dark:text-purple-200">{{ spawnerStats.total.totalCpu }}%</p>
            </div>
            <div>
              <p class="text-xs text-blue-700 dark:text-purple-400">Total RAM</p>
              <p class="text-2xl font-bold text-blue-900 dark:text-purple-200">{{ formatBytes(spawnerStats.total.totalMemoryUsage) }}</p>
            </div>
          </div>
        </div>

        <!-- Environments List -->
        <div v-if="spawnerStats.environments.length > 0" class="space-y-4">
          <div
            v-for="env in spawnerStats.environments"
            :key="env.id"
            class="border border-gray-200 dark:border-purple-800/30 rounded-lg p-4"
          >
            <div class="flex items-center justify-between mb-3">
              <div>
                <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ env.name }}</h3>
                <p class="text-xs text-gray-500 dark:text-slate-500">{{ env.projectName }}</p>
              </div>
              <div class="flex items-center gap-4 text-sm">
                <span class="text-gray-600 dark:text-slate-400">CPU: <strong>{{ env.totalCpu }}%</strong></span>
                <span class="text-gray-600 dark:text-slate-400">RAM: <strong>{{ formatBytes(env.totalMemoryUsage) }}</strong></span>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              <div
                v-for="container in env.containers"
                :key="container.name"
                class="bg-gray-50 dark:bg-dark-700 rounded p-3 text-xs"
              >
                <p class="font-mono text-gray-900 dark:text-white mb-1 truncate" :title="container.name">{{ container.name }}</p>
                <div class="flex justify-between text-gray-600 dark:text-slate-400">
                  <span>CPU: {{ container.cpuPercent }}%</span>
                  <span>RAM: {{ formatBytes(container.memoryUsage) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-8 text-gray-500 dark:text-slate-500">
          <p>No active Spawner environments</p>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-500 dark:text-slate-500">
        <p>Loading Spawner stats...</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import api from '../services/api';

const hostStats = ref<any>(null);
const spawnerStats = ref<any>(null);
const loadingSystemStats = ref(false);
const loadingSpawnerStats = ref(false);

onMounted(async () => {
  await Promise.all([
    loadSystemStats(),
    loadSpawnerStats(),
  ]);

  setInterval(() => {
    loadSystemStats();
    loadSpawnerStats();
  }, 30000);
});

async function loadSystemStats() {
  loadingSystemStats.value = true;
  try {
    const response = await api.get('/system/host/stats');
    hostStats.value = response.data.data;
  } catch (error) {
    console.error('Failed to load system stats:', error);
  } finally {
    loadingSystemStats.value = false;
  }
}

async function refreshSystemStats() {
  await loadSystemStats();
}

async function loadSpawnerStats() {
  loadingSpawnerStats.value = true;
  try {
    const response = await api.get('/system/spawner/environments-stats');
    spawnerStats.value = response.data.data;
  } catch (error) {
    console.error('Failed to load Spawner stats:', error);
  } finally {
    loadingSpawnerStats.value = false;
  }
}

async function refreshSpawnerStats() {
  await loadSpawnerStats();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
</script>
