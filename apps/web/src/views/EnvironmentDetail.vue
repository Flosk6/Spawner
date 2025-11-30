<template>
  <div>
    <div class="mb-6">
      <Button label="Back" icon="pi pi-arrow-left" text @click="$router.push('/')" />
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="environment" class="flex gap-6">
      <!-- Left Sidebar - Navigation -->
      <div class="w-64 flex-shrink-0">
        <div class="bg-white dark:bg-slate-900 rounded-xl border border-slate-300 dark:border-slate-700 p-4 sticky top-6">
          <!-- Environment Info -->
          <div class="mb-6 pb-6 border-b border-slate-300 dark:border-slate-700">
            <h2 class="text-xl font-bold mb-2 text-slate-900 dark:text-white">{{ environment.name }}</h2>
            <Tag :value="environment.status" :severity="getStatusSeverity(environment.status)" class="mb-3" />
            <p class="text-xs text-slate-600 dark:text-slate-400">
              Created {{ formatDate(environment.createdAt) }}
            </p>
          </div>

          <!-- Navigation Tabs -->
          <nav class="space-y-1">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              @click="activeTab = tab.value"
              :class="[
                'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-all duration-200',
                activeTab === tab.value
                  ? 'bg-blue-500 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              ]"
            >
              <i :class="[tab.icon, 'text-lg']"></i>
              <span class="font-medium">{{ tab.label }}</span>
            </button>
          </nav>
        </div>
      </div>

      <!-- Right Content Area -->
      <div class="flex-1">
        <!-- Overview Tab -->
        <div v-if="activeTab === 'overview'">
          <div class="mb-6">
            <h3 class="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Overview</h3>

            <!-- Branches -->
            <Card class="mb-6" v-if="environment.branches">
              <template #title>Branches</template>
              <template #content>
                <div class="flex flex-wrap gap-2">
                  <Chip v-for="(branch, name) in environment.branches" :key="name" :label="`${name}: ${branch}`"
                    icon="pi pi-code-branch" />
                </div>
              </template>
            </Card>

            <!-- Resources Quick View -->
            <Card>
              <template #title>Resources ({{ environment.resources?.length || 0 }})</template>
              <template #content>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div
                    v-for="resource in environment.resources"
                    :key="resource.id"
                    class="p-4 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  >
                    <div class="flex items-center gap-2 mb-2">
                      <i class="pi pi-box text-blue-500"></i>
                      <span class="font-semibold text-slate-900 dark:text-white">{{ resource.resourceName }}</span>
                    </div>
                    <Tag :value="resource.resourceType" severity="info" size="small" />
                  </div>
                </div>
              </template>
            </Card>
          </div>
        </div>

        <!-- Stats Tab -->
        <div v-if="activeTab === 'stats'">
          <h3 class="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Performance Metrics</h3>
          <StatsChart :environment-id="environment.id" />
        </div>

        <!-- Resources Tab -->
        <div v-if="activeTab === 'resources'">
          <h3 class="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Resources</h3>
          <Card>

            <template #content>
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
            </template>
          </Card>
        </div>

        <!-- Settings Tab -->
        <div v-if="activeTab === 'settings'">
          <h3 class="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Settings</h3>
          <Card>
            <template #content>
              <p class="opacity-70">Coming soon: Environment configuration options</p>
            </template>
          </Card>
        </div>

        <!-- Danger Zone Tab -->
        <div v-if="activeTab === 'danger'">
          <h3 class="text-2xl font-bold mb-4 text-red-600 dark:text-red-400">Danger Zone</h3>
          <Card>
            <template #content>
              <h4 class="text-xl font-semibold mb-4">Delete Environment</h4>
              <Message severity="warn" :closable="false" class="mb-6">
                Deleting this environment will stop all containers, remove volumes, and delete all data.
                This action cannot be undone.
              </Message>
              <Button label="Delete Environment" icon="pi pi-trash" severity="danger" size="large" @click="handleDelete"
                :disabled="deleting" />
            </template>
          </Card>
        </div>
      </div>
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
import StatsChart from '../components/StatsChart.vue';

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

// Navigation state
const activeTab = ref('overview');

const tabs = [
  { value: 'overview', label: 'Overview', icon: 'pi pi-home' },
  { value: 'stats', label: 'Performance', icon: 'pi pi-chart-line' },
  { value: 'resources', label: 'Resources', icon: 'pi pi-box' },
  { value: 'settings', label: 'Settings', icon: 'pi pi-cog' },
  { value: 'danger', label: 'Danger Zone', icon: 'pi pi-exclamation-triangle' },
];

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
