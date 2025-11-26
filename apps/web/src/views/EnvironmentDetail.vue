<template>
  <div>
    <div class="mb-6">
      <Button label="Back to Dashboard" icon="pi pi-arrow-left" text @click="$router.push('/')" />
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="environment">
      <!-- Environment Header -->
      <Card class="mb-6">
        <template #content>
          <div class="flex justify-between items-start">
            <div>
              <h1 class="text-4xl font-bold mb-2">{{ environment.name }}</h1>
              <p class="opacity-70 text-lg">
                Created {{ formatDate(environment.createdAt) }}
              </p>
            </div>
            <Tag :value="environment.status" :severity="getStatusSeverity(environment.status)"
              class="text-lg px-4 py-2" />
          </div>
          <div v-if="environment.branches" class="mt-6">
            <h3 class="text-sm font-semibold opacity-70 mb-3">BRANCHES:</h3>
            <div class="flex flex-wrap gap-2">
              <Chip v-for="(branch, name) in environment.branches" :key="name" :label="`${name}: ${branch}`"
                icon="pi pi-code-branch" />
            </div>
          </div>
        </template>
      </Card>

      <!-- Tabs -->
      <TabView>
        <TabPanel value="0">
          <template #header>
            <div class="flex items-center gap-2">
              <i class="pi pi-box"></i>
              <span>Resources</span>
            </div>
          </template>

          <DataTable :value="environment.resources" stripedRows responsiveLayout="scroll">
            <Column field="resourceName" header="Name" sortable style="min-width: 150px">
              <template #body="{ data }: { data: EnvironmentResource }">
                <span class="font-semibold">{{ data.resourceName }}</span>
              </template>
            </Column>

            <Column field="resourceType" header="Type" sortable style="min-width: 120px">
              <template #body="{ data }: { data: EnvironmentResource }">
                <Tag :value="data.resourceType" severity="info" icon="pi pi-box" />
              </template>
            </Column>

            <Column field="branch" header="Branch" style="min-width: 150px">
              <template #body="{ data }: { data: EnvironmentResource }">
                <Chip v-if="data.branch" :label="data.branch" icon="pi pi-code-branch" />
                <span v-else class="opacity-50">-</span>
              </template>
            </Column>

            <Column field="url" header="URL" style="min-width: 250px">
              <template #body="{ data }: { data: EnvironmentResource }">
                <a v-if="data.url" :href="data.url" target="_blank"
                  class="text-blue-500 hover:text-blue-600 flex items-center gap-2">
                  {{ data.url }}
                  <i class="pi pi-external-link text-xs"></i>
                </a>
                <span v-else class="opacity-50">-</span>
              </template>
            </Column>

            <Column header="Actions" style="min-width: 200px">
              <template #body="{ data }: { data: EnvironmentResource }">
                <div class="flex gap-2">
                  <Button icon="pi pi-file" severity="secondary" outlined rounded @click="viewLogs(data.resourceName)"
                    v-tooltip.top="'View Logs'" />
                  <Button v-if="data.resourceType !== 'mysql-db'" icon="pi pi-desktop" severity="success" outlined rounded
                    @click="openTerminal(data.resourceName)" v-tooltip.top="'Open Terminal'" />
                  <Button icon="pi pi-video" severity="info" outlined rounded @click="viewLiveLogs(data.resourceName)"
                    v-tooltip.top="'Live Logs'" />
                </div>
              </template>
            </Column>
          </DataTable>
        </TabPanel>

        <TabPanel value="1">
          <template #header>
            <div class="flex items-center gap-2">
              <i class="pi pi-cog"></i>
              <span>Settings</span>
            </div>
          </template>

          <div class="py-6">
            <h3 class="text-2xl font-semibold mb-4">Environment Settings</h3>
            <p class="opacity-70 mb-6">Coming soon: Environment configuration options</p>
          </div>
        </TabPanel>

        <TabPanel value="2">
          <template #header>
            <div class="flex items-center gap-2 text-red-500">
              <i class="pi pi-exclamation-triangle"></i>
              <span>Danger Zone</span>
            </div>
          </template>

          <div class="py-6">
            <h3 class="text-2xl font-semibold mb-4">Delete Environment</h3>
            <Message severity="warn" :closable="false" class="mb-6">
              Deleting this environment will stop all containers, remove volumes, and delete all data.
              This action cannot be undone.
            </Message>
            <Button label="Delete Environment" icon="pi pi-trash" severity="danger" size="large" @click="handleDelete"
              :disabled="deleting" />
          </div>
        </TabPanel>
      </TabView>
    </div>

    <!-- Logs Dialog -->
    <Dialog v-model:visible="showLogsModal" :header="`Logs: ${currentLogsResource}`" :modal="true"
      :style="{ width: '80vw' }" :maximizable="true">
      <ScrollPanel style="width: 100%; height: 60vh" class="border rounded">
        <pre class="p-4 text-sm font-mono whitespace-pre-wrap">{{ logs }}</pre>
      </ScrollPanel>
    </Dialog>

    <!-- Terminal Dialog -->
    <Dialog
      v-model:visible="showTerminalModal"
      :header="`Terminal: ${currentTerminalResource}`"
      :modal="true"
      :style="{ width: '90vw', height: '85vh' }"
      :maximizable="true"
    >
      <XtermTerminal
        v-if="showTerminalModal && environment"
        :environment-id="environment.id"
        :resource-name="currentTerminalResource"
      />
    </Dialog>

    <!-- Live Logs Dialog -->
    <Dialog v-model:visible="showLiveLogsModal" :header="`Live Logs: ${currentLiveLogsResource}`" :modal="true"
      :style="{ width: '80vw' }" :maximizable="true" @hide="closeLiveLogs">
      <ScrollPanel style="width: 100%; height: 60vh" ref="liveLogsContainer" class="border rounded">
        <pre class="p-4 text-sm font-mono whitespace-pre-wrap">{{ liveLogs || 'Connecting to live logs...' }}</pre>
      </ScrollPanel>
    </Dialog>

    <!-- Delete Progress Dialog -->
    <Dialog v-model:visible="showDeleteModal" header="Deleting Environment" :modal="true" :closable="false"
      :style="{ width: '450px' }">
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
import { useRoute, useRouter } from 'vue-router';
import { environmentApi } from '../services/api';
import type { EnvironmentDetail, EnvironmentResource } from '../types';
import Button from 'primevue/button';
import Card from 'primevue/card';
import TabView from 'primevue/tabview';
import TabPanel from 'primevue/tabpanel';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Chip from 'primevue/chip';
import Dialog from 'primevue/dialog';
import ScrollPanel from 'primevue/scrollpanel';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import ProgressBar from 'primevue/progressbar';
import { useNotification } from '../composables/useNotification';
import XtermTerminal from '../components/XtermTerminal.vue';

