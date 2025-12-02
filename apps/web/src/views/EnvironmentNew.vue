<template>
  <div class="flex flex-col h-[calc(100vh-5rem)]">
    <!-- Sticky Header -->
    <div class="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <Button
            icon="pi pi-arrow-left"
            text
            rounded
            @click="handleBack"
            v-tooltip.bottom="'Back to Environments'"
          />
          <div>
            <h1 class="text-2xl font-bold text-slate-900 dark:text-white">Create New Environment</h1>
            <p class="text-sm text-slate-600 dark:text-slate-400">
              <span v-if="project">Project: <strong>{{ project.name }}</strong></span>
              <span v-else-if="!isProjectBased">Select a project to create an environment</span>
            </p>
          </div>
        </div>

        <div class="flex gap-3">
          <Button
            label="Cancel"
            severity="secondary"
            outlined
            @click="handleBack"
          />
          <Button
            :label="creating ? 'Creating...' : 'Create Environment'"
            :loading="creating"
            :disabled="loading || !canSubmit"
            icon="pi pi-plus"
            @click="handleSubmit"
          />
        </div>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <Card class="max-w-2xl">
        <template #content>
          <div v-if="loading" class="flex justify-center py-8">
            <ProgressSpinner />
          </div>

          <div v-else class="flex flex-col gap-6">
          <!-- Project Selection (only in global mode) -->
          <div v-if="!isProjectBased" class="flex flex-col gap-2">
            <label for="project" class="font-semibold">
              Select Project <span class="text-red-500">*</span>
            </label>
            <Dropdown
              id="project"
              v-model="selectedProjectId"
              :options="allProjects"
              optionLabel="name"
              optionValue="id"
              placeholder="Choose a project..."
              @change="onProjectChange"
              class="w-full"
            />
          </div>
          <!-- Environment Name -->
          <div class="flex flex-col gap-2">
            <label for="envName" class="font-semibold">
              Environment Name <span class="text-red-500">*</span>
            </label>
            <InputText
              id="envName"
              v-model="envName"
              required
              pattern="^[a-z0-9-]+$"
              placeholder="feature-auth-123"
            />
            <small class="opacity-70">
              Only lowercase letters, numbers, and hyphens allowed
            </small>
          </div>

          <!-- Git Branches -->
          <div v-if="gitResources.length > 0">
            <h3 class="text-xl font-semibold mb-4">Select Branches</h3>
            <div class="flex flex-col gap-4">
              <Card
                v-for="resource in gitResources"
                :key="resource.id"
              >
                <template #content>
                  <label :for="`branch-${resource.name}`" class="font-semibold mb-2 block">
                    {{ resource.name }}
                    <small class="opacity-70 font-normal ml-2">
                      (default: {{ resource.defaultBranch }})
                    </small>
                  </label>
                  <div class="flex gap-2">
                    <AutoComplete
                      :id="`branch-${resource.name}`"
                      v-model="branches[resource.name]"
                      :suggestions="branchSuggestions[resource.name] || []"
                      @complete="(event) => searchBranches(event, resource)"
                      :placeholder="resource.defaultBranch"
                      :loading="loadingBranches[resource.name]"
                      dropdown
                      class="flex-1"
                    />
                    <Button
                      icon="pi pi-refresh"
                      :loading="refreshingBranches[resource.name]"
                      :disabled="loadingBranches[resource.name]"
                      @click="refreshBranches(resource)"
                      v-tooltip.bottom="'Refresh branches from remote'"
                      outlined
                      severity="secondary"
                    />
                  </div>
                  <small v-if="!loadingBranches[resource.name] && (!allBranches[resource.name] || allBranches[resource.name].length === 0)" class="text-orange-600 text-xs mt-1 block">
                    Could not load branches. You can type the branch name manually.
                  </small>
                </template>
              </Card>
            </div>
          </div>

          <div v-else class="text-center py-8 opacity-70">
            No git resources found in this project.
          </div>

          <!-- Local Mode Option -->
          <Message severity="info" :closable="false">
            <div class="flex items-start gap-3">
              <Checkbox
                v-model="localMode"
                inputId="localMode"
                binary
              />
              <div class="flex-1">
                <label for="localMode" class="font-semibold cursor-pointer">Local Mode</label>
                <p class="text-sm opacity-70 mt-1">
                  Expose ports (8000, 8001, 8002...) to access services directly on localhost without DNS/Traefik
                </p>
              </div>
            </div>
          </Message>

          <!-- Error Message -->
          <Message v-if="error" severity="error" :closable="false">
            {{ error }}
          </Message>

        </div>
        </template>
      </Card>
    </div>

    <!-- Creation Logs Dialog -->
    <Dialog
      v-model:visible="showLogsModal"
      :header="`Creating Environment: ${envName}`"
      :modal="true"
      :closable="creationComplete"
      :style="{ width: '90vw', maxWidth: '1200px' }"
      :maximizable="true"
    >
      <div v-if="!creationComplete" class="flex items-center gap-2 mb-4">
        <ProgressSpinner style="width: 20px; height: 20px" />
        <span class="font-semibold">Creating environment...</span>
      </div>
      <div v-else class="flex items-center gap-2 mb-4">
        <i v-if="creationSuccess" class="pi pi-check-circle text-green-500 text-2xl"></i>
        <i v-else class="pi pi-times-circle text-red-500 text-2xl"></i>
        <span class="font-semibold" :class="creationSuccess ? 'text-green-600' : 'text-red-600'">
          {{ creationSuccess ? 'Success!' : 'Failed' }}
        </span>
      </div>

      <!-- Progress Steps -->
      <div class="flex gap-2 mb-4 flex-wrap">
        <Tag
          v-for="step in steps"
          :key="step.id"
          :value="step.label"
          :severity="getStepSeverity(step.id)"
          :icon="getStepIcon(step.id)"
        />
      </div>

      <!-- Logs Display -->
      <ScrollPanel style="width: 100%; height: 60vh" class="border rounded" ref="logsContainer">
        <div class="p-4 font-mono text-sm whitespace-pre-wrap">
          <div v-for="(line, index) in logsLines" :key="index" :class="getLogLineClass(line)">
            {{ line }}
          </div>
          <div v-if="logsLines.length === 0" class="opacity-50">
            Connecting to server...
          </div>
        </div>
      </ScrollPanel>

      <template #footer>
        <Button
          v-if="creationSuccess"
          label="View Environment"
          icon="pi pi-eye"
          @click="goToEnvironment"
        />
        <Button
          label="Close"
          severity="secondary"
          outlined
          @click="closeLogsModal"
        />
      </template>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import axios from 'axios';
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import AutoComplete from 'primevue/autocomplete';
import Dropdown from 'primevue/dropdown';
import Checkbox from 'primevue/checkbox';
import Message from 'primevue/message';
import Dialog from 'primevue/dialog';
import Tag from 'primevue/tag';
import ScrollPanel from 'primevue/scrollpanel';
import ProgressSpinner from 'primevue/progressspinner';

