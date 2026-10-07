<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <router-link to="/projects" class="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white">
      <i class="pi pi-arrow-left text-xs"></i>Projects
    </router-link>

    <div v-if="!project && !loadError" class="flex justify-center py-20"><ProgressSpinner /></div>
    <Message v-else-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>

    <template v-else-if="project">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="text-4xl font-bold mb-2">{{ project.name }}</h1>
          <p class="text-sm text-slate-500 font-mono break-all">{{ project.repoUrl }}</p>
          <p class="text-sm text-slate-500 mt-1">
            Default branch <span class="font-mono">{{ project.defaultRef }}</span>
            <template v-if="project.rootDir !== '.'"> · <span class="font-mono">.spawner/</span> in <span class="font-mono">{{ project.rootDir }}</span></template>
            · URLs {{ project.allowPublic ? 'may be public (auth: none)' : 'always need a login' }}
            · environments {{ project.allowAlwaysOn ? 'may never sleep (idle: never)' : 'sleep when idle' }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <router-link :to="{ path: '/environments', query: { project: project.slug } }">
            <Button label="Environments" icon="pi pi-sitemap" severity="secondary" outlined />
          </router-link>
          <Button v-if="authStore.isAdmin" label="Edit" icon="pi pi-cog" severity="secondary" outlined @click="editing = true" />
        </div>
      </div>

      <!-- Usage -->
      <div class="grid gap-6 md:grid-cols-3">
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-sitemap text-sm"></i>Environments</h2>
          <p class="text-3xl font-bold">{{ usage?.environments.total ?? '-' }}</p>
          <p class="text-sm text-slate-500 mt-1">
            <template v-for="(count, status, index) in usage?.environments.byStatus ?? {}" :key="status">{{ index ? ', ' : '' }}{{ count }} {{ status }}</template>
          </p>
          <p class="text-sm text-slate-500 mt-3">Now: {{ formatSize(usage?.now.memoryBytes) }} of memory, {{ formatSize(usage?.now.diskBytes) }} of disk</p>
        </section>
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-calculator text-sm"></i>One environment</h2>
          <ul v-if="usage" class="space-y-1.5 text-sm">
            <li class="flex justify-between">
              <span>Memory</span>
              <span>{{ formatSize(usage.typical.memoryBytes) }}<span v-if="usage.typical.basedOn.memory === 'limits'" class="text-slate-500"> (limit)</span></span>
            </li>
            <li class="flex justify-between">
              <span>Disk</span>
              <span>{{ formatSize(usage.typical.diskBytes) }}<span v-if="usage.typical.basedOn.disk === 'default'" class="text-slate-500"> (estimate)</span></span>
            </li>
            <li class="flex justify-between"><span>Build</span><span>{{ formatSeconds(usage.typical.buildSeconds) }}</span></li>
          </ul>
          <p class="field-hint">Medians over the environments of the project: memory of the last day, disk of the last measure, builds of the last 30 days.</p>
        </section>
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-server text-sm"></i>Room for</h2>
          <p class="text-3xl font-bold">{{ places === null ? '-' : `${places} more` }}</p>
          <p v-if="capacityEntry?.limitedBy" class="text-sm text-slate-500 mt-1">Limited by the {{ capacityEntry.limitedBy }} of the server.</p>
          <p class="field-hint">What the server can still hold, keeping 1 GiB of memory and 10 GiB of disk free.</p>
        </section>
      </div>

      <!-- Variables -->
      <section v-if="authStore.isAdmin" class="panel">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h2 class="panel-title !mb-0"><i class="pi pi-key text-sm"></i>Variables</h2>
        </div>
        <p class="field-hint mb-4">
          The compose files of the project use them as <code>${NAME}</code>, wired into <code>environment:</code> or <code>args:</code>. Secret values are
          stored encrypted, never shown again, and masked in job logs.
        </p>
        <table v-if="variables.length" class="w-full text-sm mb-4">
          <thead class="text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="py-2 pr-4">Name</th>
              <th class="py-2 pr-4">Value</th>
              <th class="py-2 pr-4">Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
            <tr v-for="variable in variables" :key="variable.name">
              <td class="py-2 pr-4 font-mono">{{ variable.name }}</td>
              <td class="py-2 pr-4 font-mono text-xs break-all">
                <span v-if="variable.secret" class="text-slate-500"><i class="pi pi-lock text-xs mr-1"></i>secret</span>
                <span v-else>{{ variable.value }}</span>
              </td>
              <td class="py-2 pr-4 text-slate-500">{{ timeAgo(variable.updatedAt) }}</td>
              <td class="py-2 text-right whitespace-nowrap">
                <Button icon="pi pi-pencil" text rounded size="small" v-tooltip.top="'Change'" @click="editVariable(variable)" />
                <Button icon="pi pi-trash" severity="danger" text rounded size="small" v-tooltip.top="'Delete'" @click="removeVariable(variable.name)" />
              </td>
            </tr>
          </tbody>
        </table>
        <form class="grid gap-3 md:grid-cols-[12rem_1fr_auto_auto] items-end" @submit.prevent="saveVariable">
          <div>
            <label class="field-label" for="variable-name">Name</label>
            <InputText id="variable-name" v-model="draft.name" class="w-full font-mono" placeholder="STRIPE_KEY" />
          </div>
          <div>
            <label class="field-label" for="variable-value">Value</label>
            <InputText id="variable-value" v-model="draft.value" class="w-full font-mono" :type="draft.secret ? 'password' : 'text'" autocomplete="off" />
          </div>
          <label class="flex items-center gap-2 text-sm pb-2.5">
            <Checkbox v-model="draft.secret" binary input-id="variable-secret" />Secret
          </label>
          <Button type="submit" label="Save" :disabled="!draft.name.trim()" :loading="savingVariable" />
        </form>
      </section>
    </template>

    <ProjectDialog v-model:visible="editing" :project="project" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Button from 'primevue/button';
import Checkbox from 'primevue/checkbox';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import ProjectDialog from '../components/ProjectDialog.vue';
import { useNotification } from '../composables/useNotification';
import { errorMessage, projectsApi, systemApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { Capacity, ProjectDetail, ProjectUsage, ProjectVariable } from '../types';
import { timeAgo } from '../utils/format';
import { formatSeconds, formatSize } from '../utils/palette';

const route = useRoute();
const authStore = useAuthStore();
const { showError, showSuccess, confirmAction } = useNotification();

const project = ref<ProjectDetail | null>(null);
const usage = ref<ProjectUsage | null>(null);
const capacity = ref<Capacity | null>(null);
const variables = ref<ProjectVariable[]>([]);
const loadError = ref('');
const editing = ref(false);
const savingVariable = ref(false);
const draft = reactive({ name: '', value: '', secret: false });

const slug = computed(() => route.params.slug as string);
const capacityEntry = computed(() => capacity.value?.projects.find((entry) => entry.project === slug.value) ?? null);
const places = computed(() => capacityEntry.value?.places ?? null);

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

function editVariable(variable: ProjectVariable) {
  Object.assign(draft, { name: variable.name, value: variable.secret ? '' : (variable.value ?? ''), secret: variable.secret });
}

async function saveVariable() {
  savingVariable.value = true;
  try {
    await projectsApi.setVariable(slug.value, draft.name.trim(), draft.value, draft.secret);
    showSuccess(`${draft.name.trim()} saved: it applies from the next deploy`);
    Object.assign(draft, { name: '', value: '', secret: false });
    variables.value = await projectsApi.variables(slug.value);
  } catch (err) {
    showError(errorMessage(err, 'The variable could not be saved'));
  } finally {
    savingVariable.value = false;
  }
}

function removeVariable(name: string) {
  confirmAction(`Delete ${name}? Compose files that use it will be refused at their next deploy.`, async () => {
    try {
      await projectsApi.deleteVariable(slug.value, name);
      variables.value = await projectsApi.variables(slug.value);
    } catch (err) {
      showError(errorMessage(err, 'The variable could not be deleted'));
    }
  });
}

watch(slug, load);
onMounted(load);
</script>
