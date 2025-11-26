<template>
  <div>
    <div class="mb-6">
      <Button
        label="Back to Environments"
        icon="pi pi-arrow-left"
        text
        @click="$router.push(`/projects/${projectId}/environments`)"
      />
    </div>

    <Card>
      <template #title>Create New Environment</template>
      <template #subtitle>
        <span v-if="project">Project: <strong>{{ project.name }}</strong></span>
      </template>
      <template #content>
        <div v-if="loading" class="flex justify-center py-8">
          <ProgressSpinner />
        </div>

        <form v-else @submit.prevent="handleSubmit" class="flex flex-col gap-6">
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
                  <InputText
                    :id="`branch-${resource.name}`"
                    v-model="branches[resource.name]"
                    required
                    :placeholder="resource.defaultBranch"
                  />
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

          <!-- Actions -->
          <div class="flex gap-3 pt-4">
            <Button
              type="submit"
              label="Create Environment"
              icon="pi pi-plus"
              :loading="creating"
              :disabled="gitResources.length === 0"
              class="flex-1"
            />
            <Button
              label="Cancel"
              severity="secondary"
              outlined
              @click="$router.push(`/projects/${projectId}/environments`)"
              class="flex-1"
            />
          </div>
        </form>
      </template>
    </Card>

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
import axios from 'axios';
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
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
}

const route = useRoute();
const router = useRouter();

const projectId = ref<number>(0);
const project = ref<Project | null>(null);
const envName = ref('');
const branches = ref<Record<string, string>>({});
const localMode = ref(false);
const gitResources = ref<Resource[]>([]);
const loading = ref(true);
const creating = ref(false);
const error = ref('');

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
  projectId.value = parseInt(route.params.projectId as string);

  try {
    loading.value = true;

    const projectResponse = await axios.get(`/api/projects/${projectId.value}`);
    project.value = projectResponse.data;

    const resourcesResponse = await axios.get(`/api/projects/${projectId.value}/resources`);
    gitResources.value = resourcesResponse.data.filter(
      (r: Resource) => r.type === 'laravel-api' || r.type === 'nextjs-front'
    );

    gitResources.value.forEach(resource => {
      branches.value[resource.name] = resource.defaultBranch || '';
    });
  } catch (err: any) {
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
});
</script>
