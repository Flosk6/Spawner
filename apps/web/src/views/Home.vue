<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
      <p class="mt-2 text-sm text-gray-600 dark:text-slate-400">
        System overview and quick access
      </p>
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
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Active Environments</dt>
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
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">CPU Usage</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ hostStats?.cpu.usage || 0 }}%</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link to="/system/overview" class="text-sm font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 flex items-center gap-1 group">
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
              <dt class="text-sm font-medium text-gray-500 dark:text-slate-400 truncate">Memory Usage</dt>
              <dd class="text-2xl font-bold text-gray-900 dark:text-white">{{ hostStats?.memory.usagePercent || 0 }}%</dd>
            </dl>
          </div>
        </div>
        <div class="mt-4 pt-4 border-t border-slate-200 dark:border-purple-900/30">
          <router-link to="/system/overview" class="text-sm font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 flex items-center gap-1 group">
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
          <router-link to="/environments/new" class="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 text-white rounded-lg font-medium shadow-lg hover:shadow-xl transition-all duration-200">
            <i class="pi pi-plus text-sm"></i>
            <span>Create your first environment</span>
          </router-link>
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="env in environments.slice(0, 5)"
            :key="env.id"
            class="p-4 bg-gray-50 dark:bg-dark-700 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 border border-gray-200 dark:border-purple-800/30 hover:border-purple-300 dark:hover:border-purple-600/50 transition-all duration-200 group"
          >
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center space-x-3 flex-1 min-w-0">
                <div
                  class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  :class="{
                    'bg-green-100 dark:bg-green-900/30': env.status === 'running',
                    'bg-yellow-100 dark:bg-yellow-900/30': env.status === 'creating',
                    'bg-red-100 dark:bg-red-900/30': env.status === 'failed',
                    'bg-gray-100 dark:bg-gray-800': env.status === 'stopped'
                  }"
                >
                  <i class="pi pi-sitemap"
                    :class="{
                      'text-green-600 dark:text-green-400': env.status === 'running',
                      'text-yellow-600 dark:text-yellow-400': env.status === 'creating',
                      'text-red-600 dark:text-red-400': env.status === 'failed',
                      'text-gray-600 dark:text-gray-400': env.status === 'stopped'
                    }"
                  ></i>
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-1">
                    <h3 class="text-sm font-bold text-gray-900 dark:text-white truncate">{{ env.name }}</h3>
                    <span
                      class="px-2 py-0.5 text-xs rounded-full font-medium flex-shrink-0"
                      :class="{
                        'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300': env.status === 'running',
                        'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300': env.status === 'creating',
                        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300': env.status === 'failed',
                        'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300': env.status === 'stopped'
                      }"
                    >
                      {{ env.status }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-500 dark:text-slate-500 truncate">
                    <i class="pi pi-folder text-xs mr-1"></i>
                    {{ env.project?.name || 'Unknown project' }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-shrink-0">
                <a
                  v-if="getEntryPointUrl(env)"
                  :href="getEntryPointUrl(env) || ''"
                  target="_blank"
                  class="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors text-xs font-medium"
                  @click.stop
                >
                  <i class="pi pi-external-link text-xs"></i>
                  <span>Open Environment</span>
                </a>
                <router-link
                  :to="`/environments/${env.id}`"
                  class="px-3 py-1.5 text-xs font-medium text-purple-600 dark:text-purple-400 hover:text-white hover:bg-purple-600 dark:hover:bg-purple-500 border border-purple-600 dark:border-purple-400 rounded-lg transition-all duration-200 flex items-center gap-1.5"
                >
                  <span>Details</span>
                  <i class="pi pi-arrow-right text-xs group-hover:translate-x-1 transition-transform"></i>
                </router-link>
              </div>
            </div>

            <!-- Resources info -->
            <div v-if="env.resources && env.resources.length > 0" class="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400 pt-3 border-t border-gray-200 dark:border-purple-800/30">
              <div class="flex items-center gap-1">
                <i class="pi pi-box text-xs"></i>
                <span>{{ env.resources.length }} resource{{ env.resources.length > 1 ? 's' : '' }}</span>
              </div>
              <span class="text-gray-400 dark:text-slate-600">•</span>
              <div class="flex items-center gap-1">
                <i class="pi pi-clock text-xs"></i>
                <span>{{ formatDate(env.createdAt) }}</span>
              </div>
            </div>
          </div>
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
        to="/environments/new"
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
        to="/projects/new"
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
import { ref, onMounted } from 'vue';
import api from '../services/api';

const loading = ref(true);
const environments = ref<any[]>([]);
const stats = ref<any>(null);
const hostStats = ref<any>(null);

onMounted(async () => {
  await Promise.all([
    loadEnvironments(),
    loadStats(),
    loadHostStats(),
  ]);
  loading.value = false;
});

async function loadEnvironments() {
  try {
    const response = await api.get('/environments');
    console.log('Environments full response:', response.data);
    environments.value = response.data.data || response.data || [];
    console.log('Environments loaded:', environments.value.length, 'items');
  } catch (error) {
    console.error('Failed to load environments:', error);
  }
}

async function loadStats() {
  try {
    const [envsRes, projectsRes] = await Promise.all([
      api.get('/environments'),
      api.get('/projects'),
    ]);

    console.log('Environments response:', envsRes.data);
    console.log('Projects response:', projectsRes.data);

    const allEnvs = envsRes.data.data || envsRes.data || [];
    const runningEnvs = allEnvs.filter((e: any) => e.status === 'running');

    const allProjects = projectsRes.data.data || projectsRes.data || [];

    stats.value = {
      environmentCount: runningEnvs.length,
      projectCount: allProjects.length,
    };

    console.log('Stats calculated:', stats.value);
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

async function loadHostStats() {
  try {
    const response = await api.get('/system/host/stats');
    hostStats.value = response.data.data;
  } catch (error) {
    console.error('Failed to load host stats:', error);
  }
}

function formatDate(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function getEntryPointUrl(env: any): string | null {
  if (!env.resources || env.resources.length === 0) {
    return null;
  }
  const entryPoint = env.resources.find((r: any) => r.isEntryPoint);
  return entryPoint?.url || null;
}
</script>
