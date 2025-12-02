<template>
  <div>
    <div class="mb-6">
      <Button
        label="Back to Projects"
        icon="pi pi-arrow-left"
        text
        @click="$router.push('/projects')"
      />
    </div>

    <div class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-4xl font-bold mb-2">Environments</h1>
        <p v-if="project" class="text-lg opacity-70">
          Project: <strong>{{ project.name }}</strong>
        </p>
      </div>
      <Button
        label="New Environment"
        icon="pi pi-plus"
        size="large"
        @click="$router.push(`/projects/${projectId}/environments/new`)"
      />
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="environments.length === 0" class="text-center py-20">
      <i class="pi pi-sitemap text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">No environments yet</p>
      <Button
        label="Create your first environment"
        icon="pi pi-plus"
        size="large"
        @click="$router.push(`/projects/${projectId}/environments/new`)"
      />
    </div>

    <Card v-else>
      <template #content>
        <DataTable
          :value="environments"
          :paginator="environments.length > 10"
          :rows="10"
          :rowsPerPageOptions="[5, 10, 20, 50]"
          :globalFilterFields="['name', 'status']"
          v-model:filters="filters"
          filterDisplay="row"
          stripedRows
          responsiveLayout="scroll"
        >
          <template #header>
            <div class="flex justify-between items-center">
              <span class="font-semibold text-lg">All Environments ({{ environments.length }})</span>
              <IconField iconPosition="left">
                <InputIcon class="pi pi-search" />
                <InputText
                  v-model="filters.global.value"
                  placeholder="Search environments..."
                  class="w-64"
                />
              </IconField>
            </div>
          </template>

          <Column field="name" header="Name" sortable style="min-width: 200px">
            <template #body="{ data }: { data: Environment }">
              <div class="font-semibold">{{ data.name }}</div>
            </template>
          </Column>

          <Column field="status" header="Status" sortable style="min-width: 120px">
            <template #body="{ data }: { data: Environment }">
              <Tag
                :value="data.status"
                :severity="getStatusSeverity(data.status)"
                :icon="getStatusIcon(data.status)"
              />
            </template>
          </Column>

          <Column field="createdAt" header="Created" sortable style="min-width: 180px">
            <template #body="{ data }: { data: Environment }">
              <span class="opacity-70">{{ formatDate(data.createdAt) }}</span>
            </template>
          </Column>

          <Column header="Actions" style="min-width: 150px">
            <template #body="{ data }: { data: Environment }">
              <div class="flex gap-2">
                <Button
                  icon="pi pi-eye"
                  severity="info"
                  outlined
                  rounded
                  @click="$router.push(`/environments/${data.id}`)"
                  v-tooltip.top="'View Details'"
                />
                <Button
                  icon="pi pi-trash"
                  severity="danger"
                  outlined
                  rounded
                  @click="confirmDelete(data)"
                  v-tooltip.top="'Delete Environment'"
                />
              </div>
            </template>
          </Column>
        </DataTable>
      </template>
    </Card>

    <!-- Delete Progress Dialog -->
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
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';
import Button from 'primevue/button';
import Card from 'primevue/card';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import InputText from 'primevue/inputtext';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import ProgressBar from 'primevue/progressbar';
import { useNotification } from '../composables/useNotification';
import type { Environment } from '../types';

interface Project {
  id: number;
  name: string;
}

const route = useRoute();
const { showSuccess, showError, confirmDelete: confirmDeleteDialog } = useNotification();

const projectId = ref<number>(0);
const project = ref<Project | null>(null);
const environments = ref<Environment[]>([]);
const loading = ref(true);

// Delete progress state
const deleting = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);

// DataTable filters
const filters = ref({
  global: { value: null, matchMode: 'contains' }
});

async function loadData() {
  projectId.value = parseInt(route.params.projectId as string);

  try {
    loading.value = true;

    // Load project details
    const projectResponse = await axios.get(`/api/projects/${projectId.value}`);
    project.value = projectResponse.data;

    // Load environments for this project
    const envsResponse = await axios.get(`/api/projects/${projectId.value}/environments`);
    environments.value = envsResponse.data;
  } catch (error) {
    console.error('Error loading data:', error);
    showError('Failed to load environments');
  } finally {
    loading.value = false;
  }
}

function formatDate(dateString: string | Date): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function getStatusSeverity(status: string): string {
  switch (status) {
    case 'running':
      return 'success';
    case 'creating':
      return 'info';
    case 'updating':
      return 'info';
    case 'failed':
      return 'danger';
    case 'deleting':
      return 'warning';
    case 'paused':
      return 'warning';
    default:
      return 'secondary';
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'running':
      return 'pi pi-check-circle';
    case 'creating':
      return 'pi pi-spin pi-spinner';
    case 'updating':
      return 'pi pi-spin pi-spinner';
    case 'failed':
      return 'pi pi-times-circle';
    case 'deleting':
      return 'pi pi-spin pi-spinner';
    case 'paused':
      return 'pi pi-pause-circle';
    default:
      return 'pi pi-circle';
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

    // Start deletion
    const deletePromise = axios.delete(`/api/environments/${env.id}`);

    // Simulate progress updates
    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing volumes...';
    deletionProgress.value = 40;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing networks...';
    deletionProgress.value = 60;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Cleaning up files...';
    deletionProgress.value = 80;

    // Wait for actual deletion to complete
    await deletePromise;

    deletionStep.value = 'Complete!';
    deletionProgress.value = 100;

    await new Promise(resolve => setTimeout(resolve, 500));

    // Reset and reload
    deleting.value = false;
    showSuccess(`Environment "${env.name}" deleted successfully`);
    await loadData();
  } catch (error) {
    console.error('Error deleting environment:', error);
    deleting.value = false;
    showError('Failed to delete environment');
  }
}

onMounted(() => {
  loadData();
});
</script>
