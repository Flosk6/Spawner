<template>
  <div v-if="!project && !loadError" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <div v-else-if="loadError" class="alert tone-danger">
    <CircleX />
    <div class="alert-body"><span class="alert-title">{{ loadError }}</span></div>
    <div class="alert-actions"><RouterLink to="/projects" class="btn btn-secondary btn-sm">Back to the projects</RouterLink></div>
  </div>

  <template v-else-if="project">
    <div class="page-head">
      <div class="flex min-w-0 items-center gap-3">
        <span class="project-icon" aria-hidden="true">{{ initial }}</span>
        <div class="min-w-0">
          <h1 class="page-title break-words">{{ project.name }}</h1>
          <p class="page-lead break-all font-mono text-sm">{{ project.repoUrl }}</p>
        </div>
      </div>
      <div class="page-actions">
        <RouterLink :to="{ path: '/environments', query: { project: project.slug } }" class="btn btn-secondary"><Layers />Environments</RouterLink>
        <button v-if="authStore.isAdmin" type="button" class="btn btn-secondary" @click="editing = true"><Pencil />Edit</button>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <span class="badge" v-tooltip.top="'Default branch'"><GitBranch /><span class="font-mono">{{ project.defaultRef }}</span></span>
      <span v-if="project.rootDir !== '.'" class="badge">
        <Folder /><span><span class="font-mono">.spawner/</span> in <span class="font-mono">{{ project.rootDir }}</span></span>
      </span>
      <span v-if="project.allowPublic" class="badge tone-warn" v-tooltip.top="'Exposures with auth: none open without a login'"><Globe />Public URLs allowed</span>
      <span v-else class="badge" v-tooltip.top="'auth: none is refused'"><Lock />URLs need a login</span>
      <span v-if="project.allowAlwaysOn" class="badge" v-tooltip.top="'Environments with idle: never stay awake'"><Sun />Environments may never sleep</span>
      <span v-else class="badge" v-tooltip.top="'idle: never is refused'"><Moon />Environments sleep when idle</span>
      <span v-if="project.sourceRepos?.length" class="badge" v-tooltip.top="project.sourceRepos.join(', ')">
        <FolderGit2 />{{ project.sourceRepos.length }} source {{ project.sourceRepos.length === 1 ? 'repository' : 'repositories' }}
      </span>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <section class="card stat">
        <span class="stat-label"><Layers />Environments</span>
        <span class="stat-value">{{ usage?.environments.total ?? '-' }}</span>
        <template v-if="statuses.length">
          <div class="bar" aria-hidden="true">
            <span v-for="item in statuses" :key="item.status" class="bar-fill" :class="item.fill" :style="{ width: `${item.share}%` }"></span>
          </div>
          <div class="legend">
            <span v-for="item in statuses" :key="item.status" class="legend-item">
              <span class="dot" :class="`tone-${item.tone}`"></span><b>{{ item.count }}</b>{{ item.status }}
            </span>
          </div>
        </template>
        <span class="stat-meta">Now: {{ formatSize(usage?.now.memoryBytes) }} of memory, {{ formatSize(usage?.now.diskBytes) }} of disk</span>
      </section>

      <section class="card stat">
        <span class="stat-label"><Calculator />One environment</span>
        <dl v-if="usage" class="kv">
          <dt>Memory</dt>
          <dd>{{ formatSize(usage.typical.memoryBytes) }}<span v-if="usage.typical.basedOn.memory === 'limits'" class="text-fg-3"> (limit)</span></dd>
          <dt>Disk</dt>
          <dd>{{ formatSize(usage.typical.diskBytes) }}<span v-if="usage.typical.basedOn.disk === 'default'" class="text-fg-3"> (estimate)</span></dd>
          <dt>Build</dt>
          <dd>{{ formatSeconds(usage.typical.buildSeconds) }}</dd>
        </dl>
        <span v-else class="stat-value">-</span>
        <p class="stat-meta">Medians over the environments of the project: memory of the last day, disk of the last measure, builds of the last 30 days.</p>
      </section>

      <section class="card stat">
        <span class="stat-label"><Server />Capacity</span>
        <span class="stat-value" :class="{ 'text-danger-text': places === 0 }">{{ places ?? '-' }}<small v-if="places !== null">more</small></span>
        <span v-if="limitNote" class="stat-meta text-fg-2">{{ limitNote }}</span>
        <p class="stat-meta">Environments of the project the server can still build and hold, keeping 1 GiB of memory and 10 GiB of disk free.</p>
      </section>
    </div>

    <section v-if="authStore.isAdmin" class="card">
      <div class="card-head" :class="{ 'is-flush': variables.length > 0 }">
        <div class="card-title"><KeyRound />Variables<span v-if="variables.length" class="count">{{ variables.length }}</span></div>
        <button type="button" class="btn btn-secondary btn-sm" @click="editVariable(null)"><Plus />Add a variable</button>
      </div>
      <div v-if="variables.length" class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Value</th>
              <th class="hidden md:table-cell">Updated</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="variable in variables" :key="variable.name">
              <td class="font-mono text-sm font-medium text-fg">
                {{ variable.name }}
                <div class="font-sans text-xs font-normal text-fg-3 md:hidden">updated {{ timeAgo(variable.updatedAt) }}</div>
              </td>
              <td class="max-w-[28rem]">
                <span v-if="variable.secret" class="badge badge-sm"><Lock />secret</span>
                <span v-else class="line-clamp-2 break-all font-mono text-sm text-fg-2" :title="variable.value ?? undefined">{{ variable.value }}</span>
              </td>
              <td class="hidden whitespace-nowrap text-fg-3 md:table-cell">{{ timeAgo(variable.updatedAt) }}</td>
              <td class="cell-actions">
                <div class="flex justify-end gap-0.5">
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm btn-icon"
                    :aria-label="`Change ${variable.name}`"
                    v-tooltip.top="'Change'"
                    @click="editVariable(variable)"
                  >
                    <Pencil />
                  </button>
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm btn-icon"
                    :aria-label="`Delete ${variable.name}`"
                    v-tooltip.top="'Delete'"
                    @click="removeVariable(variable.name)"
                  >
                    <Trash2 />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty">No variable yet.</div>
      <div class="card-foot items-start">
        <Info class="mt-0.5 size-3.5" />
        <span>
          The compose files of the project use them as <code>${NAME}</code>, wired into <code>environment:</code> or <code>args:</code>. Secret values are
          stored encrypted, never shown again, and masked in job logs.
        </span>
      </div>
    </section>
  </template>

  <Dialog
    v-model:visible="variableOpen"
    :header="editedVariable ? `Change ${editedVariable.name}` : 'New variable'"
    modal
    :style="{ width: 'min(30rem, calc(100vw - 2rem))' }"
  >
    <form id="variable-form" class="flex flex-col gap-4" @submit.prevent="saveVariable">
      <div class="field">
        <label class="field-label" for="variable-name">Name</label>
        <input
          id="variable-name"
          v-model="draft.name"
          class="input font-mono"
          placeholder="STRIPE_KEY"
          autocomplete="off"
          spellcheck="false"
          :disabled="editedVariable !== null"
        />
        <p v-if="!editedVariable" class="field-hint">Uppercase letters, digits and underscores, not starting with a digit or <code>SPAWNER_</code>.</p>
      </div>
      <div class="field">
        <label class="field-label" for="variable-value">Value</label>
        <input id="variable-value" v-model="draft.value" class="input font-mono" :type="draft.secret ? 'password' : 'text'" autocomplete="off" spellcheck="false" />
        <p v-if="editedVariable?.secret" class="field-hint">Its value is never shown again: type the new one.</p>
      </div>
      <div class="flex items-start gap-3">
        <Checkbox v-model="draft.secret" binary input-id="variable-secret" />
        <div class="flex flex-col gap-0.5">
          <label class="field-label" for="variable-secret">Secret</label>
          <p class="field-hint">Stored encrypted, never shown again, and masked in job logs.</p>
        </div>
      </div>
      <div v-if="variableError" class="alert tone-danger">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ variableError }}</span></div>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="variableOpen = false">Cancel</button>
      <button type="submit" form="variable-form" class="btn btn-primary" :disabled="!draft.name.trim() || savingVariable">
        <LoaderCircle v-if="savingVariable" class="spinner" />Save
      </button>
    </template>
  </Dialog>

  <ProjectDialog v-model:visible="editing" :project="project" @saved="load" />
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Checkbox from 'primevue/checkbox';
import Dialog from 'primevue/dialog';
import { Calculator, CircleX, Folder, FolderGit2, GitBranch, Globe, Info, KeyRound, Layers, LoaderCircle, Lock, Moon, Pencil, Plus, Server, Sun, Trash2 } from 'lucide-vue-next';
import ProjectDialog from '../components/ProjectDialog.vue';
import { setBreadcrumbs } from '../composables/useBreadcrumbs';
import { useNotification } from '../composables/useNotification';
import { errorMessage, projectsApi, systemApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { Capacity, EnvironmentStatus, ProjectDetail, ProjectUsage, ProjectVariable } from '../types';
import { STATUS_TONES, statusTone, type Tone } from '../utils/environment';
import { timeAgo } from '../utils/format';
import { formatSeconds, formatSize } from '../utils/palette';

/** The order of the status filters of the environment list. */
const TONE_ORDER: Tone[] = ['ok', 'warn', 'sleep', 'info', 'muted', 'danger'];

/** The bar color of each tone, written out whole so that Tailwind generates it. */
const TONE_FILLS: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  sleep: 'bg-sleep',
  muted: 'bg-muted',
  accent: 'bg-accent',
};

