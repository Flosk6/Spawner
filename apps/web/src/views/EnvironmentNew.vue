<template>
  <div class="container mx-auto px-4 py-8 max-w-3xl">
    <div class="mb-6">
      <router-link
        :to="`/projects/${projectId}/environments`"
        class="text-blue-600 hover:text-blue-700"
      >
        ← Back to Environments
      </router-link>
    </div>

    <div class="bg-white shadow-md rounded-lg p-6">
      <h1 class="text-2xl font-bold text-gray-800 mb-2">Create New Environment</h1>
      <p v-if="project" class="text-gray-600 mb-6">
        Project: <strong>{{ project.name }}</strong>
      </p>

      <div v-if="loading" class="text-center py-8 text-gray-600">
        Loading project configuration...
      </div>

      <form v-else @submit.prevent="handleSubmit" class="space-y-6">
        <!-- Environment Name -->
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">
            Environment Name <span class="text-red-500">*</span>
          </label>
          <input
            v-model="envName"
            type="text"
            required
            pattern="^[a-z0-9-]+$"
            placeholder="feature-auth-123"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <p class="mt-1 text-sm text-gray-500">
            Only lowercase letters, numbers, and hyphens allowed
          </p>
        </div>

        <!-- Git Branches -->
        <div v-if="gitResources.length > 0">
          <h3 class="text-lg font-medium text-gray-800 mb-4">Select Branches</h3>
          <div class="space-y-4">
            <div
              v-for="resource in gitResources"
              :key="resource.id"
              class="border border-gray-200 rounded-lg p-4"
            >
              <label class="block text-sm font-medium text-gray-700 mb-2">
                {{ resource.name }}
                <span class="text-xs text-gray-500 font-normal ml-2">
                  (default: {{ resource.defaultBranch }})
                </span>
              </label>
              <input
                v-model="branches[resource.name]"
                type="text"
                required
                :placeholder="resource.defaultBranch"
                class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        <div v-else class="text-center py-8 text-gray-500">
          No git resources found in this project.
        </div>

        <!-- Local Mode Option -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <label class="flex items-center cursor-pointer">
            <input
              type="checkbox"
              v-model="localMode"
              class="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            <div class="ml-3">
              <span class="text-sm font-medium text-gray-900">Local Mode</span>
              <p class="text-xs text-gray-600 mt-1">
                Expose ports (8000, 8001, 8002...) to access services directly on localhost without DNS/Traefik
              </p>
            </div>
          </label>
        </div>

        <!-- Error Message -->
        <div
          v-if="error"
          class="p-4 bg-red-50 border border-red-200 rounded-lg"
        >
          <p class="text-red-800 text-sm">{{ error }}</p>
        </div>

        <!-- Actions -->
        <div class="flex gap-3 pt-4">
          <button
            type="submit"
            :disabled="creating || gitResources.length === 0"
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {{ creating ? 'Creating Environment...' : 'Create Environment' }}
          </button>
          <router-link
            :to="`/projects/${projectId}/environments`"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-3 rounded-lg font-medium text-center transition"
          >
            Cancel
          </router-link>
        </div>
      </form>
    </div>

    <!-- Creation Logs Modal -->
    <div
      v-if="showLogsModal"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    >
      <div class="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold">
            Creating Environment: {{ envName }}
          </h3>
          <div v-if="creationComplete" class="flex items-center gap-2">
            <span v-if="creationSuccess" class="text-green-600 font-medium">✓ Success</span>
            <span v-else class="text-red-600 font-medium">✗ Failed</span>
            <button
              @click="closeLogsModal"
              class="text-gray-500 hover:text-gray-700 ml-4"
            >
              ✕
            </button>
          </div>
          <div v-else class="flex items-center">
            <div class="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
          </div>
        </div>

        <!-- Progress Steps -->
        <div class="mb-4 flex gap-2 text-xs flex-wrap">
          <span
            v-for="step in steps"
            :key="step.id"
            :class="{
              'bg-blue-100 text-blue-700': currentStep === step.id && !completedSteps.includes(step.id),
              'bg-green-100 text-green-700': completedSteps.includes(step.id),
              'bg-gray-100 text-gray-500': currentStep !== step.id && !completedSteps.includes(step.id)
            }"
            class="px-3 py-1 rounded font-medium"
          >
            {{ completedSteps.includes(step.id) ? '✓' : '' }} {{ step.label }}
          </span>
        </div>

        <!-- Logs Display -->
        <div class="flex-1 overflow-auto">
          <div
            ref="logsContainer"
            class="bg-gray-900 p-4 rounded text-sm font-mono whitespace-pre-wrap h-full overflow-auto"
          >
            <div v-for="(line, index) in logsLines" :key="index" :class="getLogLineClass(line)">
              {{ line }}
            </div>
            <div v-if="logsLines.length === 0" class="text-gray-500">
              Connecting to server...
            </div>
          </div>
        </div>

        <div v-if="creationComplete" class="mt-4 flex gap-3">
          <button
            v-if="creationSuccess"
            @click="goToEnvironment"
            class="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition"
          >
            View Environment
          </button>
          <button
            @click="closeLogsModal"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded-lg font-medium transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';

const route = useRoute();
const router = useRouter();

const projectId = ref(null);
const project = ref(null);
const envName = ref('');
const branches = ref({});
const localMode = ref(false);
const gitResources = ref([]);
const loading = ref(true);
const creating = ref(false);
const error = ref('');

// Logs modal state
const showLogsModal = ref(false);
const logsText = ref('');
const logsContainer = ref(null);
const currentStep = ref('');
const completedSteps = ref([]);
const creationComplete = ref(false);
const creationSuccess = ref(false);
const createdEnvironmentId = ref(null);
const eventSource = ref(null);

