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
        <!-- Environment Info Header -->
        <div class="mb-6 p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-blue-500/10 border border-green-500/20 dark:border-green-400/20">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center">
              <i class="pi pi-sitemap text-white text-xl"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-bold text-lg text-slate-900 dark:text-white truncate">{{ environment.name }}</h2>
              <div class="mt-1">
                <Tag :value="environment.status" :severity="getStatusSeverity(environment.status)" size="small" />
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="bg-white/50 dark:bg-dark-700/50 rounded-lg p-2 text-center">
              <div class="text-lg font-bold text-slate-900 dark:text-white">{{ environment.resources?.length || 0 }}</div>
              <div class="text-xs text-slate-600 dark:text-slate-400">Resources</div>
            </div>
            <div class="bg-white/50 dark:bg-dark-700/50 rounded-lg p-2 text-center">
              <div class="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">Created</div>
              <div class="text-xs text-slate-900 dark:text-white">{{ formatDateShort(environment.createdAt) }}</div>
            </div>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="space-y-1">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            @click="activeTab = tab.value"
            :class="[
              'w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200',
              activeTab === tab.value
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70'
            ]"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </div>

      <!-- Right Content Area -->
      <div class="flex-1">
        <!-- Overview Tab -->
        <div v-if="activeTab === 'overview'">
          <div class="mb-6">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-2xl font-bold text-slate-900 dark:text-white">Overview</h3>

              <!-- Action Buttons -->
              <div class="flex gap-2">
                <Button
                  v-if="environment.status === 'running'"
                  label="Pause"
                  icon="pi pi-pause"
                  severity="warning"
                  outlined
                  size="small"
                  @click="pauseEnvironment"
                  :loading="loadingAction"
                />
                <Button
                  v-if="environment.status === 'paused'"
                  label="Resume"
                  icon="pi pi-play"
                  severity="success"
                  outlined
                  size="small"
                  @click="resumeEnvironment"
                  :loading="loadingAction"
                />
                <Button
                  v-if="environment.status === 'running' || environment.status === 'paused'"
                  label="Restart"
                  icon="pi pi-refresh"
                  severity="info"
                  outlined
                  size="small"
                  @click="restartEnvironment"
                  :loading="loadingAction"
                />
                <Button
                  v-if="environment.status === 'running' || environment.status === 'paused'"
                  label="Update"
                  icon="pi pi-upload"
                  severity="secondary"
                  outlined
                  size="small"
                  @click="updateEnvironment"
                  :loading="loadingAction"
                />
              </div>
            </div>

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
                    class="p-4 rounded-lg bg-slate-100 dark:bg-dark-700 border border-slate-300 dark:border-purple-800/30"
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

        <!-- Build Logs Tab -->
        <div v-if="activeTab === 'build-logs'">
          <h3 class="text-2xl font-bold mb-4 text-slate-900 dark:text-white">Build Logs</h3>
          <Card>
            <template #content>
              <ScrollPanel style="width: 100%; height: 60vh" class="border rounded" ref="buildLogsContainer">
                <div class="p-4 font-mono text-sm whitespace-pre-wrap">
                  <div v-for="(line, index) in buildLogsLines" :key="index" :class="getBuildLogLineClass(line)">
                    {{ line }}
                  </div>
                  <div v-if="buildLogsLines.length === 0" class="opacity-50">
                    No logs available. Logs will appear when you create or update this environment.
                  </div>
                </div>
              </ScrollPanel>
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

    <!-- Update Logs Dialog -->
    <Dialog
      v-model:visible="showUpdateLogsModal"
      :header="`Updating Environment: ${environment?.name}`"
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

      <ScrollPanel style="width: 100%; height: 60vh" class="border rounded" ref="updateLogsContainer">
        <div class="p-4 font-mono text-sm whitespace-pre-wrap">
          <div v-for="(line, index) in updateLogsLines" :key="index" :class="getUpdateLogLineClass(line)">
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
          :disabled="!updateComplete"
        />
      </template>
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
import { ref, onMounted, watch, onBeforeUnmount, computed } from 'vue';
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
const loadingAction = ref(false);
const error = ref('');
const showLogsModal = ref(false);
const currentLogsResource = ref('');
const logs = ref('');