const LIMITED_BY = {
  memory: 'Limited by the memory of the server.',
  disk: 'Limited by the disk of the server.',
  quota: 'Limited by your quota of environments.',
} as const;

const route = useRoute();
const authStore = useAuthStore();
const { showError, showSuccess, confirmDelete } = useNotification();

const project = ref<ProjectDetail | null>(null);
const usage = ref<ProjectUsage | null>(null);
const capacity = ref<Capacity | null>(null);
const variables = ref<ProjectVariable[]>([]);
const loadError = ref('');
const editing = ref(false);
const variableOpen = ref(false);
const editedVariable = ref<ProjectVariable | null>(null);
const variableError = ref('');
const savingVariable = ref(false);
const draft = reactive({ name: '', value: '', secret: false });

const slug = computed(() => route.params.slug as string);
const capacityEntry = computed(() => capacity.value?.projects.find((entry) => entry.project === slug.value) ?? null);
const places = computed(() => capacityEntry.value?.places ?? null);
const limitNote = computed(() => (capacityEntry.value?.limitedBy ? LIMITED_BY[capacityEntry.value.limitedBy] : ''));
const initial = computed(() => (project.value?.name || project.value?.slug || '').charAt(0).toUpperCase());

/** The live environments by status, in the order of the environment list, with their share of the bar. */
const statuses = computed(() => {
  const total = usage.value?.environments.total ?? 0;
  return Object.entries(usage.value?.environments.byStatus ?? {})
    .map(([status, count]) => {
      const tone = STATUS_TONES[statusTone(status as EnvironmentStatus)];
      return { status, count, tone, fill: TONE_FILLS[tone], share: total ? (count / total) * 100 : 0 };
    })
    .sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone));
});

