<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Environments</h1>
      <p class="page-lead">One copy of a project per branch, with its own URL.</p>
    </div>
    <div class="page-actions">
      <button type="button" class="btn btn-primary" :disabled="projects.length === 0" @click="creating = true"><Plus />New environment</button>
    </div>
  </div>

  <div v-if="loading" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <div v-else-if="projects.length === 0" class="card empty">
    <FolderGit2 class="size-6" />
    <span class="empty-title">No project yet</span>
    <span>Environments are copies of a project: a repository holding a <code>.spawner/</code> directory.</span>
    <RouterLink to="/projects" class="link mt-1">Go to the projects</RouterLink>
  </div>

  <template v-else>
    <div class="flex flex-wrap items-center gap-2">
      <div class="input-wrap w-full sm:w-72">
        <Search />
        <input v-model="search" class="input" type="search" placeholder="Filter by name, branch or owner" aria-label="Filter the environments" />
      </div>
      <SegmentedControl v-model="scope" :options="SCOPES" label="Owner" />
      <Select
        v-model="projectFilter"
        :options="projects"
        option-label="name"
        option-value="slug"
        placeholder="All projects"
        show-clear
        class="w-48"
        aria-label="Project"
        @change="syncQuery"
      />
    </div>

    <div class="chips" role="group" aria-label="Status">
      <button
        v-for="filter in statusFilters"
        :key="filter.value"
        type="button"
        class="chip"
        :class="{ 'is-active': statusFilter === filter.value }"
        :aria-pressed="statusFilter === filter.value"
        @click="statusFilter = filter.value"
      >
        <span v-if="filter.tone" class="dot" :class="`tone-${filter.tone}`"></span>{{ filter.label }}<span class="chip-count">{{ filter.count }}</span>
      </button>
    </div>

    <section class="card">
      <div class="table-wrap">
        <table v-if="statusFilter !== 'deleted'" class="table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Status</th>
              <th class="hidden xl:table-cell">Source</th>
              <th class="hidden md:table-cell">Owner</th>
              <th class="hidden xl:table-cell">Memory</th>
              <th class="hidden lg:table-cell">Lifecycle</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="environment in visible" :key="environment.id">
              <td class="max-w-[16rem]">
                <RouterLink :to="`/environments/${environment.id}`" class="row-title block">{{ environment.slug }}</RouterLink>
                <div class="row-sub">
                  <span class="font-medium text-fg-2">{{ environment.project }}</span><span aria-hidden="true">·</span><span>{{ timeAgo(environment.createdAt) }}</span>
                </div>
              </td>
              <td class="max-w-[15rem]">
                <EnvironmentStatus :status="environment.status" />
                <p v-if="note(environment)" class="note line-clamp-1" :class="`tone-${noteTone(environment)}`" :title="note(environment)">{{ note(environment) }}</p>
              </td>
              <td class="hidden max-w-[14rem] xl:table-cell">
                <SourceLabel v-if="primarySource(environment)" :source="primarySource(environment)!" />
              </td>
              <td class="hidden md:table-cell">
                <div class="flex items-center gap-2">
                  <UserAvatar v-if="environment.owner" :user="environment.owner" small />
                  <div class="flex min-w-0 flex-col leading-5">
                    <span class="truncate font-medium text-fg">{{ environment.owner?.name ?? 'Installation token' }}</span>
                    <span class="truncate text-xs text-fg-3">{{ origin(environment) }}</span>
                  </div>
                </div>
              </td>
              <td class="hidden w-32 xl:table-cell">
                <template v-if="environment.usage">
                  <div class="tabular-nums text-fg-2">{{ formatSize(environment.usage.memoryBytes) }}</div>
                  <div class="bar mt-1.5"><span class="bar-fill bg-accent" :style="{ width: `${memoryShare(environment)}%` }"></span></div>
                </template>
                <span v-else class="text-fg-3">-</span>
              </td>
              <td class="hidden whitespace-nowrap text-sm lg:table-cell">
                <div class="text-fg-2">{{ lifecycle(environment)[0] }}</div>
                <div class="text-xs text-fg-3">{{ lifecycle(environment)[1] }}</div>
              </td>
              <td class="cell-actions">
                <div class="flex justify-end gap-0.5">
                  <a
                    v-if="environment.url && openable(environment)"
                    :href="environment.url"
                    target="_blank"
                    rel="noopener"
                    class="btn btn-ghost btn-sm btn-icon hidden sm:inline-flex"
                    :aria-label="`Open ${environment.slug}`"
                    v-tooltip.top="'Open'"
                  >
                    <ExternalLink />
                  </a>
                  <button type="button" class="btn btn-ghost btn-sm btn-icon" :aria-label="`Actions for ${environment.slug}`" @click="openMenu($event, environment)">
                    <Ellipsis />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="visible.length === 0">
              <td colspan="7">
                <div class="empty">
                  <span class="empty-title">No environment here</span>
                  <span>Change the filters, or create one from this page or with <code>spawner up</code>.</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <table v-else class="table">
          <thead>
            <tr>
              <th>Environment</th>
              <th>Deleted</th>
              <th class="hidden md:table-cell">What stays</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="environment in visibleDeleted" :key="environment.id">
              <td>
                <RouterLink :to="`/environments/${environment.id}`" class="row-title block">{{ environment.slug }}</RouterLink>
                <div class="row-sub"><span class="font-medium text-fg-2">{{ environment.project }}</span><span aria-hidden="true">·</span><span>{{ environment.owner?.name ?? 'Installation token' }}</span></div>
              </td>
              <td class="text-fg-2">{{ timeAgo(environment.deletedAt) }}</td>
              <td class="hidden text-fg-3 md:table-cell">Its timeline and the last logs of its services, until {{ keptUntil(environment) }}</td>
              <td class="cell-actions">
                <RouterLink :to="`/environments/${environment.id}`" class="btn btn-ghost btn-sm">View</RouterLink>
              </td>
            </tr>
            <tr v-if="visibleDeleted.length === 0">
              <td colspan="4">
                <div class="empty">Nothing deleted in the last 7 days.</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <ActionMenu ref="rowMenu" :items="menuItems" />
  <EnvironmentDialog v-model:visible="creating" :projects="projects" :project="projectFilter || undefined" @created="created" />
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Select from 'primevue/select';
import { Ellipsis, ExternalLink, FolderGit2, Layers, LoaderCircle, Moon, Play, Plus, RefreshCw, ScrollText, Search, Square, Sun, Trash2 } from 'lucide-vue-next';
import ActionMenu, { type MenuAction } from '../components/ActionMenu.vue';
import EnvironmentDialog from '../components/EnvironmentDialog.vue';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import SourceLabel from '../components/SourceLabel.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { useNotification } from '../composables/useNotification';
import { useAuthStore } from '../stores/auth';
import { environmentsApi, errorMessage, projectsApi } from '../services/api';
import type { Environment, JobAccepted, ProjectSummary } from '../types';
import { STATUS_TONES, canManage, isBusy, originLabel, redeployRequest, statusTone, type StatusTone, type Tone } from '../utils/environment';
import { timeAgo, timeLeft } from '../utils/format';
import { formatSize } from '../utils/palette';