const showDeleteModal = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);

const showTerminalModal = ref(false);
const currentTerminalResource = ref('');

const showLiveLogsModal = ref(false);
const currentLiveLogsResource = ref('');
const liveLogs = ref('');
const liveLogsContainer = ref<HTMLPreElement | null>(null);

const buildLogsEventSource = ref<EventSource | null>(null);
const buildLogsText = ref('');
const buildLogsContainer = ref<any>(null);

const showUpdateLogsModal = ref(false);
const updateLogsText = ref('');
const updateComplete = ref(false);
const updateSuccess = ref(false);
const updateEventSource = ref<EventSource | null>(null);
const updateLogsContainer = ref<any>(null);

const activeTab = ref('overview');

const tabs = [
  { value: 'overview', label: 'Overview', icon: 'pi pi-home' },
  { value: 'stats', label: 'Performance', icon: 'pi pi-chart-line' },
  { value: 'resources', label: 'Resources', icon: 'pi pi-box' },
  { value: 'build-logs', label: 'Build Logs', icon: 'pi pi-file' },
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

    const pollLogs = async () => {
      if (!showLiveLogsModal.value) return;

      try {
        const result = await environmentApi.getLogs(id, resourceName);
        liveLogs.value = result.logs;

        if (liveLogsContainer.value) {
          liveLogsContainer.value.scrollTop = liveLogsContainer.value.scrollHeight;
        }
      } catch (err) {
      }

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

  const { confirmDelete } = useNotification();
  confirmDelete(
    envName,
    async () => {
      try {
        deleting.value = true;
        showDeleteModal.value = true;
        error.value = '';

        deletionStep.value = 'Stopping containers...';
        deletionProgress.value = 20;

        const deletePromise = environmentApi.delete(environment.value!.id);

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

function formatDateShort(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

async function pauseEnvironment() {
  if (!environment.value) return;
  try {
    loadingAction.value = true;
    await environmentApi.pause(environment.value.id);
    showSuccess(`Environment "${environment.value.name}" paused successfully`);
    await loadEnvironment();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to pause environment');
  } finally {
    loadingAction.value = false;
  }
}

async function resumeEnvironment() {
  if (!environment.value) return;
  try {
    loadingAction.value = true;
    await environmentApi.resume(environment.value.id);
    showSuccess(`Environment "${environment.value.name}" resumed successfully`);
    await loadEnvironment();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to resume environment');
  } finally {
    loadingAction.value = false;
  }
}

async function restartEnvironment() {
  if (!environment.value) return;
  try {
    loadingAction.value = true;
    await environmentApi.restart(environment.value.id);
    showSuccess(`Environment "${environment.value.name}" restarted successfully`);
    await loadEnvironment();
  } catch (err: any) {
    showError(err.response?.data?.message || 'Failed to restart environment');
  } finally {
    loadingAction.value = false;
  }
}

async function updateEnvironment() {
  if (!environment.value) return;
  try {
    showUpdateLogsModal.value = true;
    updateLogsText.value = '';
    updateComplete.value = false;
    updateSuccess.value = false;

    connectToUpdateSSE(environment.value.id);

    loadingAction.value = true;
    await environmentApi.update(environment.value.id);
  } catch (err: any) {
    console.error('Error updating environment:', err);
    showUpdateLogsModal.value = false;
    showError(err.response?.data?.message || 'Failed to update environment');
  } finally {
    loadingAction.value = false;
  }
}

const updateLogsLines = computed(() => {
  return updateLogsText.value.split('\n').filter(line => line.trim());
});

function getUpdateLogLineClass(line: string): string {
  if (line.includes('[OK]')) {
    return 'text-green-600';
  } else if (line.includes('[ERR]') || line.includes('[ERROR]')) {
    return 'text-red-600';
  } else if (line.includes('[WARN]')) {
    return 'text-orange-600';
  }
  return 'opacity-70';
}

function scrollUpdateLogsToBottom() {
  setTimeout(() => {
    if (updateLogsContainer.value?.$el) {
      const scrollableContent = updateLogsContainer.value.$el.querySelector('.p-scrollpanel-content');
      if (scrollableContent) {
        scrollableContent.scrollTop = scrollableContent.scrollHeight;
      }
    }
  }, 50);
}

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
      scrollUpdateLogsToBottom();
    }

    if (log.level === 'success' && log.message.includes('updated successfully')) {
      updateComplete.value = true;
      updateSuccess.value = true;
      updateEventSource.value?.close();
      loadEnvironment();
    }
    if (log.level === 'error' && (log.message.includes('failed') || log.message.includes('Failed'))) {
      updateComplete.value = true;
      updateSuccess.value = false;
      updateEventSource.value?.close();
    }
  };

  updateEventSource.value.onerror = (err) => {
    console.error('Update logs SSE connection error:', err);
    updateComplete.value = true;
    updateSuccess.value = false;
    updateEventSource.value?.close();
  };
}

function closeUpdateLogsModal() {
  showUpdateLogsModal.value = false;
  if (updateEventSource.value) {
    updateEventSource.value.close();
    updateEventSource.value = null;
  }
}

const buildLogsLines = computed(() => {
  return buildLogsText.value.split('\n').filter(line => line.trim());
});

function getBuildLogLineClass(line: string): string {
  if (line.includes('[OK]')) {
    return 'text-green-600';
  } else if (line.includes('[ERR]') || line.includes('[ERROR]')) {
    return 'text-red-600';
  } else if (line.includes('[WARN]')) {
    return 'text-orange-600';
  }
  return 'opacity-70';
}

function scrollBuildLogsToBottom() {
  setTimeout(() => {
    if (buildLogsContainer.value?.$el) {
      const scrollableContent = buildLogsContainer.value.$el.querySelector('.p-scrollpanel-content');
      if (scrollableContent) {
        scrollableContent.scrollTop = scrollableContent.scrollHeight;
      }
    }
  }, 50);
}

function connectToBuildLogsSSE(environmentId: string) {
  if (buildLogsEventSource.value) {
    buildLogsEventSource.value.close();
  }

  const endpoint = environment.value?.status === 'creating'
    ? `/api/environments/creation-logs/${environmentId}`
    : `/api/environments/update-logs/${environmentId}`;

  buildLogsEventSource.value = new EventSource(endpoint);

  buildLogsEventSource.value.onmessage = (event) => {
    const log = JSON.parse(event.data);
    if (log.message && log.message.trim()) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let prefix = '';
      if (log.level === 'success') prefix = '[OK]';
      else if (log.level === 'error') prefix = '[ERR]';
      else if (log.level === 'warning') prefix = '[WARN]';
      else prefix = '[INFO]';

      buildLogsText.value += `${timestamp} ${prefix} ${log.message}\n`;
      scrollBuildLogsToBottom();
    }

    if (log.level === 'success' && (log.message.includes('created successfully') || log.message.includes('updated successfully'))) {
      buildLogsEventSource.value?.close();
    }
    if (log.level === 'error' && (log.message.includes('failed') || log.message.includes('Failed'))) {
      buildLogsEventSource.value?.close();
    }
  };

  buildLogsEventSource.value.onerror = (err) => {
    console.error('Build logs SSE connection error:', err);
    buildLogsEventSource.value?.close();
  };
}

watch(activeTab, (newTab) => {
  if (newTab === 'build-logs' && environment.value) {
    const status = environment.value.status;
    if (status === 'creating' || status === 'updating') {
      connectToBuildLogsSSE(environment.value.id);
    }
  } else {
    if (buildLogsEventSource.value) {
      buildLogsEventSource.value.close();
      buildLogsEventSource.value = null;
    }
  }
});
onBeforeUnmount(() => {
  if (buildLogsEventSource.value) {
    buildLogsEventSource.value.close();
  }
  if (updateEventSource.value) {
    updateEventSource.value.close();
  }
});
</script>
