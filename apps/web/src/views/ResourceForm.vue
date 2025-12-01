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
            @click="$router.push(`/projects/${projectId}`)"
            v-tooltip.bottom="'Back to Project'"
          />
          <div>
            <h1 class="text-2xl font-bold text-slate-900 dark:text-white">
              {{ isEdit ? 'Edit Resource' : 'Add Resource' }}
            </h1>
            <p class="text-sm text-slate-600 dark:text-slate-400">
              {{ isEdit ? 'Update the configuration for this resource' : 'Configure a new resource for your project' }}
            </p>
          </div>
        </div>

        <div class="flex gap-3">
          <Button
            label="Cancel"
            severity="secondary"
            outlined
            @click="$router.push(`/projects/${projectId}`)"
          />
          <Button
            :label="saving ? 'Saving...' : (isEdit ? 'Update' : 'Create')"
            :loading="saving"
            :disabled="loading"
            icon="pi pi-save"
            @click="save"
          />
        </div>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <div v-if="loading" class="flex justify-center py-20">
        <ProgressSpinner />
      </div>

    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Left Column: Configuration Cards -->
      <div class="space-y-6">
        <!-- Basic Information Card -->
      <Card>
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-info-circle text-blue-500"></i>
            <span>Basic Information</span>
          </div>
        </template>
        <template #content>
          <div class="grid gap-6">
            <!-- Name -->
            <div class="flex flex-col gap-2">
              <label for="resourceName" class="font-semibold text-slate-700 dark:text-slate-300">
                Resource Name <span class="text-red-500">*</span>
              </label>
              <InputText
                id="resourceName"
                v-model="form.name"
                placeholder="my-api"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">
                A unique identifier for this resource (lowercase, numbers, and hyphens only)
              </small>
            </div>

            <!-- Type -->
            <div class="flex flex-col gap-2">
              <label for="resourceType" class="font-semibold text-slate-700 dark:text-slate-300">
                Resource Type <span class="text-red-500">*</span>
              </label>
              <Select
                id="resourceType"
                v-model="form.type"
                :options="resourceTypes"
                optionLabel="label"
                optionValue="value"
                placeholder="Select a resource type"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">
                The type of service this resource provides
              </small>
            </div>
          </div>
        </template>
      </Card>

      <!-- Git Configuration Card (for non-DB resources) -->
      <Card v-if="form.type !== 'mysql-db'">
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-github text-purple-500"></i>
            <span>Git Configuration</span>
          </div>
        </template>
        <template #content>
          <div class="grid gap-6">
            <!-- Git Repo -->
            <div class="flex flex-col gap-2">
              <label for="gitRepo" class="font-semibold text-slate-700 dark:text-slate-300">
                Git Repository <span class="text-red-500">*</span>
              </label>
              <InputText
                id="gitRepo"
                v-model="form.gitRepo"
                placeholder="git@github.com:org/repo.git"
                class="w-full font-mono text-sm"
              />
              <small class="text-slate-600 dark:text-slate-400">
                SSH clone URL for your repository
              </small>
            </div>

            <!-- Default Branch -->
            <div class="flex flex-col gap-2">
              <label for="defaultBranch" class="font-semibold text-slate-700 dark:text-slate-300">
                Default Branch <span class="text-red-500">*</span>
              </label>
              <InputText
                id="defaultBranch"
                v-model="form.defaultBranch"
                placeholder="main"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">
                The default branch to use when creating new environments
              </small>
            </div>
          </div>
        </template>
      </Card>

      <!-- Advanced Configuration Card -->
      <Card v-if="form.type !== 'mysql-db'">
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-wrench text-indigo-500"></i>
            <span>Advanced Configuration</span>
          </div>
        </template>
        <template #content>
          <div class="grid gap-6">
            <!-- Post-Build Commands -->
            <div class="flex flex-col gap-2">
              <label for="postBuildCommands" class="font-semibold text-slate-700 dark:text-slate-300">
                Post-Build Commands
              </label>
              <small class="text-slate-600 dark:text-slate-400 mb-2">
                Commands to run after containers start (one per line). Example: migrations, seeds, cache warm-up.
              </small>
              <Textarea
                id="postBuildCommands"
                v-model="postBuildCommandsText"
                rows="6"
                placeholder="php artisan migrate --force
