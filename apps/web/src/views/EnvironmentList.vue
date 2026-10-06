<template>
  <div>
    <div class="flex flex-wrap justify-between items-center gap-4 mb-8">
      <div>
        <h1 class="text-4xl font-bold mb-2">Environments</h1>
        <p class="text-lg opacity-70">One copy of a project per branch, with its own URL</p>
      </div>
      <button :disabled="projects.length === 0" class="primary-action" @click="creating = true">
        <i class="pi pi-plus text-lg"></i>
        <span class="text-lg">New environment</span>
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="projects.length === 0" class="text-center py-20">
      <i class="pi pi-folder-open text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">Add a project first: environments are copies of a project.</p>
      <router-link to="/projects" class="text-purple-600 dark:text-purple-400 font-medium hover:underline">Go to projects</router-link>
    </div>

    <div v-else>
      <div class="flex flex-wrap items-center gap-3 mb-8 pb-6 border-b border-slate-300 dark:border-purple-800/30">
        <Select
          v-model="projectFilter"
          :options="projects"
          option-label="name"
          option-value="slug"
          placeholder="All projects"
          show-clear
          class="w-56"
          @change="syncQuery"
        />
        <button
          v-for="filter in statusFilters"
          :key="filter.value"
          :class="[
            'flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200',
            statusFilter === filter.value
              ? 'bg-slate-200 dark:bg-dark-700 text-slate-900 dark:text-white'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/50',
          ]"
          @click="statusFilter = filter.value"
        >
          <span v-if="filter.dot" :class="['h-2 w-2 rounded-full', filter.dot]"></span>
          <span class="font-medium">{{ filter.label }}</span>
          <span class="text-sm opacity-70">({{ filter.count }})</span>
        </button>
      </div>

      <div v-if="visible.length === 0" class="text-center py-16 opacity-60">
        <i class="pi pi-sitemap text-5xl mb-4 block opacity-50"></i>
        <p class="text-lg">No environment here yet.</p>
        <p class="text-sm mt-2">Create one from this page, or from your terminal with the CLI.</p>
      </div>

      <div v-else class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <EnvironmentCard
          v-for="environment in visible"
          :key="environment.id"
          :environment="environment"
          @view="open"
          @stop="act($event, 'stop')"
          @start="act($event, 'start')"
          @redeploy="redeploy"
          @delete="confirmRemove"
        />
      </div>
    </div>

    <EnvironmentDialog v-model:visible="creating" :projects="projects" :project="projectFilter || undefined" @created="created" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Select from 'primevue/select';
import ProgressSpinner from 'primevue/progressspinner';
import EnvironmentCard from '../components/EnvironmentCard.vue';
import EnvironmentDialog from '../components/EnvironmentDialog.vue';
import { useNotification } from '../composables/useNotification';
import { environmentsApi, errorMessage, projectsApi } from '../services/api';
import type { Environment, JobAccepted, ProjectSummary } from '../types';
import { TONE_CLASSES, redeployRequest, statusTone, type StatusTone } from '../utils/environment';

const REFRESH_MS = 5000;

const route = useRoute();
const router = useRouter();
const { showError, showSuccess, confirmDelete } = useNotification();

const environments = ref<Environment[]>([]);
const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const creating = ref(false);
const projectFilter = ref((route.query.project as string) ?? '');
const statusFilter = ref<StatusTone | 'all'>('all');
let timer: ReturnType<typeof setInterval> | null = null;

const ofProject = computed(() => environments.value.filter((environment) => !projectFilter.value || environment.project === projectFilter.value));

const statusFilters = computed(() => {
  const count = (tone: StatusTone) => ofProject.value.filter((environment) => statusTone(environment.status) === tone).length;
  return [
    { value: 'all' as const, label: 'All', count: ofProject.value.length, dot: '' },
    { value: 'ready' as const, label: 'Ready', count: count('ready'), dot: TONE_CLASSES.ready.dot },
    { value: 'busy' as const, label: 'In progress', count: count('busy'), dot: TONE_CLASSES.busy.dot },
    { value: 'stopped' as const, label: 'Stopped', count: count('stopped'), dot: TONE_CLASSES.stopped.dot },
    { value: 'failed' as const, label: 'Failed', count: count('failed'), dot: TONE_CLASSES.failed.dot },
  ];
});

const visible = computed(() =>
  ofProject.value.filter((environment) => statusFilter.value === 'all' || statusTone(environment.status) === statusFilter.value),
);

async function load() {
  try {
    [environments.value, projects.value] = await Promise.all([environmentsApi.list(), projectsApi.list()]);
  } catch (err) {
    showError(errorMessage(err, 'The environments could not be loaded'));
  } finally {
    loading.value = false;
  }
}

function syncQuery() {
  router.replace({ query: projectFilter.value ? { project: projectFilter.value } : {} });
}

watch(
  () => route.query.project,
  (project) => (projectFilter.value = (project as string) ?? ''),
);

function open(environment: Environment) {
  router.push(`/environments/${environment.id}`);
}

function created(result: JobAccepted) {
  showSuccess(`${result.environment.slug} is being created`);
  open(result.environment);
}

function replace(result: JobAccepted) {
  environments.value = environments.value.map((environment) => (environment.id === result.environment.id ? result.environment : environment));
}

async function act(environment: Environment, action: 'stop' | 'start') {
  try {
    replace(await environmentsApi[action](environment.id));
  } catch (err) {
    showError(errorMessage(err, `${environment.slug} could not ${action}`));
  }
}

async function redeploy(environment: Environment) {
  const deploy = redeployRequest(environment);
  if (!deploy) {
    showError(`${environment.slug} was deployed from a local worktree: redeploy it with the CLI`);
    return;
  }
  try {
    replace(await environmentsApi.update(environment.id, deploy));
    showSuccess(`${environment.slug} is being redeployed`);
  } catch (err) {
    showError(errorMessage(err, `${environment.slug} could not be redeployed`));
  }
}

function confirmRemove(environment: Environment) {
  confirmDelete(environment.slug, async () => {
    try {
      replace(await environmentsApi.remove(environment.id));
      showSuccess(`${environment.slug} is being deleted`);
    } catch (err) {
      showError(errorMessage(err, `${environment.slug} could not be deleted`));
    }
  });
}

onMounted(() => {
  load();
  timer = setInterval(() => {
    environmentsApi
      .list()
      .then((list) => (environments.value = list))
      .catch(() => undefined);
  }, REFRESH_MS);
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
  }
});
</script>
