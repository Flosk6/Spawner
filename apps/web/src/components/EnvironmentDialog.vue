<template>
  <Dialog :visible="visible" header="New environment" modal :style="{ width: 'min(36rem, calc(100vw - 2rem))' }" @update:visible="$emit('update:visible', $event)">
    <form id="new-environment" class="flex flex-col gap-4" @submit.prevent="submit">
      <p class="-mt-1 text-sm text-fg-3">A copy of a project at a branch, with its own URL.</p>

      <div class="field">
        <label class="field-label" for="env-project">Project</label>
        <Select id="env-project" v-model="form.project" :options="projects" option-label="name" option-value="slug" placeholder="Choose a project" class="w-full" />
      </div>

      <template v-if="form.project">
        <div class="field">
          <label class="field-label" for="env-ref">{{ manifest?.name ?? 'app' }} <span class="font-normal text-fg-3">this repository</span></label>
          <div class="input-wrap">
            <GitBranch />
            <input
              id="env-ref"
              v-model="form.ref"
              class="input font-mono"
              list="env-branches-primary"
              :placeholder="selectedProject?.defaultRef ?? 'main'"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <datalist id="env-branches-primary">
            <option v-for="branch in branches.primary ?? []" :key="branch" :value="branch" />
          </datalist>
          <p class="field-hint">Branch, tag or commit; empty for {{ selectedProject?.defaultRef ?? 'the default branch' }}.</p>
        </div>

        <div v-for="source in manifest?.sources ?? []" :key="source.name" class="field">
          <label class="field-label" :for="`env-ref-${source.name}`">{{ source.name }} <span class="font-mono text-xs font-normal text-fg-3">{{ source.repo }}</span></label>
          <div class="input-wrap">
            <GitBranch />
            <input
              :id="`env-ref-${source.name}`"
              v-model="form.sources[source.name]"
              class="input font-mono"
              :list="`env-branches-${source.name}`"
              :placeholder="source.defaultRef"
              autocomplete="off"
              spellcheck="false"
              @focus="loadBranches(source.name)"
            />
          </div>
          <datalist :id="`env-branches-${source.name}`">
            <option v-for="branch in branches[source.name] ?? []" :key="branch" :value="branch" />
          </datalist>
        </div>

        <div v-if="manifestError" class="alert tone-warn">
          <TriangleAlert />
          <div class="alert-body"><span class="alert-text">{{ manifestError }} The environment can still start from the default branches.</span></div>
        </div>
        <p v-else-if="loadingManifest" class="field-hint">Reading spawner.yaml...</p>
      </template>

      <div class="field">
        <label class="field-label" for="env-name">Name</label>
        <input id="env-name" v-model="form.env" class="input font-mono" placeholder="feat-login" autocomplete="off" spellcheck="false" @input="nameEdited = true" />
        <p v-if="form.env && !nameValid" class="field-error">Lowercase letters, digits and dashes, {{ ENV_SLUG_MAX_LENGTH }} characters at most.</p>
        <p v-else-if="previewUrl" class="field-hint flex min-w-0 items-center gap-1.5">
          <Globe class="size-3.5 flex-none" /><span class="truncate font-mono text-fg-2">{{ previewUrl }}</span>
        </p>
        <p v-else class="field-hint">Lowercase letters, digits and dashes, {{ ENV_SLUG_MAX_LENGTH }} characters at most. It is part of the URL.</p>
      </div>

      <div v-if="error" class="alert tone-danger">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
      </div>
    </form>

    <template #footer>
      <p class="mr-auto hidden text-sm text-fg-3 sm:block">From a worktree, uncommitted changes included: <code>spawner up</code></p>
      <button type="button" class="btn btn-ghost" @click="$emit('update:visible', false)">Cancel</button>
      <button type="submit" form="new-environment" class="btn btn-primary" :disabled="!form.project || !nameValid || saving">
        <LoaderCircle v-if="saving" class="spinner" /><Plus v-else />Create environment
      </button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import { CircleX, GitBranch, Globe, LoaderCircle, Plus, TriangleAlert } from 'lucide-vue-next';
import { useServerInfo } from '../composables/useServerInfo';
import { environmentsApi, errorMessage, projectsApi } from '../services/api';
import type { JobAccepted, ProjectManifest, ProjectSummary } from '../types';
import { ENV_SLUG_MAX_LENGTH, ENV_SLUG_PATTERN, suggestEnvSlug } from '../utils/environment';

const props = defineProps<{ visible: boolean; projects: ProjectSummary[]; project?: string }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean]; created: [accepted: JobAccepted] }>();

const info = useServerInfo();
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

/** The URL of the entrypoint the environment will get, as the server names it. */
const previewUrl = computed(() =>
  info.value && form.project && nameValid.value ? `${info.value.scheme}://${form.env}--${form.project}.${info.value.previewDomain}` : '',
);

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
    const sources = Object.fromEntries(
      Object.entries(form.sources)
        .map(([name, ref]) => [name, ref.trim()])
        .filter(([, ref]) => ref),
    );
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