php artisan db:seed --force"
                class="font-mono text-sm w-full"
              />
            </div>

            <!-- Exposed Port -->
            <div class="flex flex-col gap-2">
              <label for="exposedPort" class="font-semibold text-slate-700 dark:text-slate-300">
                Exposed Port
              </label>
              <small class="text-slate-600 dark:text-slate-400 mb-2">
                Port that your Docker container exposes. Leave empty for defaults (Laravel: 8000, Next.js: 3000).
              </small>
              <InputText
                id="exposedPort"
                v-model="form.exposedPort"
                type="number"
                :placeholder="getDefaultExposedPort()"
                class="w-full"
              />
            </div>
          </div>
        </template>
      </Card>

      <!-- Resource Limits Card -->
      <Card>
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-server text-red-500"></i>
            <span>Resource Limits (Optional)</span>
          </div>
        </template>
        <template #content>
          <div class="mb-4">
            <small class="text-slate-600 dark:text-slate-400">
              Configure Docker resource limits for this service. Leave empty to use defaults.
              <strong>Max allowed:</strong> 8 CPUs, 16GB RAM.
            </small>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- CPU Limit -->
            <div class="flex flex-col gap-2">
              <label for="cpuLimit" class="font-semibold text-slate-700 dark:text-slate-300">CPU Limit</label>
              <InputText
                id="cpuLimit"
                v-model="form.resourceLimits.cpu"
                :placeholder="`Default: ${getDefaultLimit('cpu')}`"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">Example: 2, 0.5, 4</small>
            </div>

            <!-- Memory Limit -->
            <div class="flex flex-col gap-2">
              <label for="memoryLimit" class="font-semibold text-slate-700 dark:text-slate-300">Memory Limit</label>
              <InputText
                id="memoryLimit"
                v-model="form.resourceLimits.memory"
                :placeholder="`Default: ${getDefaultLimit('memory')}`"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">Example: 1G, 512M, 2G</small>
            </div>

            <!-- CPU Reservation -->
            <div class="flex flex-col gap-2">
              <label for="cpuReservation" class="font-semibold text-slate-700 dark:text-slate-300">CPU Reservation</label>
              <InputText
                id="cpuReservation"
                v-model="form.resourceLimits.cpuReservation"
                :placeholder="`Default: ${getDefaultLimit('cpuReservation')}`"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">Guaranteed minimum CPUs</small>
            </div>

            <!-- Memory Reservation -->
            <div class="flex flex-col gap-2">
              <label for="memoryReservation" class="font-semibold text-slate-700 dark:text-slate-300">Memory Reservation</label>
              <InputText
                id="memoryReservation"
                v-model="form.resourceLimits.memoryReservation"
                :placeholder="`Default: ${getDefaultLimit('memoryReservation')}`"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">Guaranteed minimum RAM</small>
            </div>
          </div>
        </template>
      </Card>
      </div>

      <!-- Right Column: Environment Variables -->
      <div class="space-y-6">
        <Card class="h-full flex flex-col">
          <template #title>
            <div class="flex items-center gap-2">
              <i class="pi pi-cog text-orange-500"></i>
              <span>Environment Variables</span>
              <i class="pi pi-info-circle cursor-pointer opacity-60 hover:opacity-100 transition-opacity ml-auto" v-tooltip.right="{
                value: templateHelpHTML,
                escape: false
              }"></i>
            </div>
          </template>
          <template #content>
            <div class="flex flex-col gap-2 flex-1">
              <small class="text-slate-600 dark:text-slate-400 mb-2">
                Type <code class="bg-blue-500 text-white px-1.5 py-0.5 rounded text-xs">{{ '{{' }}</code> to autocomplete
                template variables
              </small>
              <TemplateAutocomplete
                id="staticEnvVars"
                v-model="form.staticEnvVars"
                :all-resources="allResources"
                :rows="30"
                placeholder="# Static values
APP_NAME=My Application
ROLLBAR_TOKEN=your_token_here

# Template examples
DB_HOST={{resource.main-db.host}}
API_URL={{resource.main-api.url}}"
                class="flex-1"
              />
            </div>
          </template>
        </Card>
      </div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Select from 'primevue/select';
import ProgressSpinner from 'primevue/progressspinner';
import { useNotification } from '../composables/useNotification';
import TemplateAutocomplete from '../components/TemplateAutocomplete.vue';

interface ResourceLimits {
  cpu?: string;
  memory?: string;
  cpuReservation?: string;
  memoryReservation?: string;
}

interface Resource {
  id: number;
  name: string;
  type: string;
  gitRepo?: string;
  defaultBranch?: string;
  staticEnvVars?: Record<string, string>;
  postBuildCommands?: string[];
  resourceLimits?: ResourceLimits;
  exposedPort?: number;
}

const route = useRoute();
const router = useRouter();
const { showSuccess, showError } = useNotification();

const projectId = computed(() => parseInt(route.params.projectId as string));
const resourceId = computed(() => route.params.resourceId ? parseInt(route.params.resourceId as string) : null);
const isEdit = computed(() => !!resourceId.value);

const loading = ref(true);
const saving = ref(false);
const allResources = ref<Resource[]>([]);

const templateHelpHTML = computed(() => `
  <div class="space-y-2 text-sm">
    <div class="font-semibold mb-2">Available templates:</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;self.url&rbrace;&rbrace;</code> - This resource's URL</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.url&rbrace;&rbrace;</code> - Another resource's URL</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.host&rbrace;&rbrace;</code> - Database host</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.database&rbrace;&rbrace;</code> - Database name</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.username&rbrace;&rbrace;</code> - Database username</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.password&rbrace;&rbrace;</code> - Database password</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;env.name&rbrace;&rbrace;</code> - Environment name</div>
    <div><code class="bg-blue-500 text-white px-1 rounded">&lbrace;&lbrace;project.baseDomain&rbrace;&rbrace;</code> - Project domain</div>
  </div>
`);

