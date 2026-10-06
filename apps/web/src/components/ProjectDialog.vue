<template>
  <Dialog
    :visible="visible"
    :header="project ? `Edit ${project.slug}` : 'New project'"
    modal
    :style="{ width: '560px' }"
    @update:visible="$emit('update:visible', $event)"
  >
    <form class="space-y-5" @submit.prevent="submit">
      <div>
        <label class="field-label" for="project-name">Name</label>
        <InputText id="project-name" v-model="form.name" class="w-full" placeholder="Blog" />
      </div>

      <div v-if="!project">
        <label class="field-label" for="project-slug">Slug</label>
        <InputText id="project-slug" v-model="form.slug" class="w-full font-mono" placeholder="blog" @input="slugEdited = true" />
        <p class="field-hint" :class="{ 'text-red-500': form.slug && !slugValid }">
          Lowercase letters, digits and dashes, {{ PROJECT_SLUG_MAX_LENGTH }} characters at most. It must match <code>name</code> in
          <code>.spawner/spawner.yaml</code> and appears in every URL.
        </p>
      </div>

      <div>
        <label class="field-label" for="project-repo">Repository</label>
        <div class="flex gap-2">
          <InputText id="project-repo" v-model="form.repoUrl" class="flex-1 font-mono" placeholder="git@github.com:acme/blog.git" />
          <Button type="button" label="Test" severity="secondary" outlined :loading="testing" :disabled="!form.repoUrl" @click="testAccess" />
        </div>
        <p v-if="access" class="field-hint" :class="access.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'">{{ access.message }}</p>
        <p v-else class="field-hint">
          SSH repositories need a deploy key, see
          <router-link to="/system/settings/git" class="underline">Git keys</router-link>.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="field-label" for="project-ref">Default branch</label>
          <InputText id="project-ref" v-model="form.defaultRef" class="w-full font-mono" placeholder="main" />
        </div>
        <div>
          <label class="field-label" for="project-root">Directory</label>
          <InputText id="project-root" v-model="form.rootDir" class="w-full font-mono" placeholder="." />
          <p class="field-hint">Where <code>.spawner/</code> is, for monorepos.</p>
        </div>
      </div>

      <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>

      <div class="flex justify-end gap-2 pt-2">
        <Button type="button" label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
        <Button type="submit" :label="project ? 'Save' : 'Create'" :loading="saving" :disabled="!canSubmit" />
      </div>
    </form>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { errorMessage, gitApi, projectsApi } from '../services/api';
import type { GitTestResult, Project } from '../types';
import { PROJECT_SLUG_MAX_LENGTH, PROJECT_SLUG_PATTERN } from '../utils/environment';

const props = defineProps<{ visible: boolean; project?: Project | null }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean]; saved: [project: Project] }>();

const form = reactive({ name: '', slug: '', repoUrl: '', defaultRef: 'main', rootDir: '.' });
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

