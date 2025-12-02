<template>
  <div>
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-4xl font-bold mb-2">Environments</h1>
        <p class="text-lg opacity-70">Manage all your preview environments</p>
      </div>
      <button
        @click="$router.push('/environments/new')"
        class="group relative px-6 py-3 rounded-lg font-semibold text-white overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-purple-500/30"
      >
        <div class="absolute inset-0 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 transition-all duration-300 group-hover:scale-105"></div>
        <div class="absolute inset-0 bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 opacity-0 group-hover:opacity-50 transition-opacity duration-300"></div>
        <div class="relative flex items-center gap-2">
          <i class="pi pi-plus text-lg"></i>
          <span class="text-lg">New Environment</span>
        </div>
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="environments.length === 0" class="text-center py-20">
      <i class="pi pi-server text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">No environments yet</p>
      <button
        @click="$router.push('/environments/new')"
        class="group relative px-8 py-4 rounded-lg font-semibold text-white overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-purple-500/30"
      >
        <div class="absolute inset-0 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 transition-all duration-300 group-hover:scale-105"></div>
        <div class="absolute inset-0 bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 opacity-0 group-hover:opacity-50 transition-opacity duration-300"></div>
        <div class="relative flex items-center gap-2">
          <i class="pi pi-plus text-xl"></i>
          <span class="text-xl">Create your first environment</span>
        </div>
      </button>
    </div>

    <div v-else>
      <div class="flex items-center gap-6 mb-8 pb-6 border-b border-slate-300 dark:border-slate-700/50">
        <button
          v-for="status in statusFilters"
          :key="status.value"
          @click="activeFilter = status.value"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200',
            activeFilter === status.value
              ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/50'
          ]"
        >
          <span :class="['h-2 w-2 rounded-full', status.dotColor]"></span>
          <span class="font-medium">{{ status.label }}</span>
          <span class="text-sm opacity-70">({{ status.count }})</span>
        </button>
      </div>

      <div class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <EnvironmentCard
          v-for="env in filteredEnvironments"
          :key="env.id"
          :environment="env"
          :loading="loadingActions.has(env.id)"
          @delete="confirmDelete"
          @view="$router.push(`/environments/${env.id}`)"
          @pause="pauseEnvironment"
          @resume="resumeEnvironment"
          @restart="restartEnvironment"
          @update="updateEnvironment"
        />
      </div>
    </div>

    <Dialog
      v-model:visible="deleting"
      header="Deleting Environment"
      :modal="true"
      :closable="false"
      :style="{ width: '450px' }"
    >
      <div class="text-center py-4">
        <ProgressSpinner class="mb-4" />
        <p class="mb-4 text-lg font-semibold">{{ deletionStep }}</p>
        <ProgressBar :value="deletionProgress" :showValue="false" />
        <p class="opacity-60 text-sm mt-4">
          This may take up to 15 seconds...
        </p>
      </div>
    </Dialog>

    <!-- Update Logs Dialog -->
    <Dialog
      v-model:visible="showUpdateLogsModal"
      :header="`Updating Environment: ${updatingEnvironmentName}`"
      :modal="true"
      :closable="updateComplete"
      :style="{ width: '90vw', maxWidth: '1200px' }"
      :maximizable="true"
    >
      <div v-if="!updateComplete" class="flex items-center gap-2 mb-4">
        <ProgressSpinner style="width: 20px; height: 20px" />
        <span class="font-semibold">Updating environment...</span>
      </div>
      <div v-else class="flex items-center gap-2 mb-4">
        <i v-if="updateSuccess" class="pi pi-check-circle text-green-500 text-2xl"></i>
        <i v-else class="pi pi-times-circle text-red-500 text-2xl"></i>
        <span class="font-semibold" :class="updateSuccess ? 'text-green-600' : 'text-red-600'">
          {{ updateSuccess ? 'Update successful!' : 'Update failed' }}
        </span>
      </div>

      <!-- Logs Display -->
      <ScrollPanel style="width: 100%; height: 60vh" class="border rounded" ref="updateLogsContainer">
        <div class="p-4 font-mono text-sm whitespace-pre-wrap">
          <div v-for="(line, index) in updateLogsLines" :key="index" :class="getLogLineClass(line)">
            {{ line }}
          </div>
          <div v-if="updateLogsLines.length === 0" class="opacity-50">
            Connecting to server...
          </div>
        </div>
      </ScrollPanel>

      <template #footer>
        <Button
          label="Close"
          severity="secondary"
          outlined
          @click="closeUpdateLogsModal"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import axios from 'axios';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import ScrollPanel from 'primevue/scrollpanel';
