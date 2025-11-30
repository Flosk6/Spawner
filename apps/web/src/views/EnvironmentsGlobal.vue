<template>
  <div>
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-4xl font-bold mb-2">Environments</h1>
        <p class="text-lg opacity-70">Manage all your preview environments</p>
      </div>
      <Button
        label="New Environment"
        icon="pi pi-plus"
        size="large"
        @click="$router.push('/environments/new')"
      />
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="environments.length === 0" class="text-center py-20">
      <i class="pi pi-server text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">No environments yet</p>
      <Button
        label="Create your first environment"
        icon="pi pi-plus"
        size="large"
        @click="$router.push('/environments/new')"
      />
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
          @delete="confirmDelete"
          @view="$router.push(`/environments/${env.id}`)"
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import axios from 'axios';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import ProgressBar from 'primevue/progressbar';
import EnvironmentCard from '../components/EnvironmentCard.vue';
import { useNotification } from '../composables/useNotification';
import type { Environment } from '../types';

const { showSuccess, showError, confirmDelete: confirmDeleteDialog } = useNotification();

const environments = ref<Environment[]>([]);
const loading = ref(true);
const activeFilter = ref('all');
const deleting = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);

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
    value: 'creating',
    label: 'Creating',
    count: environments.value.filter(e => e.status === 'creating').length,
    dotColor: 'bg-blue-500 animate-pulse'
  },
  {
    value: 'failed',
    label: 'Failed',
    count: environments.value.filter(e => e.status === 'failed').length,
    dotColor: 'bg-red-500'
  },
  {
    value: 'stopped',
    label: 'Stopped',
    count: environments.value.filter(e => e.status === 'stopped').length,
    dotColor: 'bg-slate-500'
  }
]);

const filteredEnvironments = computed(() => {
  if (activeFilter.value === 'all') {
    return environments.value;
  }
  return environments.value.filter(env => env.status === activeFilter.value);
});

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

onMounted(() => {
  loadEnvironments();
});
</script>
