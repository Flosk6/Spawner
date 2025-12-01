<template>
  <Dialog :visible="true" :modal="true" :style="{ width: '700px' }" :header="isEdit ? 'Edit Resource' : 'Add Resource'"
    @update:visible="$emit('close')">
    <div class="flex flex-col gap-4">
      <!-- Name -->
      <div class="flex flex-col gap-2">
        <label for="resourceName" class="font-semibold">
          Resource Name <span class="text-red-500">*</span>
        </label>
        <InputText id="resourceName" v-model="form.name" placeholder="my-api" />
      </div>

      <!-- Type -->
      <div class="flex flex-col gap-2">
        <label for="resourceType" class="font-semibold">
          Resource Type <span class="text-red-500">*</span>
        </label>
        <Select id="resourceType" v-model="form.type" :options="resourceTypes" optionLabel="label" optionValue="value"
          placeholder="Select a resource type" />
      </div>

      <!-- Git Repo (for laravel-api and nextjs-front) -->
      <div v-if="form.type !== 'mysql-db'" class="flex flex-col gap-2">
        <label for="gitRepo" class="font-semibold">
          Git Repository <span class="text-red-500">*</span>
        </label>
        <InputText id="gitRepo" v-model="form.gitRepo" placeholder="git@github.com:org/repo.git" />
      </div>

      <!-- Default Branch -->
      <div v-if="form.type !== 'mysql-db'" class="flex flex-col gap-2">
        <label for="defaultBranch" class="font-semibold">
          Default Branch <span class="text-red-500">*</span>
        </label>
        <InputText id="defaultBranch" v-model="form.defaultBranch" placeholder="main" />
      </div>

      <!-- Environment Variables -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-2">
          <label for="staticEnvVars" class="font-semibold">
            Environment Variables
          </label>
          <i class="pi pi-info-circle cursor-pointer opacity-60 hover:opacity-100 transition-opacity template-help-tooltip" v-tooltip.right="{
            value: templateHelpHTML,
            escape: false
          }"></i>
        </div>
        <small class="opacity-70">
          Type <code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;</code> to autocomplete
          templates
        </small>
        <TemplateAutocomplete id="staticEnvVars" v-model="form.staticEnvVars" :all-resources="allResources" :rows="10"
          placeholder="# Static values
APP_NAME=My Application
ROLLBAR_TOKEN=your_token_here

# Template examples
DB_HOST={{resource.main-db.host}}
API_URL={{resource.main-api.url}}" />
      </div>

      <!-- Post-Build Commands -->
      <div v-if="form.type !== 'mysql-db'" class="flex flex-col gap-2">
        <label for="postBuildCommands" class="font-semibold">
          Post-Build Commands
        </label>
        <small class="opacity-70">
          Commands to run after containers start (one per line). Example: migrations, seeds, cache warm-up.
        </small>
        <Textarea id="postBuildCommands" v-model="postBuildCommandsText" rows="4" placeholder="php artisan migrate --force
