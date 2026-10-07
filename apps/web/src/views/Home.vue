<template>
  <div>
    <div class="mb-8">
      <h1 class="text-4xl font-bold mb-2">Dashboard</h1>
      <p class="text-lg opacity-70">System overview and quick access</p>
    </div>

    <div class="space-y-6">

    <!-- Quick Stats Cards -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <!-- Environments Card -->
      <div class="bg-white dark:bg-dark-800 rounded-xl p-6 border border-purple-200 dark:border-purple-500/50 shadow-md hover:shadow-lg hover:shadow-purple-500/20 dark:hover:shadow-purple-500/30 transition-all duration-200 hover:border-purple-300 dark:hover:border-purple-400">
        <div class="flex items-center">
          <div class="flex-shrink-0 w-14 h-14 rounded-xl border border-purple-200 dark:border-purple-500/50 bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center hover:shadow-md hover:shadow-purple-500/20 dark:hover:shadow-purple-500/30 transition-all duration-200">
            <i class="pi pi-sitemap text-purple-600 dark:text-purple-400 text-2xl"></i>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Ready environments</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ stats?.environmentCount || 0 }}</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link to="/environments" class="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 flex items-center gap-1 group">
            <span>View all</span>
            <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
          </router-link>
        </div>
      </div>

      <!-- Projects Card -->
      <div class="bg-white dark:bg-dark-800 rounded-xl p-6 border border-green-200 dark:border-green-500/50 shadow-md hover:shadow-lg hover:shadow-green-500/20 dark:hover:shadow-green-500/30 transition-all duration-200 hover:border-green-300 dark:hover:border-green-400">
        <div class="flex items-center">
          <div class="flex-shrink-0 w-14 h-14 rounded-xl border border-green-200 dark:border-green-500/50 bg-green-50 dark:bg-green-500/10 flex items-center justify-center hover:shadow-md hover:shadow-green-500/20 dark:hover:shadow-green-500/30 transition-all duration-200">
            <i class="pi pi-folder text-green-600 dark:text-green-400 text-2xl"></i>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Projects</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ stats?.projectCount || 0 }}</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link to="/projects" class="text-sm font-medium text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex items-center gap-1 group">
            <span>View all</span>
            <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
          </router-link>
        </div>
      </div>

      <!-- CPU Usage Card -->
      <div class="bg-white dark:bg-dark-800 rounded-xl p-6 border border-amber-200 dark:border-amber-500/50 shadow-md hover:shadow-lg hover:shadow-amber-500/20 dark:hover:shadow-amber-500/30 transition-all duration-200 hover:border-amber-300 dark:hover:border-amber-400">
        <div class="flex items-center">
          <div class="flex-shrink-0 w-14 h-14 rounded-xl border border-amber-200 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-500/10 flex items-center justify-center hover:shadow-md hover:shadow-amber-500/20 dark:hover:shadow-amber-500/30 transition-all duration-200">
            <i class="pi pi-microchip text-amber-600 dark:text-amber-400 text-2xl"></i>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Memory available</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ formatSize(capacity?.host?.availableMemoryBytes) }}</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link v-if="authStore.isAdmin" to="/system/overview" class="text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1 group">
            <span>View details</span>
            <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
          </router-link>
        </div>
      </div>

      <!-- Memory Usage Card -->
      <div class="bg-white dark:bg-dark-800 rounded-xl p-6 border border-rose-200 dark:border-rose-500/50 shadow-md hover:shadow-lg hover:shadow-rose-500/20 dark:hover:shadow-rose-500/30 transition-all duration-200 hover:border-rose-300 dark:hover:border-rose-400">
        <div class="flex items-center">
          <div class="flex-shrink-0 w-14 h-14 rounded-xl border border-rose-200 dark:border-rose-500/50 bg-rose-50 dark:bg-rose-500/10 flex items-center justify-center hover:shadow-md hover:shadow-rose-500/20 dark:hover:shadow-rose-500/30 transition-all duration-200">
            <i class="pi pi-database text-rose-600 dark:text-rose-400 text-2xl"></i>
          </div>
          <div class="ml-5 w-0 flex-1">
            <dl>
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Room for</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ room.places }}</dd>
              <dd v-if="room.detail" class="text-xs text-gray-500 dark:text-slate-400 truncate">{{ room.detail }}</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link v-if="authStore.isAdmin" to="/system/overview" class="text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1 group">
            <span>View details</span>
            <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Recent Environments -->
    <div class="bg-white dark:bg-dark-800 shadow-lg rounded-xl border border-slate-200 dark:border-purple-900/30">
      <div class="px-6 py-5 border-b border-slate-200 dark:border-purple-800/30 bg-gradient-to-br from-purple-50/50 to-violet-50/50 dark:from-purple-500/5 dark:to-violet-500/5">
        <h2 class="text-lg font-bold text-gray-900 dark:text-white">Recent Environments</h2>
      </div>
      <div class="px-6 py-4">
        <div v-if="loading" class="text-center py-8 text-gray-500 dark:text-slate-500">
          <i class="pi pi-spinner pi-spin text-2xl text-purple-600 dark:text-purple-400"></i>
          <p class="mt-2">Loading...</p>
        </div>
        <div v-else-if="environments.length === 0" class="text-center py-12 text-gray-500 dark:text-slate-500">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 dark:bg-purple-900/30 mb-4">
            <i class="pi pi-inbox text-2xl text-purple-600 dark:text-purple-400"></i>
          </div>
          <p class="text-sm mb-4">No environments yet</p>
          <router-link to="/environments" class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition-all duration-200">
            <i class="pi pi-plus text-sm"></i>
            <span>Create your first environment</span>
          </router-link>
        </div>
        <div v-else class="space-y-3">
          <router-link
            v-for="env in environments.slice(0, 5)"
            :key="env.id"
            :to="`/environments/${env.id}`"
            class="flex flex-wrap items-center justify-between gap-3 p-4 bg-gray-50 dark:bg-dark-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 border border-gray-200 dark:border-purple-800/30 hover:border-purple-300 dark:hover:border-purple-600/50 transition-all duration-200"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-3 mb-1">
                <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">{{ env.slug }}</h3>
                <EnvironmentStatus :status="env.status" />
              </div>
              <p class="text-xs text-gray-500 dark:text-slate-500">
                <i class="pi pi-folder text-xs mr-1"></i>{{ env.project }} · {{ timeAgo(env.createdAt) }}
              </p>
            </div>
            <a
              v-if="env.url && env.status === 'ready'"
              :href="env.url"
              target="_blank"
              rel="noopener"
              class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors text-xs font-medium"
              @click.stop
            >
              <i class="pi pi-external-link text-xs"></i>
              <span>Open</span>
            </a>
          </router-link>
        </div>
        <div v-if="environments.length > 5" class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-800/30 text-center">
          <router-link to="/environments" class="text-sm font-medium text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 inline-flex items-center gap-1 group">
            <span>View all {{ environments.length }} environments</span>
            <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <router-link
        to="/environments"
        class="group bg-white dark:bg-dark-800 rounded-xl p-6 border border-purple-200 dark:border-purple-500/50 shadow-md hover:shadow-lg hover:shadow-purple-500/20 dark:hover:shadow-purple-500/30 transition-all duration-200 hover:border-purple-300 dark:hover:border-purple-400"
      >
        <div class="flex items-center">
          <div class="flex-shrink-0 w-12 h-12 rounded-xl border border-purple-200 dark:border-purple-500/50 bg-purple-50 dark:bg-purple-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
            <i class="pi pi-plus text-purple-600 dark:text-purple-400 text-xl"></i>
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-bold text-gray-900 dark:text-white group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Create Environment</h3>
            <p class="text-xs text-gray-500 dark:text-slate-500">Deploy a new environment</p>
          </div>
        </div>
      </router-link>

      <router-link
        to="/projects"
        class="group bg-white dark:bg-dark-800 rounded-xl p-6 border border-green-200 dark:border-green-500/50 shadow-md hover:shadow-lg hover:shadow-green-500/20 dark:hover:shadow-green-500/30 transition-all duration-200 hover:border-green-300 dark:hover:border-green-400"
      >
        <div class="flex items-center">
          <div class="flex-shrink-0 w-12 h-12 rounded-xl border border-green-200 dark:border-green-500/50 bg-green-50 dark:bg-green-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
            <i class="pi pi-folder-plus text-green-600 dark:text-green-400 text-xl"></i>
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-bold text-gray-900 dark:text-white group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors">New Project</h3>
            <p class="text-xs text-gray-500 dark:text-slate-500">Add a new project</p>
          </div>
        </div>
      </router-link>

      <router-link
        v-if="authStore.isAdmin"
        to="/system/overview"
        class="group bg-white dark:bg-dark-800 rounded-xl p-6 border border-slate-200 dark:border-slate-500/50 shadow-md hover:shadow-lg hover:shadow-slate-500/20 dark:hover:shadow-slate-500/30 transition-all duration-200 hover:border-slate-300 dark:hover:border-slate-400"
      >
        <div class="flex items-center">
          <div class="flex-shrink-0 w-12 h-12 rounded-xl border border-slate-200 dark:border-slate-500/50 bg-slate-50 dark:bg-slate-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-200">
            <i class="pi pi-chart-bar text-slate-600 dark:text-slate-400 text-xl"></i>
          </div>
          <div class="ml-4">
            <h3 class="text-sm font-bold text-gray-900 dark:text-white group-hover:text-slate-600 dark:group-hover:text-slate-400 transition-colors">System Overview</h3>
            <p class="text-xs text-gray-500 dark:text-slate-500">Monitor resources</p>
          </div>
        </div>
      </router-link>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { environmentsApi, projectsApi, systemApi } from '../services/api';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import { useAuthStore } from '../stores/auth';