const REFRESH_MS = 5000;
const KEPT_DAYS = 7;
const SCOPES: { label: string; value: 'all' | 'mine' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Mine', value: 'mine' },
];

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const { showError, showSuccess, confirmDelete } = useNotification();

const environments = ref<Environment[]>([]);
const deleted = ref<Environment[]>([]);
const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const creating = ref(false);
const search = ref('');
const scope = ref<'all' | 'mine'>('all');
const projectFilter = ref((route.query.project as string) ?? '');
const statusFilter = ref<StatusTone | 'all' | 'deleted'>('all');
const rowMenu = ref<InstanceType<typeof ActionMenu> | null>(null);
const menuFor = ref<Environment | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

/** In the project and the scope chosen, and matching the search on its name, branches, owner or project. */
function kept(environment: Environment): boolean {
  if ((projectFilter.value && environment.project !== projectFilter.value) || (scope.value === 'mine' && environment.owner?.id !== authStore.user?.id)) {
    return false;
  }
  const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = [environment.slug, environment.project, environment.owner?.name ?? '', environment.tokenName ?? '', ...environment.sources.map((source) => source.ref ?? '')]
    .join(' ')
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

const ofScope = computed(() => environments.value.filter(kept));
const deletedOfScope = computed(() => deleted.value.filter(kept));

const statusFilters = computed(() => {
  const count = (tone: StatusTone) => ofScope.value.filter((environment) => statusTone(environment.status) === tone).length;
  const tones: { value: StatusTone; label: string }[] = [
    { value: 'ready', label: 'Ready' },
    { value: 'degraded', label: 'Degraded' },
    { value: 'sleeping', label: 'Sleeping' },
    { value: 'busy', label: 'In progress' },
    { value: 'stopped', label: 'Stopped' },
    { value: 'failed', label: 'Failed' },
  ];
  return [
    { value: 'all' as const, label: 'All', count: ofScope.value.length, tone: null as Tone | null },
    ...tones.map((item) => ({ ...item, count: count(item.value), tone: STATUS_TONES[item.value] as Tone | null })),
    { value: 'deleted' as const, label: 'Deleted', count: deletedOfScope.value.length, tone: null as Tone | null },
  ];
});

const visible = computed(() => ofScope.value.filter((environment) => statusFilter.value === 'all' || statusTone(environment.status) === statusFilter.value));
const visibleDeleted = computed(() => deletedOfScope.value);

function primarySource(environment: Environment) {
  return environment.sources.find((source) => source.primary) ?? null;
}

function origin(environment: Environment): string {
  return environment.tokenName ? `via ${environment.tokenName}` : originLabel(environment.createdVia);
}

/** What the status alone does not say: the error, or how a sleeping environment wakes up. */
function note(environment: Environment): string {
  if (environment.status === 'failed' && environment.error) {
    return environment.phase ? `${environment.phase}: ${environment.error}` : environment.error;
  }
  if (environment.status === 'degraded' && environment.error) {
    return environment.error;
  }
  if (environment.status === 'sleeping') {
    return 'Wakes up on the next visit';
  }
  return '';
}

function noteTone(environment: Environment): Tone {
  return environment.status === 'failed' ? 'danger' : environment.status === 'degraded' ? 'warn' : 'muted';
}

/** When it sleeps and when it expires, the nearest first. */
function lifecycle(environment: Environment): [string, string] {
  const expires = environment.expiresAt ? `Expires ${timeLeft(environment.expiresAt)}` : '';
  if (environment.status === 'sleeping') {
    return ['Asleep', expires];
  }
  if (environment.sleepsAt && ['ready', 'degraded'].includes(environment.status)) {
    return [`Sleeps ${timeLeft(environment.sleepsAt)}`, expires];
  }
  return [expires || '-', ''];
}

function memoryShare(environment: Environment): number {
  const usage = environment.usage;
  return usage?.memoryLimitBytes ? Math.min(100, (usage.memoryBytes / usage.memoryLimitBytes) * 100) : 0;
}

function openable(environment: Environment): boolean {
  return ['ready', 'degraded', 'sleeping'].includes(environment.status);
}

function keptUntil(environment: Environment): string {
  return environment.deletedAt ? new Date(new Date(environment.deletedAt).getTime() + KEPT_DAYS * 86_400_000).toLocaleDateString() : '';
}

const menuItems = computed<MenuAction[]>(() => {
  const environment = menuFor.value;
  if (!environment) {
    return [];
  }
  const url = environment.url && openable(environment) ? environment.url : null;
  const items: MenuAction[] = [
    ...(url ? [{ label: 'Open the URL', icon: ExternalLink, command: () => window.open(url, '_blank', 'noopener') }] : []),
    { label: 'Open details', icon: Layers, command: () => router.push(`/environments/${environment.id}`) },
    { label: 'Logs', icon: ScrollText, command: () => router.push({ path: `/environments/${environment.id}`, query: { tab: 'logs' } }) },
  ];
  if (!canManage(authStore.user, environment)) {
    return items;
  }
  const busy = isBusy(environment.status);
  const actions: MenuAction[] = [];
  if (redeployRequest(environment) && !busy) {
    actions.push({ label: 'Redeploy', icon: RefreshCw, hint: 'latest commits', command: () => redeploy(environment) });
  }
  if (environment.status === 'sleeping') {
    actions.push({ label: 'Wake up', icon: Sun, command: () => act(environment, 'wake') });
  }
  if (['ready', 'degraded'].includes(environment.status)) {
    actions.push({ label: 'Sleep now', icon: Moon, hint: 'frees its memory', command: () => act(environment, 'sleep') });
  }
  if (environment.status === 'ready') {
    actions.push({ label: 'Stop', icon: Square, command: () => act(environment, 'stop') });
  }
  if (environment.status === 'stopped') {
    actions.push({ label: 'Start', icon: Play, command: () => act(environment, 'start') });
  }
  return [
    ...items,
    ...(actions.length ? [{ separator: true }, ...actions] : []),
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, disabled: environment.status === 'deleting', command: () => confirmRemove(environment) },
  ];
});