interface Project {
  id: number;
  name: string;
}

interface Resource {
  id: number;
  name: string;
  type: string;
  defaultBranch: string;
  gitRepo?: string;
}

const route = useRoute();
const router = useRouter();
const toast = useToast();

const isProjectBased = computed(() => !!route.params.projectId);

const canSubmit = computed(() => {
  return envName.value && gitResources.value.length > 0;
});
const projectId = ref<number>(0);
const selectedProjectId = ref<number | null>(null);
const allProjects = ref<Project[]>([]);
const project = ref<Project | null>(null);
const envName = ref('');
const branches = ref<Record<string, string>>({});
const localMode = ref(false);
const gitResources = ref<Resource[]>([]);
const loading = ref(true);
const creating = ref(false);
const error = ref('');

const branchSuggestions = ref<Record<string, string[]>>({});
const loadingBranches = ref<Record<string, boolean>>({});
const refreshingBranches = ref<Record<string, boolean>>({});
const allBranches = ref<Record<string, string[]>>({});
const errorTimeouts = ref<number[]>([]);

// Logs modal state
const showLogsModal = ref(false);
const logsText = ref('');
const logsContainer = ref<any>(null);
const currentStep = ref('');
const completedSteps = ref<string[]>([]);
const creationComplete = ref(false);
const creationSuccess = ref(false);
const createdEnvironmentId = ref<string | null>(null);
const eventSource = ref<EventSource | null>(null);