const steps = [
  { id: 'init', label: 'Initialize' },
  { id: 'git', label: 'Git Clone' },
  { id: 'docker', label: 'Docker Build' },
  { id: 'health-check', label: 'Health Check' },
  { id: 'post-build', label: 'Post-Build' },
  { id: 'complete', label: 'Complete' },
];

// Computed property to split logs into lines
const logsLines = computed(() => {
  return logsText.value.split('\n').filter(line => line.trim() !== '');
});

// Function to get CSS class for each log line
function getLogLineClass(line) {
  if (line.includes('[OK]')) {
    return 'text-green-400';
  } else if (line.includes('[ERR]') || line.includes('[ERROR]')) {
    return 'text-red-400';
  } else if (line.includes('[WARN]')) {
    return 'text-yellow-400';
  } else {
    return 'text-gray-300';
  }
}

async function loadProject() {
  projectId.value = parseInt(route.params.projectId);

  try {
    loading.value = true;

    // Load project details
    const projectResponse = await axios.get(`/api/projects/${projectId.value}`);
    project.value = projectResponse.data;

    // Load resources
    const resourcesResponse = await axios.get(`/api/projects/${projectId.value}/resources`);
    gitResources.value = resourcesResponse.data.filter(
      r => r.type === 'laravel-api' || r.type === 'nextjs-front'
    );

    // Initialize branches with default values
    gitResources.value.forEach(resource => {
      branches.value[resource.name] = resource.defaultBranch || '';
    });
  } catch (err) {
    console.error('Error loading project:', err);
    error.value = err.response?.data?.message || 'Failed to load project';
  } finally {
    loading.value = false;
  }
}

async function handleSubmit() {
  try {
    creating.value = true;
    error.value = '';

    const payload = {
      name: envName.value,
      branches: branches.value,
      localMode: localMode.value,
    };

    // Open modal immediately
    showLogsModal.value = true;
    logsText.value = '';
    currentStep.value = 'init';
    completedSteps.value = [];
    creationComplete.value = false;
    creationSuccess.value = false;

    const response = await axios.post(
      `/api/projects/${projectId.value}/environments`,
      payload
    );

    createdEnvironmentId.value = response.data.id;

    // Connect to SSE for real-time logs
    connectToSSE(response.data.id);
  } catch (err) {
    console.error('Error creating environment:', err);
    error.value = err.response?.data?.message || 'Failed to create environment';
    showLogsModal.value = false;
  } finally {
    creating.value = false;
  }
}

function connectToSSE(environmentId) {
  console.log('[SSE] Connecting to:', `/api/environments/creation-logs/${environmentId}`);
  eventSource.value = new EventSource(`/api/environments/creation-logs/${environmentId}`);

  eventSource.value.onopen = () => {
    console.log('[SSE] Connection established');
  };

  eventSource.value.onmessage = (event) => {
    const log = JSON.parse(event.data);
    console.log('[SSE] Received log:', log);

    // Format log message with color codes based on level
    const timestamp = new Date(log.timestamp).toLocaleTimeString();
    let prefix = '';
    if (log.level === 'success') {
      prefix = '[OK]';
    } else if (log.level === 'error') {
      prefix = '[ERR]';
    } else if (log.level === 'warning') {
      prefix = '[WARN]';
    } else {
      prefix = '[INFO]';
    }

    logsText.value += `${timestamp} ${prefix} ${log.message}\n`;

    // Update current step
    if (log.step) {
      console.log('[SSE] Step update:', currentStep.value, '->', log.step);

      // Mark previous step as complete if moving to new step
      if (currentStep.value && currentStep.value !== log.step) {
        if (!completedSteps.value.includes(currentStep.value)) {
          console.log('[SSE] Marking step as complete:', currentStep.value);
          // Use array spread to force reactivity
          completedSteps.value = [...completedSteps.value, currentStep.value];
        }
      }

      currentStep.value = log.step;
      console.log('[SSE] Current step is now:', currentStep.value);
      console.log('[SSE] Completed steps:', completedSteps.value);
    }

    // Check for completion
    if (log.step === 'complete' && log.level === 'success') {
      completedSteps.value.push('complete');
      creationComplete.value = true;
      creationSuccess.value = true;
      eventSource.value.close();
    } else if (log.step === 'error' || (log.level === 'error' && log.message.includes('creation failed'))) {
      creationComplete.value = true;
      creationSuccess.value = false;
      eventSource.value.close();
    }

    // Auto-scroll to bottom
    setTimeout(() => {
      if (logsContainer.value) {
        logsContainer.value.scrollTop = logsContainer.value.scrollHeight;
      }
    }, 10);
  };

  eventSource.value.onerror = (err) => {
    console.error('SSE connection error:', err);
    if (!creationComplete.value) {
      logsText.value += '\n[ERROR] Connection to server lost\n';
      creationComplete.value = true;
      creationSuccess.value = false;
    }
    eventSource.value.close();
  };
}

function closeLogsModal() {
  showLogsModal.value = false;
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }

  // If creation was successful, redirect to environment detail
  if (creationSuccess.value && createdEnvironmentId.value) {
    router.push(`/environments/${createdEnvironmentId.value}`);
  }
}

function goToEnvironment() {
  if (createdEnvironmentId.value) {
    router.push(`/environments/${createdEnvironmentId.value}`);
  }
}

onMounted(() => {
  loadProject();
});

onBeforeUnmount(() => {
  // Close SSE connection if still open
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }
});
</script>