async function load() {
  try {
    project.value = await projectsApi.get(slug.value);
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err, 'The project could not be loaded');
    return;
  }
  [usage.value, capacity.value, variables.value] = await Promise.all([
    projectsApi.usage(slug.value).catch(() => null),
    systemApi.capacity().catch(() => null),
    authStore.isAdmin ? projectsApi.variables(slug.value).catch(() => []) : Promise.resolve([]),
  ]);
}

/** Opens the variable dialog on a new variable, or on one to change: a secret value is never shown again. */
function editVariable(variable: ProjectVariable | null) {
  Object.assign(draft, {
    name: variable?.name ?? '',
    value: variable && !variable.secret ? (variable.value ?? '') : '',
    secret: variable?.secret ?? false,
  });
  editedVariable.value = variable;
  variableError.value = '';
  variableOpen.value = true;
}

async function saveVariable() {
  const name = draft.name.trim();
  savingVariable.value = true;
  variableError.value = '';
  try {
    await projectsApi.setVariable(slug.value, name, draft.value, draft.secret);
  } catch (err) {
    variableError.value = errorMessage(err, 'The variable could not be saved');
    return;
  } finally {
    savingVariable.value = false;
  }
  variableOpen.value = false;
  showSuccess(`${name} saved: it applies from the next deploy`);
  variables.value = await projectsApi.variables(slug.value).catch(() => variables.value);
}

function removeVariable(name: string) {
  confirmDelete(
    name,
    async () => {
      try {
        await projectsApi.deleteVariable(slug.value, name);
        variables.value = await projectsApi.variables(slug.value);
      } catch (err) {
        showError(errorMessage(err, 'The variable could not be deleted'));
      }
    },
    'Compose files that use it are refused at their next deploy.',
  );
}

watch(project, (value) => {
  if (value) {
    setBreadcrumbs([{ label: 'Projects', to: '/projects' }, { label: value.name }]);
  }
});

watch(slug, load);
onMounted(load);
</script>