const steps = [
  { id: 'init', label: 'Initialize' },
  { id: 'git', label: 'Git Clone' },
  { id: 'docker', label: 'Docker Build' },
  { id: 'health-check', label: 'Health Check' },
  { id: 'post-build', label: 'Post-Build' },
  { id: 'complete', label: 'Complete' },
];

const logsLines = computed(() => {
  return logsText.value.split('\n').filter(line => line.trim() !== '');
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

function getStepSeverity(stepId: string): string {
  if (completedSteps.value.includes(stepId)) return 'success';
  if (currentStep.value === stepId) return 'info';
  return 'secondary';
}

function getStepIcon(stepId: string): string {
  if (completedSteps.value.includes(stepId)) return 'pi pi-check';
  if (currentStep.value === stepId) return 'pi pi-spin pi-spinner';
  return '';
}

async function loadProject() {
  if (isProjectBased.value) {
    projectId.value = parseInt(route.params.projectId as string);
    await loadProjectDetails(projectId.value);
  } else {
    try {
      loading.value = true;
      const response = await axios.get('/api/projects');
      allProjects.value = response.data;
    } catch (err: any) {
      console.error('Error loading projects:', err);
      error.value = err.response?.data?.message || 'Failed to load projects';
    } finally {
      loading.value = false;
    }
  }
}

async function loadProjectDetails(id: number) {
  try {
    loading.value = true;

    const projectResponse = await axios.get(`/api/projects/${id}`);
    project.value = projectResponse.data;

    const resourcesResponse = await axios.get(`/api/projects/${id}/resources`);
    gitResources.value = resourcesResponse.data.filter(
      (r: Resource) => r.type === 'laravel-api' || r.type === 'nextjs-front'
    );

    gitResources.value.forEach(resource => {
      branches.value[resource.name] = resource.defaultBranch || '';
    });

    await loadAllBranches();
  } catch (err: any) {
    console.error('Error loading project:', err);
    error.value = err.response?.data?.message || 'Failed to load project';
  } finally {
    loading.value = false;
  }
}

async function loadAllBranches() {
  await Promise.allSettled(
    gitResources.value.map(async (resource) => {
      if (!resource.gitRepo) return;

      try {
        loadingBranches.value[resource.name] = true;
        const response = await axios.post('/api/git/branches', {
          gitRepo: resource.gitRepo,
          resourceName: resource.name,
        });
        allBranches.value[resource.name] = response.data.branches;
        branchSuggestions.value[resource.name] = response.data.branches;
      } catch (err: any) {
        console.warn(`Could not load branches for ${resource.name}. SSH key may not be configured.`);
        allBranches.value[resource.name] = [];
        branchSuggestions.value[resource.name] = [];
      } finally {
        loadingBranches.value[resource.name] = false;
      }
    })
  );
}

function searchBranches(event: any, resource: Resource) {
  const query = event.query.toLowerCase();
  const resourceBranches = allBranches.value[resource.name] || [];

  if (!query) {
    branchSuggestions.value[resource.name] = resourceBranches;
  } else {
    branchSuggestions.value[resource.name] = resourceBranches.filter(branch =>
      branch.toLowerCase().includes(query)
    );
  }
}

async function refreshBranches(resource: Resource) {
  if (!resource.gitRepo) return;

  try {
    refreshingBranches.value[resource.name] = true;
    const response = await axios.post('/api/git/branches/refresh', {
      gitRepo: resource.gitRepo,
      resourceName: resource.name,
    });
    allBranches.value[resource.name] = response.data.branches;
    branchSuggestions.value[resource.name] = response.data.branches;

    toast.add({
      severity: 'success',
      summary: 'Branches refreshed',
      detail: `Found ${response.data.branches.length} branches for ${resource.name}`,
      life: 3000,
    });
  } catch (err: any) {
    console.error(`Error refreshing branches for ${resource.name}:`, err);
    const errorMessage = err.response?.data?.message || 'Failed to refresh branches. You can still type the branch name manually.';

    toast.add({
      severity: 'error',
      summary: 'Refresh failed',
      detail: errorMessage,
      life: 5000,
    });
  } finally {
    refreshingBranches.value[resource.name] = false;
  }
}

async function onProjectChange() {
  if (selectedProjectId.value) {
    projectId.value = selectedProjectId.value;
    branches.value = {};
    gitResources.value = [];
    await loadProjectDetails(selectedProjectId.value);
  }
}

function handleBack() {
  if (isProjectBased.value) {
    router.push(`/projects/${projectId.value}/environments`);
  } else {
    router.push('/environments');
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
    connectToSSE(response.data.id);
  } catch (err: any) {
    console.error('Error creating environment:', err);
    error.value = err.response?.data?.message || 'Failed to create environment';
    showLogsModal.value = false;
  } finally {
    creating.value = false;
  }
}

function scrollToBottom() {
  setTimeout(() => {
    if (logsContainer.value?.$el) {
      const scrollableContent = logsContainer.value.$el.querySelector('.p-scrollpanel-content');
      if (scrollableContent) {
        scrollableContent.scrollTop = scrollableContent.scrollHeight;
      }
    }
  }, 50);
}

function connectToSSE(environmentId: string) {
  eventSource.value = new EventSource(`/api/environments/creation-logs/${environmentId}`);

  eventSource.value.onmessage = (event) => {
    const log = JSON.parse(event.data);

    if (log.message && log.message.trim()) {
      const timestamp = new Date(log.timestamp).toLocaleTimeString();
      let prefix = '';
      if (log.level === 'success') prefix = '[OK]';
      else if (log.level === 'error') prefix = '[ERR]';
      else if (log.level === 'warning') prefix = '[WARN]';
      else prefix = '[INFO]';

      logsText.value += `${timestamp} ${prefix} ${log.message}\n`;
    }

    if (log.step) {
      if (currentStep.value && currentStep.value !== log.step) {
        if (!completedSteps.value.includes(currentStep.value)) {
          completedSteps.value = [...completedSteps.value, currentStep.value];
        }
      }
      currentStep.value = log.step;
    }

    if (log.step === 'complete' && log.level === 'success') {
      completedSteps.value.push('complete');
      creationComplete.value = true;
      creationSuccess.value = true;
      eventSource.value?.close();
    } else if (log.step === 'error' || (log.level === 'error' && log.message.includes('creation failed'))) {
      creationComplete.value = true;
      creationSuccess.value = false;
      eventSource.value?.close();
    }

    scrollToBottom();
  };

  eventSource.value.onerror = (err) => {
    console.error('SSE connection error:', err);
    if (!creationComplete.value) {
      logsText.value += '\n[ERROR] Connection to server lost\n';
      creationComplete.value = true;
      creationSuccess.value = false;
    }
    eventSource.value?.close();
  };
}

function closeLogsModal() {
  showLogsModal.value = false;
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }

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
  if (eventSource.value) {
    eventSource.value.close();
    eventSource.value = null;
  }

  errorTimeouts.value.forEach(timeout => clearTimeout(timeout));
  errorTimeouts.value = [];
});
</script>
