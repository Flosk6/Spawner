<template>
  <Dialog :visible="visible" header="New environment" modal :style="{ width: '600px' }" @update:visible="$emit('update:visible', $event)">
    <form class="space-y-5" @submit.prevent="submit">
      <div>
        <label class="field-label" for="env-project">Project</label>
        <Select
          id="env-project"
          v-model="form.project"
          :options="projects"
          option-label="name"
          option-value="slug"
          placeholder="Choose a project"
          class="w-full"
        />
      </div>

      <template v-if="form.project">
        <div>
          <label class="field-label" for="env-ref">{{ manifest?.name ?? 'Project' }} <span class="font-normal text-slate-500">(this repository)</span></label>
          <InputText
            id="env-ref"
            v-model="form.ref"
            class="w-full font-mono"
            list="env-branches-primary"
            :placeholder="selectedProject?.defaultRef ?? 'main'"
            autocomplete="off"
          />
          <datalist id="env-branches-primary">
            <option v-for="branch in branches.primary ?? []" :key="branch" :value="branch" />
          </datalist>
          <p class="field-hint">Branch, tag or commit; empty for {{ selectedProject?.defaultRef ?? 'the default branch' }}.</p>
        </div>

        <div v-for="source in manifest?.sources ?? []" :key="source.name">
          <label class="field-label" :for="`env-ref-${source.name}`">{{ source.name }} <span class="font-normal text-slate-500 font-mono text-xs">{{ source.repo }}</span></label>
          <InputText
            :id="`env-ref-${source.name}`"
            v-model="form.sources[source.name]"
            class="w-full font-mono"
            :list="`env-branches-${source.name}`"
            :placeholder="source.defaultRef"
            autocomplete="off"
            @focus="loadBranches(source.name)"
          />
          <datalist :id="`env-branches-${source.name}`">
            <option v-for="branch in branches[source.name] ?? []" :key="branch" :value="branch" />
          </datalist>
        </div>

        <Message v-if="manifestError" severity="warn" :closable="false">
          {{ manifestError }} The environment can still start from the default branches.
        </Message>
        <p v-else-if="loadingManifest" class="field-hint">Reading spawner.yaml...</p>
      </template>

      <div>
        <label class="field-label" for="env-name">Name</label>
        <InputText id="env-name" v-model="form.env" class="w-full font-mono" placeholder="feat-login" @input="nameEdited = true" />
        <p class="field-hint" :class="{ 'text-red-500': form.env && !nameValid }">
          Lowercase letters, digits and dashes, {{ ENV_SLUG_MAX_LENGTH }} characters at most. It is part of the URL.
        </p>
      </div>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
        <Button type="submit" label="Create" icon="pi pi-plus" :loading="saving" :disabled="!form.project || !nameValid" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Message from 'primevue/message';
import Select from 'primevue/select';
import { environmentsApi, errorMessage, projectsApi } from '../services/api';
import type { JobAccepted, ProjectManifest, ProjectSummary } from '../types';
import { ENV_SLUG_MAX_LENGTH, ENV_SLUG_PATTERN, suggestEnvSlug } from '../utils/environment';

const props = defineProps<{ visible: boolean; projects: ProjectSummary[]; project?: string }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean]; created: [accepted: JobAccepted] }>();

const form = reactive({ project: '', ref: '', env: '', sources: {} as Record<string, string> });
const nameEdited = ref(false);
const manifest = ref<ProjectManifest | null>(null);
const manifestError = ref('');
const loadingManifest = ref(false);
const branches = reactive<Record<string, string[]>>({});
const saving = ref(false);
const error = ref('');

const selectedProject = computed(() => props.projects.find((project) => project.slug === form.project));
const nameValid = computed(() => ENV_SLUG_PATTERN.test(form.env) && form.env.length <= ENV_SLUG_MAX_LENGTH);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      Object.assign(form, { project: props.project ?? (props.projects.length === 1 ? props.projects[0].slug : ''), ref: '', env: '', sources: {} });
      nameEdited.value = false;
      error.value = '';
    }
  },
);

/**
 * Branches of a source (primary: the project repository), loaded once,
 * when its field is used. The field stays free text if the repository is
 * unreachable: the job says why.
 */
async function loadBranches(source: string) {
  if (branches[source] || !form.project) {
    return;
  }
  branches[source] = [];
  branches[source] = await projectsApi.branches(form.project, source === 'primary' ? undefined : source).catch(() => []);
}

watch(
  () => form.project,
  async (project) => {
    manifest.value = null;
    manifestError.value = '';
    Object.keys(branches).forEach((key) => delete branches[key]);
    form.sources = {};
    if (!project) {
      return;
    }
    void loadBranches('primary');
    loadingManifest.value = true;
    try {
      manifest.value = await projectsApi.manifest(project);
      if (manifest.value.issues.length > 0) {
        manifestError.value = `spawner.yaml has errors at ${manifest.value.ref}: ${manifest.value.issues[0].path} ${manifest.value.issues[0].message}.`;
      }
    } catch (err) {
      manifestError.value = errorMessage(err, 'spawner.yaml could not be read.');
    } finally {
      loadingManifest.value = false;
    }
  },
);

// Name the environment after its branch until a name is typed.
watch(
  () => [form.ref, form.project],
  () => {
    if (!nameEdited.value) {
      form.env = suggestEnvSlug(form.ref || selectedProject.value?.defaultRef || '');
    }
  },
);

async function submit() {
  saving.value = true;
  error.value = '';
  try {
    const sources = Object.fromEntries(Object.entries(form.sources).map(([name, ref]) => [name, ref.trim()]).filter(([, ref]) => ref));
    const accepted = await environmentsApi.create(form.project, form.env, { ref: form.ref.trim() || undefined, sources });
    emit('created', accepted);
    emit('update:visible', false);
  } catch (err) {
    error.value = errorMessage(err, 'The environment could not be created');
  } finally {
    saving.value = false;
  }
}
</script>