const resourceTypes = [
  { label: 'MySQL Database', value: 'mysql-db' },
  { label: 'Laravel API', value: 'laravel-api' },
  { label: 'Next.js Frontend', value: 'nextjs-front' },
];

const defaultResourceLimits: Record<string, ResourceLimits> = {
  'mysql-db': {
    cpu: '2',
    memory: '2G',
    cpuReservation: '0.5',
    memoryReservation: '512M',
  },
  'laravel-api': {
    cpu: '2',
    memory: '1G',
    cpuReservation: '0.25',
    memoryReservation: '256M',
  },
  'nextjs-front': {
    cpu: '1',
    memory: '1G',
    cpuReservation: '0.25',
    memoryReservation: '256M',
  },
};

const form = ref({
  name: '',
  type: 'mysql-db',
  gitRepo: '',
  defaultBranch: 'main',
  staticEnvVars: '',
  exposedPort: '',
  resourceLimits: {
    cpu: '',
    memory: '',
    cpuReservation: '',
    memoryReservation: '',
  },
});

const postBuildCommandsText = ref('');

function getDefaultLimit(field: keyof ResourceLimits): string {
  const defaults = defaultResourceLimits[form.value.type];
  return defaults[field] || '';
}

function getDefaultExposedPort(): string {
  const defaults: Record<string, number> = {
    'laravel-api': 8000,
    'nextjs-front': 3000,
    'mysql-db': 3306,
  };
  return defaults[form.value.type]?.toString() || '';
}

function stringifyEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

async function loadData() {
  try {
    loading.value = true;

    // Load all resources for the project
    const resourcesResponse = await axios.get(`/api/projects/${projectId.value}/resources`);
    allResources.value = resourcesResponse.data;

    // If editing, load the specific resource
    if (isEdit.value && resourceId.value) {
      const resource = allResources.value.find(r => r.id === resourceId.value);
      if (resource) {
        form.value = {
          name: resource.name || '',
          type: resource.type || 'mysql-db',
          gitRepo: resource.gitRepo || '',
          defaultBranch: resource.defaultBranch || 'main',
          staticEnvVars: stringifyEnvVars(resource.staticEnvVars || {}),
          exposedPort: resource.exposedPort?.toString() || '',
          resourceLimits: {
            cpu: resource.resourceLimits?.cpu || '',
            memory: resource.resourceLimits?.memory || '',
            cpuReservation: resource.resourceLimits?.cpuReservation || '',
            memoryReservation: resource.resourceLimits?.memoryReservation || '',
          },
        };

        postBuildCommandsText.value = (resource.postBuildCommands || []).join('\n');
      }
    }
  } catch (error) {
    console.error('Error loading data:', error);
    showError('Failed to load resource data');
    router.push(`/projects/${projectId.value}`);
  } finally {
    loading.value = false;
  }
}

async function save() {
  // Validation
  if (!form.value.name) {
    showError('Please enter a resource name');
    return;
  }

  if (form.value.type !== 'mysql-db') {
    if (!form.value.gitRepo || !form.value.defaultBranch) {
      showError('Please fill in Git repository and default branch');
      return;
    }
  }

  try{
    saving.value = true;

    // Convert post-build commands text to array
    const postBuildCommands = postBuildCommandsText.value
      .split('\n')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0 && !cmd.startsWith('#'));

    const resourceLimits: ResourceLimits = {};
    if (form.value.resourceLimits.cpu) resourceLimits.cpu = form.value.resourceLimits.cpu;
    if (form.value.resourceLimits.memory) resourceLimits.memory = form.value.resourceLimits.memory;
    if (form.value.resourceLimits.cpuReservation) resourceLimits.cpuReservation = form.value.resourceLimits.cpuReservation;
    if (form.value.resourceLimits.memoryReservation) resourceLimits.memoryReservation = form.value.resourceLimits.memoryReservation;

    const payload = {
      name: form.value.name,
      type: form.value.type,
      gitRepo: form.value.gitRepo || null,
      defaultBranch: form.value.defaultBranch || null,
      staticEnvVars: form.value.staticEnvVars,
      postBuildCommands: postBuildCommands,
      resourceLimits: Object.keys(resourceLimits).length > 0 ? resourceLimits : null,
      exposedPort: form.value.exposedPort ? parseInt(form.value.exposedPort) : null,
    };

    if (isEdit.value && resourceId.value) {
      await axios.put(
        `/api/projects/${projectId.value}/resources/${resourceId.value}`,
        payload
      );
      showSuccess('Resource updated successfully');
    } else {
      await axios.post(`/api/projects/${projectId.value}/resources`, payload);
      showSuccess('Resource created successfully');
    }

    router.push(`/projects/${projectId.value}`);
  } catch (error: any) {
    console.error('Error saving resource:', error);
    showError(error.response?.data?.message || 'Failed to save resource');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadData();
});
</script>