import ProgressSpinner from 'primevue/progressspinner';
import ProgressBar from 'primevue/progressbar';
import EnvironmentCard from '../components/EnvironmentCard.vue';
import { useNotification } from '../composables/useNotification';
import type { Environment } from '../types';
import { environmentApi } from '../services/api';

const { showSuccess, showError, confirmDelete: confirmDeleteDialog } = useNotification();

const environments = ref<Environment[]>([]);
const loading = ref(true);
const activeFilter = ref('all');
const deleting = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);
const loadingActions = ref<Set<string>>(new Set());

// Update logs modal state - SIMPLE SSE comme dans EnvironmentNew.vue
const showUpdateLogsModal = ref(false);
const updatingEnvironmentName = ref('');
const updatingEnvironmentId = ref('');
const updateLogsText = ref('');
const updateLogsContainer = ref<any>(null);
const updateComplete = ref(false);
const updateSuccess = ref(false);
const updateEventSource = ref<EventSource | null>(null);

const statusFilters = computed(() => [
  {
    value: 'all',
    label: 'All',
    count: environments.value.length,
    dotColor: 'bg-slate-500'
  },
  {
    value: 'running',
    label: 'Running',
    count: environments.value.filter(e => e.status === 'running').length,
    dotColor: 'bg-green-500 animate-pulse'
  },
  {
    value: 'paused',
    label: 'Paused',
    count: environments.value.filter(e => e.status === 'paused').length,
    dotColor: 'bg-amber-500'
  },
  {
    value: 'creating',
    label: 'Creating',
    count: environments.value.filter(e => e.status === 'creating').length,
    dotColor: 'bg-blue-500 animate-pulse'
  },
  {
    value: 'updating',
    label: 'Updating',
    count: environments.value.filter(e => e.status === 'updating').length,
    dotColor: 'bg-blue-500 animate-pulse'
  },
  {
    value: 'failed',
    label: 'Failed',
    count: environments.value.filter(e => e.status === 'failed').length,
    dotColor: 'bg-red-500'
  }
]);

const filteredEnvironments = computed(() => {
  if (activeFilter.value === 'all') {
    return environments.value;
  }
  return environments.value.filter(env => env.status === activeFilter.value);
});

const updateLogsLines = computed(() => {
  return updateLogsText.value.split('\n').filter(line => line.trim() !== '');
});

function getLogLineClass(line: string): string {
  if (line.includes('[OK]')) {
    return 'text-green-600';
  } else if (line.includes('[ERR]') || line.includes('[ERROR]')) {
    return 'text-red-600';
  } else if (line.includes('[WARN]')) {
    return 'text-orange-600';
  }
  return 'opacity-70';
}

function scrollToBottom() {
  setTimeout(() => {
    if (updateLogsContainer.value?.$el) {
      const scrollableContent = updateLogsContainer.value.$el.querySelector('.p-scrollpanel-content');
      if (scrollableContent) {
        scrollableContent.scrollTop = scrollableContent.scrollHeight;
      }
    }
  }, 50);
}

