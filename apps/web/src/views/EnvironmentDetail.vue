<template>
  <div class="max-w-5xl mx-auto">
    <div class="mb-6">
      <router-link to="/" class="text-blue-600 hover:text-blue-800">
        ← Back to Dashboard
      </router-link>
    </div>

    <div v-if="loading" class="text-gray-600">Loading environment...</div>

    <div v-else-if="environment" class="space-y-6">
      <div class="bg-white shadow rounded-lg p-6">
        <div class="flex justify-between items-start mb-4">
          <div>
            <h1 class="text-3xl font-bold text-gray-900">{{ environment.name }}</h1>
            <p class="text-sm text-gray-500 mt-1">
              Created {{ formatDate(environment.createdAt) }}
            </p>
          </div>
          <span
            :class="getStatusClass(environment.status)"
            class="px-3 py-1 inline-flex text-sm leading-5 font-semibold rounded-full"
          >
            {{ environment.status }}
          </span>
        </div>

        <div class="mt-4">
          <h3 class="text-sm font-medium text-gray-700 mb-2">Branches:</h3>
          <div class="grid grid-cols-2 gap-2">
            <div
              v-for="(branch, name) in environment.branches"
              :key="name"
              class="text-sm"
            >
              <span class="font-medium">{{ name }}:</span>
              <span class="text-gray-600 ml-2">{{ branch }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-xl font-semibold mb-4">Resources</h2>

        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Name
                </th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Type
                </th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Branch
                </th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  URL
                </th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  Status
                </th>
                <th class="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-gray-200">
              <tr v-for="resource in environment.resources" :key="resource.name">
                <td class="px-4 py-3 whitespace-nowrap font-medium text-gray-900">
                  {{ resource.name }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  {{ resource.type }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  {{ resource.branch || '-' }}
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-sm">
                  <a
                    v-if="resource.url"
                    :href="resource.url"
                    target="_blank"
                    class="text-blue-600 hover:text-blue-800"
                  >
                    {{ resource.url }}
                  </a>
                  <span v-else class="text-gray-400">-</span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap">
                  <span
                    :class="getContainerStatusClass(resource.containerStatus)"
                    class="px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full"
                  >
                    {{ resource.containerStatus }}
                  </span>
                </td>
                <td class="px-4 py-3 whitespace-nowrap text-right text-sm space-x-2">
                  <button
                    @click="viewLogs(resource.name)"
                    class="text-blue-600 hover:text-blue-900"
                    title="View static logs"
                  >
                    Logs
                  </button>
                  <button
                    v-if="resource.type !== 'mysql-db'"
                    @click="openTerminal(resource.name)"
                    class="text-green-600 hover:text-green-900"
                    title="Open terminal"
                  >
                    Terminal
                  </button>
                  <button
                    @click="viewLiveLogs(resource.name)"
                    class="text-purple-600 hover:text-purple-900"
                    title="Stream live logs"
                  >
                    Live
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="bg-white shadow rounded-lg p-6">
        <h2 class="text-xl font-semibold mb-4 text-red-600">Danger Zone</h2>
        <p class="text-sm text-gray-600 mb-4">
          Deleting this environment will stop all containers, remove volumes, and delete all data.
          This action cannot be undone.
        </p>
        <button
          @click="handleDelete"
          :disabled="deleting"
          class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:bg-gray-400"
        >
          Delete Environment
        </button>
      </div>

      <!-- Delete Progress Modal -->
      <div
        v-if="showDeleteModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      >
        <div class="bg-white rounded-lg p-6 max-w-md w-full">
          <div class="text-center">
            <div class="mb-4">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            </div>
            <h3 class="text-xl font-semibold text-gray-900 mb-2">
              Deleting Environment
            </h3>
            <p class="text-gray-600 mb-4">
              {{ deletionStep }}
            </p>
            <div class="bg-gray-100 rounded-full h-2 overflow-hidden">
              <div
                class="bg-red-600 h-full transition-all duration-500"
                :style="{ width: deletionProgress + '%' }"
              ></div>
            </div>
            <p class="text-sm text-gray-500 mt-2">
              This may take up to 15 seconds...
            </p>
          </div>
        </div>
      </div>

      <!-- Logs Modal -->
      <div
        v-if="showLogsModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        @click.self="showLogsModal = false"
      >
        <div class="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] flex flex-col">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">
              Logs: {{ currentLogsResource }}
            </h3>
            <button
              @click="showLogsModal = false"
              class="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>
          <div class="flex-1 overflow-auto">
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded text-sm font-mono whitespace-pre-wrap"
            >{{ logs }}</pre>
          </div>
        </div>
      </div>

      <!-- Terminal Modal -->
      <div
        v-if="showTerminalModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        @click.self="showTerminalModal = false"
      >
        <div class="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] flex flex-col">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">
              Terminal: {{ currentTerminalResource }}
            </h3>
            <button
              @click="showTerminalModal = false"
              class="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

          <div class="mb-4">
            <div class="flex gap-2">
              <input
                v-model="terminalCommand"
                @keyup.enter="executeCommand"
                type="text"
                placeholder="Enter command (e.g., php artisan migrate, ls -la)"
                class="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                @click="executeCommand"
                :disabled="executing || !terminalCommand.trim()"
                class="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:bg-gray-400"
              >
                {{ executing ? 'Running...' : 'Execute' }}
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-auto">
            <pre
              class="bg-gray-900 text-gray-100 p-4 rounded text-sm font-mono whitespace-pre-wrap"
            >{{ terminalOutput || 'No output yet. Enter a command above.' }}</pre>
          </div>
        </div>
      </div>

      <!-- Live Logs Modal -->
      <div
        v-if="showLiveLogsModal"
        class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
        @click.self="closeLiveLogs"
      >
        <div class="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] flex flex-col">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-xl font-semibold">
              Live Logs: {{ currentLiveLogsResource }}
            </h3>
            <button
              @click="closeLiveLogs"
              class="text-gray-500 hover:text-gray-700"
            >
              ✕
            </button>
          </div>

          <div class="flex-1 overflow-auto">
            <pre
              ref="liveLogsContainer"
              class="bg-gray-900 text-gray-100 p-4 rounded text-sm font-mono whitespace-pre-wrap"
            >{{ liveLogs || 'Connecting to live logs...' }}</pre>
          </div>
        </div>
      </div>
    </div>

    <div v-if="error" class="mt-4 p-3 bg-red-50 border border-red-200 rounded">
      <p class="text-red-800 text-sm">{{ error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { environmentApi } from '../services/api';
import type { EnvironmentDetail } from '../types';

const route = useRoute();
const router = useRouter();

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
const terminalCommand = ref('');
const terminalOutput = ref('');
const executing = ref(false);

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
  }
}

function openTerminal(resourceName: string) {
  currentTerminalResource.value = resourceName;
  terminalCommand.value = '';
  terminalOutput.value = '';
  showTerminalModal.value = true;
}

async function executeCommand() {
  if (!terminalCommand.value.trim()) return;

  try {
    executing.value = true;
    const id = route.params.id as string;
    const result = await environmentApi.execCommand(id, currentTerminalResource.value, terminalCommand.value);

    // Add command to output
    terminalOutput.value += `\n$ ${terminalCommand.value}\n`;

    if (result.success) {
      terminalOutput.value += result.output || '(no output)';
    } else {
      terminalOutput.value += `ERROR: ${result.error}\n${result.output}`;
    }

    terminalCommand.value = '';
  } catch (err: any) {
    terminalOutput.value += `\nERROR: ${err.response?.data?.message || 'Failed to execute command'}`;
  } finally {
    executing.value = false;
  }
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
  }
}

function closeLiveLogs() {
  showLiveLogsModal.value = false;
  liveLogs.value = '';
}

async function handleDelete() {
  if (!environment.value) return;

  if (!confirm(`Are you sure you want to delete environment "${environment.value.name}"? This action cannot be undone.`)) {
    return;
  }

  try {
    deleting.value = true;
    showDeleteModal.value = true;
    error.value = '';

    // Simulate progress steps
    deletionStep.value = 'Stopping containers...';
    deletionProgress.value = 20;

    // Start deletion
    const deletePromise = environmentApi.delete(environment.value.id);

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
    router.push('/');
  } catch (err: any) {
    showDeleteModal.value = false;
    error.value = err.response?.data?.message || 'Failed to delete environment';
  } finally {
    deleting.value = false;
  }
}

function getStatusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-green-100 text-green-800';
    case 'creating':
      return 'bg-blue-100 text-blue-800';
    case 'failed':
      return 'bg-red-100 text-red-800';
    case 'deleting':
      return 'bg-yellow-100 text-yellow-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function getContainerStatusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'bg-green-100 text-green-800';
    case 'stopped':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

function formatDate(dateStr: string | Date): string {
  const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
  return date.toLocaleString();
}
</script>