const route = useRoute();
const router = useRouter();
const { showSuccess, showError } = useNotification();

const environment = ref<EnvironmentDetail | null>(null);
const loading = ref(true);
const deleting = ref(false);
const error = ref('');
const showLogsModal = ref(false);
const currentLogsResource = ref('');
const logs = ref('');

// Delete progress state
const showDeleteModal = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);

// Terminal state
const showTerminalModal = ref(false);
const currentTerminalResource = ref('');

// Live logs state
const showLiveLogsModal = ref(false);
const currentLiveLogsResource = ref('');
const liveLogs = ref('');
const liveLogsContainer = ref<HTMLPreElement | null>(null);

onMounted(async () => {
  await loadEnvironment();
});

async function loadEnvironment() {
  try {
    loading.value = true;
    error.value = '';
    const id = route.params.id as string;
    environment.value = await environmentApi.getOne(id);
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load environment';
    showError(error.value);
  } finally {
    loading.value = false;
  }
}

async function viewLogs(resourceName: string) {
  try {
    currentLogsResource.value = resourceName;
    const id = route.params.id as string;
    const result = await environmentApi.getLogs(id, resourceName);
    logs.value = result.logs;
    showLogsModal.value = true;
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to load logs';
    showError(error.value);
  }
}

function openTerminal(resourceName: string) {
  currentTerminalResource.value = resourceName;
  showTerminalModal.value = true;
}

async function viewLiveLogs(resourceName: string) {
  currentLiveLogsResource.value = resourceName;
  liveLogs.value = '';
  showLiveLogsModal.value = true;

  try {
    const id = route.params.id as string;

    // Simple polling approach - fetch logs every 2 seconds
    const pollLogs = async () => {
      if (!showLiveLogsModal.value) return;

      try {
        const result = await environmentApi.getLogs(id, resourceName);
        liveLogs.value = result.logs;

        // Auto-scroll to bottom
        if (liveLogsContainer.value) {
          liveLogsContainer.value.scrollTop = liveLogsContainer.value.scrollHeight;
        }
      } catch (err) {
        // Ignore errors during polling
      }

      // Continue polling
      if (showLiveLogsModal.value) {
        setTimeout(pollLogs, 2000);
      }
    };

    pollLogs();
  } catch (err: any) {
    error.value = err.response?.data?.message || 'Failed to start live logs';
    showError(error.value);
  }
}

function closeLiveLogs() {
  showLiveLogsModal.value = false;
  liveLogs.value = '';
}

async function handleDelete() {
  if (!environment.value) return;

  const envName = environment.value.name;

  // Use notification service for confirmation
  const { confirmDelete } = useNotification();
  confirmDelete(
    envName,
    async () => {
      try {
        deleting.value = true;
        showDeleteModal.value = true;
        error.value = '';

        // Simulate progress steps
        deletionStep.value = 'Stopping containers...';
        deletionProgress.value = 20;

        // Start deletion
        const deletePromise = environmentApi.delete(environment.value!.id);

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
        showSuccess(`Environment "${envName}" deleted successfully`);
        router.push('/');
      } catch (err: any) {
        showDeleteModal.value = false;
        error.value = err.response?.data?.message || 'Failed to delete environment';
        showError(error.value);
      } finally {
        deleting.value = false;
      }
    }
  );
}

function getStatusSeverity(status: string): string {
  switch (status) {
    case 'running':
      return 'success';
    case 'creating':
      return 'info';
    case 'failed':
      return 'danger';
    case 'deleting':
      return 'warning';
    default:
      return 'secondary';
  }
}

function formatDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleString();
}
</script>
