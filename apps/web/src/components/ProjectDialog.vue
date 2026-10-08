<template>
  <Dialog
    :visible="visible"
    :header="project ? `Edit ${project.slug}` : 'New project'"
    modal
    :style="{ width: 'min(36rem, calc(100vw - 2rem))' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <form id="project-form" class="flex flex-col gap-4" @submit.prevent="submit">
      <p v-if="!project" class="-mt-1 text-sm text-fg-3">A repository holding a <code>.spawner/</code> directory: a manifest and a compose file.</p>

      <div class="field">
        <label class="field-label" for="project-name">Name</label>
        <input id="project-name" v-model="form.name" class="input" placeholder="Blog" autocomplete="off" />
      </div>

      <div v-if="!project" class="field">
        <label class="field-label" for="project-slug">Slug</label>
        <input id="project-slug" v-model="form.slug" class="input font-mono" placeholder="blog" autocomplete="off" spellcheck="false" @input="slugEdited = true" />
        <p :class="form.slug && !slugValid ? 'field-error' : 'field-hint'">
          Lowercase letters, digits and dashes, {{ PROJECT_SLUG_MAX_LENGTH }} characters at most. It must match <code>project</code> in
          <code>.spawner/spawner.yaml</code> and appears in every URL.
        </p>
      </div>

      <div class="field">
        <label class="field-label" for="project-repo">Repository</label>
        <div class="flex gap-2">
          <div class="input-wrap flex-1">
            <FolderGit2 />
            <input
              id="project-repo"
              v-model="form.repoUrl"
              class="input font-mono"
              placeholder="git@github.com:acme/blog.git"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <button type="button" class="btn btn-secondary" :disabled="!form.repoUrl || testing" @click="testAccess">
            <LoaderCircle v-if="testing" class="spinner" />Test
          </button>
        </div>
        <p v-if="access" class="flex items-start gap-1.5" :class="access.ok ? 'field-hint text-ok-text' : 'field-error'">
          <CircleCheck v-if="access.ok" class="mt-0.5 size-3.5" /><CircleX v-else class="mt-0.5 size-3.5" /><span>{{ access.message }}</span>
        </p>
        <p v-else class="field-hint">SSH repositories need a deploy key, see <RouterLink to="/system/settings/git" class="link">Git keys</RouterLink>.</p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="field">
          <label class="field-label" for="project-ref">Default branch</label>
          <div class="input-wrap">
            <GitBranch />
            <input id="project-ref" v-model="form.defaultRef" class="input font-mono" placeholder="main" autocomplete="off" spellcheck="false" />
          </div>
          <p class="field-hint">Deployed when an environment names no branch.</p>
        </div>
        <div class="field">
          <label class="field-label" for="project-root">Directory</label>
          <input id="project-root" v-model="form.rootDir" class="input font-mono" placeholder="." autocomplete="off" spellcheck="false" />
          <p class="field-hint">Where <code>.spawner/</code> is, for monorepos.</p>
        </div>
      </div>

      <div class="divide-y rounded-lg border">
        <div class="flex items-start gap-4 p-3">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="field-label leading-6" for="project-public">Allow public URLs</label>
            <p class="field-hint">
              Exposures with <code>auth: none</code> in spawner.yaml open without a login (webhooks, public pages). Otherwise every URL needs one.
            </p>
          </div>
          <ToggleSwitch v-model="form.allowPublic" input-id="project-public" />
        </div>
        <div class="flex items-start gap-4 p-3">
          <div class="flex min-w-0 flex-1 flex-col gap-1">
            <label class="field-label leading-6" for="project-always-on">Allow environments that never sleep</label>
            <p class="field-hint">
              With <code>idle: never</code> in spawner.yaml, an environment keeps its memory even when nobody uses it. Otherwise it sleeps after a while
              without visits.
            </p>
          </div>
          <ToggleSwitch v-model="form.allowAlwaysOn" input-id="project-always-on" />
        </div>
      </div>

      <div v-if="error" class="alert tone-danger">
        <CircleX />
        <div class="alert-body"><span class="alert-text">{{ error }}</span></div>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn btn-ghost" @click="$emit('update:visible', false)">Cancel</button>
      <button type="submit" form="project-form" class="btn btn-primary" :disabled="!canSubmit || saving">
        <LoaderCircle v-if="saving" class="spinner" /><Plus v-else-if="!project" />{{ project ? 'Save' : 'Create project' }}
      </button>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import ToggleSwitch from 'primevue/toggleswitch';
import { CircleCheck, CircleX, FolderGit2, GitBranch, LoaderCircle, Plus } from 'lucide-vue-next';
import { errorMessage, gitApi, projectsApi } from '../services/api';
import type { GitTestResult, Project } from '../types';
import { PROJECT_SLUG_MAX_LENGTH, PROJECT_SLUG_PATTERN } from '../utils/environment';

const props = defineProps<{ visible: boolean; project?: Project | null }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean]; saved: [project: Project] }>();

const form = reactive({ name: '', slug: '', repoUrl: '', defaultRef: 'main', rootDir: '.', allowPublic: false, allowAlwaysOn: false });
const slugEdited = ref(false);
const saving = ref(false);
const testing = ref(false);
const access = ref<GitTestResult | null>(null);
const error = ref('');

const slugValid = computed(() => PROJECT_SLUG_PATTERN.test(form.slug) && form.slug.length <= PROJECT_SLUG_MAX_LENGTH);
const canSubmit = computed(() => form.name.trim() && form.repoUrl.trim() && (props.project || slugValid.value));

watch(
  () => props.visible,
  (visible) => {
    if (!visible) {
      return;
    }
    const project = props.project;
    Object.assign(form, {
      name: project?.name ?? '',
      slug: project?.slug ?? '',
      repoUrl: project?.repoUrl ?? '',
      defaultRef: project?.defaultRef ?? 'main',
      rootDir: project?.rootDir ?? '.',
      allowPublic: project?.allowPublic ?? false,
      allowAlwaysOn: project?.allowAlwaysOn ?? false,
    });
    slugEdited.value = false;
    access.value = null;
    error.value = '';
  },
);

// Suggest the slug from the name until it is typed.
watch(
  () => form.name,
  (name) => {
    if (!props.project && !slugEdited.value) {
      form.slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^[^a-z]+|-+$/g, '')
        .slice(0, PROJECT_SLUG_MAX_LENGTH)
        .replace(/-+$/, '');
    }
  },
);

watch(
  () => form.repoUrl,
  () => (access.value = null),
);

async function testAccess() {
  testing.value = true;
  try {
    access.value = await gitApi.testConnection(form.repoUrl.trim());
  } catch (err) {
    access.value = { ok: false, message: errorMessage(err, 'The test failed') };
  } finally {
    testing.value = false;
  }
}

async function submit() {
  saving.value = true;
  error.value = '';
  const input = {
    name: form.name.trim(),
    repoUrl: form.repoUrl.trim(),
    defaultRef: form.defaultRef.trim() || 'main',
    rootDir: form.rootDir.trim() || '.',
    allowPublic: form.allowPublic,
    allowAlwaysOn: form.allowAlwaysOn,
  };
  try {
    const saved = props.project ? await projectsApi.update(props.project.slug, input) : await projectsApi.create({ ...input, slug: form.slug });
    emit('saved', saved);
    emit('update:visible', false);
  } catch (err) {
    error.value = errorMessage(err, 'The project could not be saved');
  } finally {
    saving.value = false;
  }
}
</script>