import type { Capacity, Environment } from '../types';
import { timeAgo } from '../utils/format';
import { formatSize } from '../utils/palette';

const authStore = useAuthStore();
const loading = ref(true);
const environments = ref<Environment[]>([]);
const stats = ref<{ environmentCount: number; projectCount: number } | null>(null);
const capacity = ref<Capacity | null>(null);

/**
 * More environments the server can hold: those of the only project, or the
 * range from the heaviest project to the lightest.
 */
const room = computed(() => {
  const projects = (capacity.value?.projects ?? []).filter((project) => project.places !== null);
  if (projects.length === 0) {
    return { places: '-', detail: '' };
  }
  const counts = projects.map((project) => project.places ?? 0);
  const [least, most] = [Math.min(...counts), Math.max(...counts)];
  if (projects.length === 1) {
    return { places: `${least} more`, detail: `${projects[0].project} environments` };
  }
  return { places: least === most ? `${least} more` : `${least} to ${most} more`, detail: 'environments, depending on the project' };
});

onMounted(async () => {
  await Promise.all([loadEnvironments(), loadCapacity()]);
  loading.value = false;
});

async function loadEnvironments() {
  try {
    const [allEnvironments, projects] = await Promise.all([environmentsApi.list(), projectsApi.list()]);
    environments.value = allEnvironments;
    stats.value = {
      environmentCount: allEnvironments.filter((environment) => environment.status === 'ready').length,
      projectCount: projects.length,
    };
  } catch (error) {
    console.error('Failed to load environments:', error);
  }
}

async function loadCapacity() {
  capacity.value = await systemApi.capacity().catch(() => null);
}
</script>