php artisan db:seed --force" class="font-mono text-sm" />
      </div>

      <!-- Exposed Port (for Laravel/Next.js) -->
      <div v-if="form.type !== 'mysql-db'" class="flex flex-col gap-2">
        <label for="exposedPort" class="font-semibold">
          Exposed Port
        </label>
        <small class="opacity-70 mb-2">
          Port that your Docker container exposes. Leave empty for defaults (Laravel: 8000, Next.js: 3000).
        </small>
        <InputText id="exposedPort" v-model="form.exposedPort" type="number" :placeholder="getDefaultExposedPort()" />
      </div>

      <!-- Resource Limits (Advanced) -->
      <Accordion class="mt-4">
        <AccordionTab header="Resource Limits (Optional)">
          <small class="block mb-4 opacity-70">
            Configure Docker resource limits for this service. Leave empty to use defaults.
            <strong>Max allowed:</strong> 8 CPUs, 16GB RAM.
          </small>

          <div class="grid grid-cols-2 gap-4">
            <!-- CPU Limit -->
            <div class="flex flex-col gap-2">
              <label for="cpuLimit" class="font-semibold">CPU Limit</label>
              <InputText id="cpuLimit" v-model="form.resourceLimits.cpu"
                :placeholder="`Default: ${getDefaultLimit('cpu')}`" />
              <small class="opacity-60">Example: 2, 0.5, 4</small>
            </div>

            <!-- Memory Limit -->
            <div class="flex flex-col gap-2">
              <label for="memoryLimit" class="font-semibold">Memory Limit</label>
              <InputText id="memoryLimit" v-model="form.resourceLimits.memory"
                :placeholder="`Default: ${getDefaultLimit('memory')}`" />
              <small class="opacity-60">Example: 1G, 512M, 2G</small>
            </div>

            <!-- CPU Reservation -->
            <div class="flex flex-col gap-2">
              <label for="cpuReservation" class="font-semibold">CPU Reservation</label>
              <InputText id="cpuReservation" v-model="form.resourceLimits.cpuReservation"
                :placeholder="`Default: ${getDefaultLimit('cpuReservation')}`" />
              <small class="opacity-60">Guaranteed minimum CPUs</small>
            </div>

            <!-- Memory Reservation -->
            <div class="flex flex-col gap-2">
              <label for="memoryReservation" class="font-semibold">Memory Reservation</label>
              <InputText id="memoryReservation" v-model="form.resourceLimits.memoryReservation"
                :placeholder="`Default: ${getDefaultLimit('memoryReservation')}`" />
              <small class="opacity-60">Guaranteed minimum RAM</small>
            </div>
          </div>
        </AccordionTab>
      </Accordion>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" outlined @click="$emit('close')" />
      <Button :label="saving ? 'Saving...' : (isEdit ? 'Update' : 'Add Resource')" :loading="saving" @click="save" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import axios from 'axios';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Textarea from 'primevue/textarea';
import Select from 'primevue/select';
import Button from 'primevue/button';
import Accordion from 'primevue/accordion';
import AccordionTab from 'primevue/accordiontab';
import { useNotification } from '../composables/useNotification';
import TemplateAutocomplete from './TemplateAutocomplete.vue';

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

const props = defineProps<{
  projectId: number;
  resource?: Resource | null;
  allResources: Resource[];
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const { showError } = useNotification();

const isEdit = computed(() => !!props.resource);

const templateHelpHTML = computed(() => `
  <div class="space-y-2 text-sm">
    <div class="font-semibold mb-2">Available templates:</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;self.url&rbrace;&rbrace;</code> - This resource's URL</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.url&rbrace;&rbrace;</code> - Another resource's URL</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.host&rbrace;&rbrace;</code> - Database host</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.database&rbrace;&rbrace;</code> - Database name</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.username&rbrace;&rbrace;</code> - Database username</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;resource.NAME.password&rbrace;&rbrace;</code> - Database password</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;env.name&rbrace;&rbrace;</code> - Environment name</div>
    <div><code class="bg-primary-spawner text-white px-1 rounded">&lbrace;&lbrace;project.baseDomain&rbrace;&rbrace;</code> - Project domain</div>
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
const saving = ref(false);

const allResources = computed(() => {
  return props.allResources.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type
  }));
});

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

function initForm() {
  if (props.resource) {
    form.value = {
      name: props.resource.name || '',
      type: props.resource.type || 'mysql-db',
      gitRepo: props.resource.gitRepo || '',
      defaultBranch: props.resource.defaultBranch || 'main',
      staticEnvVars: stringifyEnvVars(props.resource.staticEnvVars || {}),
      exposedPort: props.resource.exposedPort?.toString() || '',
      resourceLimits: {
        cpu: props.resource.resourceLimits?.cpu || '',
        memory: props.resource.resourceLimits?.memory || '',
        cpuReservation: props.resource.resourceLimits?.cpuReservation || '',
        memoryReservation: props.resource.resourceLimits?.memoryReservation || '',
      },
    };

    postBuildCommandsText.value = (props.resource.postBuildCommands || []).join('\n');
  }
}

function stringifyEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
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

  try {
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

    if (isEdit.value && props.resource) {
      await axios.put(
        `/api/projects/${props.projectId}/resources/${props.resource.id}`,
        payload
      );
    } else {
      await axios.post(`/api/projects/${props.projectId}/resources`, payload);
    }

    emit('saved');
  } catch (error: any) {
    console.error('Error saving resource:', error);
    showError(error.response?.data?.message || 'Failed to save resource');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  initForm();
});
</script>
