<template>
  <Dialog :visible="visible" header="New environment" modal :style="{ width: '560px' }" @update:visible="$emit('update:visible', $event)">
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

      <div>
        <label class="field-label" for="env-ref">Branch, tag or commit</label>
        <InputText
          id="env-ref"
          v-model="form.ref"
          class="w-full font-mono"
          list="env-branches"
          :placeholder="selectedProject?.defaultRef ?? 'main'"
          autocomplete="off"
        />
        <datalist id="env-branches">
          <option v-for="branch in branches" :key="branch" :value="branch" />
        </datalist>
        <p class="field-hint">
          {{ loadingBranches ? 'Loading branches...' : `Empty for the default branch (${selectedProject?.defaultRef ?? 'main'}).` }}
        </p>
      </div>

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
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import InputText from 'primevue/inputtext';
import Button from 'primevue/button';
import Message from 'primevue/message';
import { environmentsApi, errorMessage, projectsApi } from '../services/api';
import type { JobAccepted, ProjectSummary } from '../types';
import { ENV_SLUG_MAX_LENGTH, ENV_SLUG_PATTERN, suggestEnvSlug } from '../utils/environment';

const props = defineProps<{ visible: boolean; projects: ProjectSummary[]; project?: string }>();
const emit = defineEmits<{ 'update:visible': [visible: boolean]; created: [accepted: JobAccepted] }>();

const form = reactive({ project: '', ref: '', env: '' });
const nameEdited = ref(false);
const branches = ref<string[]>([]);
const loadingBranches = ref(false);
const saving = ref(false);
const error = ref('');

const selectedProject = computed(() => props.projects.find((project) => project.slug === form.project));
const nameValid = computed(() => ENV_SLUG_PATTERN.test(form.env) && form.env.length <= ENV_SLUG_MAX_LENGTH);

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      Object.assign(form, { project: props.project ?? (props.projects.length === 1 ? props.projects[0].slug : ''), ref: '', env: '' });
      nameEdited.value = false;
      error.value = '';
    }
  },
);

watch(
  () => form.project,
  async () => {
    branches.value = [];
    const project = selectedProject.value?.slug;
    if (!project) {
      return;
    }
    loadingBranches.value = true;
    try {
      branches.value = await projectsApi.branches(project);
    } catch {
      // The field stays free text: an unreachable repository fails later, with its reason.
    } finally {
      loadingBranches.value = false;
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
    const accepted = await environmentsApi.create(form.project, form.env, { ref: form.ref.trim() || undefined });
    emit('created', accepted);
    emit('update:visible', false);
  } catch (err) {
    error.value = errorMessage(err, 'The environment could not be created');
  } finally {
    saving.value = false;
  }
}
</script>

