<template>
  <div class="flex flex-col h-[calc(100vh-5rem)]">
    <!-- Sticky Header -->
    <div class="sticky top-0 z-10 bg-slate-50 dark:bg-dark-900/95 border-b border-slate-200 dark:border-purple-900/30 px-6 py-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-4">
          <Button
            icon="pi pi-arrow-left"
            text
            rounded
            @click="$router.push('/projects')"
            v-tooltip.bottom="'Back to Projects'"
          />
          <div>
            <h1 class="text-2xl font-bold text-slate-900 dark:text-white">
              {{ isEdit ? 'Edit Project' : 'New Project' }}
            </h1>
            <p class="text-sm text-slate-600 dark:text-slate-400">
              {{ isEdit ? 'Update your project configuration' : 'Create a new project to manage your environments' }}
            </p>
          </div>
        </div>

        <div class="flex gap-3">
          <Button
            label="Cancel"
            severity="secondary"
            outlined
            @click="$router.push('/projects')"
          />
          <Button
            :label="saving ? 'Saving...' : (isEdit ? 'Update' : 'Create')"
            :loading="saving"
            icon="pi pi-save"
            @click="saveProject"
          />
        </div>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="flex-1 overflow-y-auto px-6 py-6">
      <Card class="max-w-2xl mx-auto">
        <template #title>
          <div class="flex items-center gap-2">
            <i class="pi pi-info-circle text-blue-500"></i>
            <span>Project Information</span>
          </div>
        </template>
        <template #content>
          <div class="flex flex-col gap-6">
            <!-- Project Name -->
            <div class="flex flex-col gap-2">
              <label for="projectName" class="font-semibold text-slate-700 dark:text-slate-300">
                Project Name <span class="text-red-500">*</span>
              </label>
              <InputText
                id="projectName"
                v-model="form.name"
                placeholder="my-project"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">
                A unique identifier for your project (lowercase, numbers, and hyphens only)
              </small>
            </div>

            <!-- Base Domain -->
            <div class="flex flex-col gap-2">
              <label for="baseDomain" class="font-semibold text-slate-700 dark:text-slate-300">
                Base Domain <span class="text-red-500">*</span>
              </label>
              <InputText
                id="baseDomain"
                v-model="form.baseDomain"
                placeholder="preview.yourdomain.com"
                class="w-full"
              />
              <small class="text-slate-600 dark:text-slate-400">
                The base domain for all preview environments. Example: feature-123.preview.yourdomain.com
              </small>
            </div>
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import Button from 'primevue/button';
import Card from 'primevue/card';
import InputText from 'primevue/inputtext';
import { useNotification } from '../composables/useNotification';

const route = useRoute();
const router = useRouter();
const { showSuccess, showError } = useNotification();

const isEdit = computed(() => !!route.params.id);

const form = ref({
  name: '',
  baseDomain: '',
});

const saving = ref(false);

async function loadProject() {
  if (!isEdit.value) return;

  try {
    const response = await axios.get(`/api/projects/${route.params.id}`);
    form.value.name = response.data.name;
    form.value.baseDomain = response.data.baseDomain;
  } catch (error) {
    console.error('Error loading project:', error);
    showError('Failed to load project');
    router.push('/projects');
  }
}

async function saveProject() {
  if (!form.value.name || !form.value.baseDomain) {
    showError('Please fill in all fields');
    return;
  }

  try {
    saving.value = true;

    if (isEdit.value) {
      await axios.put(`/api/projects/${route.params.id}`, form.value);
      showSuccess('Project updated successfully');
      router.push(`/projects/${route.params.id}`);
    } else {
      const response = await axios.post('/api/projects', form.value);
      showSuccess('Project created successfully');
      router.push(`/projects/${response.data.id}`);
    }
  } catch (error: any) {
    console.error('Error saving project:', error);
    showError(error.response?.data?.message || 'Failed to save project');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadProject();
});
</script>