function openMenu(event: Event, environment: Environment) {
  menuFor.value = environment;
  rowMenu.value?.toggle(event);
}

async function load() {
  try {
    [environments.value, projects.value, deleted.value] = await Promise.all([
      environmentsApi.list(),
      projectsApi.list(),
      environmentsApi.list({ deleted: true }).catch(() => []),
    ]);
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

/** The command palette asks for a new environment with ?new=1. */
watch(
  () => route.query.new,
  (value) => {
    if (value === '1') {
      creating.value = true;
      router.replace({ query: { ...route.query, new: undefined } });
    }
  },
  { immediate: true },
);

function created(result: JobAccepted) {
  showSuccess(`${result.environment.slug} is being created`);
  router.push(`/environments/${result.environment.id}`);
}

function replace(result: { environment: Environment }) {
  environments.value = environments.value.map((environment) => (environment.id === result.environment.id ? result.environment : environment));
}

async function act(environment: Environment, action: 'stop' | 'start' | 'wake' | 'sleep') {
  try {
    replace(await environmentsApi[action](environment.id));
  } catch (err) {
    showError(errorMessage(err, `${environment.slug} could not ${action}`));
  }
}

async function redeploy(environment: Environment) {
  const deploy = redeployRequest(environment);
  if (!deploy) {
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
  confirmDelete(
    environment.slug,
    async () => {
      try {
        replace(await environmentsApi.remove(environment.id));
        showSuccess(`${environment.slug} is being deleted`);
      } catch (err) {
        showError(errorMessage(err, `${environment.slug} could not be deleted`));
      }
    },
    'Its containers, volumes and data are removed for good; its timeline and last logs stay readable for 7 days.',
  );
}

onMounted(() => {
  load();
  timer = setInterval(() => {
    Promise.all([environmentsApi.list(), environmentsApi.list({ deleted: true })])
      .then(([live, gone]) => {
        environments.value = live;
        deleted.value = gone;
      })
      .catch(() => undefined);
  }, REFRESH_MS);
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
  }
});
</script>