// SIMPLE SSE - copié depuis EnvironmentNew.vue qui MARCHE
function connectToUpdateSSE(environmentId: string) {
  updateEventSource.value = new EventSource(`/api/environments/update-logs/${environmentId}`);

  updateEventSource.value.onmessage = (event) => {
    const log = JSON.parse(event.data);

    if (log.message && log.message.trim()) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let prefix = '';
      if (log.level === 'success') prefix = '[OK]';
      else if (log.level === 'error') prefix = '[ERR]';
      else if (log.level === 'warning') prefix = '[WARN]';
      else prefix = '[INFO]';

      updateLogsText.value += `${timestamp} ${prefix} ${log.message}\n`;
    }

    // Check if operation complete
    if (log.level === 'success' && log.message.includes('updated successfully')) {
      updateComplete.value = true;
      updateSuccess.value = true;
      updateEventSource.value?.close();
      loadEnvironments();
    } else if (log.level === 'error' && (log.message.includes('update failed') || log.message.includes('Failed to update'))) {
      updateComplete.value = true;
      updateSuccess.value = false;
      updateEventSource.value?.close();
      loadEnvironments();
    }

    scrollToBottom();
  };

  updateEventSource.value.onerror = (err) => {
    console.error('SSE connection error:', err);
    if (!updateComplete.value) {
      updateLogsText.value += '\n[ERROR] Connection to server lost\n';
      updateComplete.value = true;
      updateSuccess.value = false;
    }
    updateEventSource.value?.close();
    loadEnvironments();
  };
}

function closeUpdateLogsModal() {
  showUpdateLogsModal.value = false;
  if (updateEventSource.value) {
    updateEventSource.value.close();
    updateEventSource.value = null;
  }
}

async function loadEnvironments() {
  try {
    loading.value = true;
    const response = await axios.get('/api/environments');
    environments.value = response.data;
  } catch (error) {
    console.error('Error loading environments:', error);
    showError('Failed to load environments');
  } finally {
    loading.value = false;
  }
}

function confirmDelete(env: Environment) {
  confirmDeleteDialog(
    env.name,
    () => deleteEnvironment(env)
  );
}

async function deleteEnvironment(env: Environment) {
  try {
    deleting.value = true;
    deletionStep.value = 'Stopping containers...';
    deletionProgress.value = 20;

    const deletePromise = axios.delete(`/api/environments/${env.id}`);

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing volumes...';
    deletionProgress.value = 40;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing networks...';
    deletionProgress.value = 60;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Cleaning up files...';
    deletionProgress.value = 80;

    await deletePromise;

    deletionStep.value = 'Complete!';
    deletionProgress.value = 100;

    await new Promise(resolve => setTimeout(resolve, 500));

    deleting.value = false;
    showSuccess(`Environment "${env.name}" deleted successfully`);
    await loadEnvironments();
  } catch (error) {
    console.error('Error deleting environment:', error);
    deleting.value = false;
    showError('Failed to delete environment');
  }
}

async function pauseEnvironment(env: Environment) {
  try {
    loadingActions.value.add(env.id);
    await environmentApi.pause(env.id);
    showSuccess(`Environment "${env.name}" paused successfully`);
    await loadEnvironments();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to pause environment');
  } finally {
    loadingActions.value.delete(env.id);
  }
}

async function resumeEnvironment(env: Environment) {
  try {
    loadingActions.value.add(env.id);
    await environmentApi.resume(env.id);
    showSuccess(`Environment "${env.name}" resumed successfully`);
    await loadEnvironments();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to resume environment');
  } finally {
    loadingActions.value.delete(env.id);
  }
}

async function restartEnvironment(env: Environment) {
  try {
    loadingActions.value.add(env.id);
    await environmentApi.restart(env.id);
    showSuccess(`Environment "${env.name}" restarted successfully`);
    await loadEnvironments();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to restart environment');
  } finally {
    loadingActions.value.delete(env.id);
  }
}

async function updateEnvironment(env: Environment) {
  try {
    // Open modal and reset state
    updatingEnvironmentName.value = env.name;
    updatingEnvironmentId.value = env.id;
    showUpdateLogsModal.value = true;
    updateLogsText.value = '';
    updateComplete.value = false;
    updateSuccess.value = false;

    // Connect to SSE for logs - SIMPLE comme dans EnvironmentNew.vue
    connectToUpdateSSE(env.id);

    // Trigger the update
    loadingActions.value.add(env.id);
    await environmentApi.update(env.id);
  } catch (err: any) {
    console.error('Error updating environment:', err);
    showUpdateLogsModal.value = false;
    showError(err.response?.data?.message || 'Failed to update environment');
  } finally {
    loadingActions.value.delete(env.id);
  }
}

onMounted(() => {
  loadEnvironments();
});

onBeforeUnmount(() => {
  if (updateEventSource.value) {
    updateEventSource.value.close();
    updateEventSource.value = null;
  }
});
</script>
