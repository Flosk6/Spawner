<template>
  <div class="flex flex-col h-[calc(100vh-5rem)]">
    <!-- Sticky Header -->
    <div class="sticky top-0 z-10 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 px-6 py-4">
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
      <!-- Project Info -->
      <Card class="mb-6 max-w-2xl">
        <template #title>Project Information</template>
        <template #content>
          <div class="flex flex-col gap-4">
            <div class="flex flex-col gap-2">
              <label for="projectName" class="font-semibold">Project Name</label>
              <InputText
                id="projectName"
                v-model="form.name"
                placeholder="my-project"
              />
            </div>

            <div class="flex flex-col gap-2">
              <label for="baseDomain" class="font-semibold">Base Domain</label>
              <InputText
                id="baseDomain"
                v-model="form.baseDomain"
                placeholder="preview.yourdomain.com"
              />
            </div>
          </div>
        </template>
      </Card>

    <!-- Resources Section (only if project exists) -->
    <Card v-if="projectId">
      <template #title>
        <div class="flex justify-between items-center">
          <span>Resources</span>
          <Button
            label="Add Resource"
            icon="pi pi-plus"
            @click="showResourceModal = true"
            size="small"
          />
        </div>
      </template>
      <template #content>
        <div v-if="loadingResources" class="flex justify-center py-12">
          <ProgressSpinner />
        </div>

        <div v-else-if="resources.length === 0" class="text-center py-12">
          <i class="pi pi-box text-6xl mb-6 block opacity-30"></i>
          <p class="text-xl mb-6 opacity-60">No resources yet</p>
          <Button
            label="Add your first resource"
            icon="pi pi-plus"
            @click="showResourceModal = true"
          />
        </div>

        <div v-else class="flex flex-col gap-4">
          <Card
            v-for="resource in resources"
            :key="resource.id"
          >
            <template #content>
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-3">
                    <i :class="getResourceIcon(resource.type)" class="text-2xl"></i>
                    <h3 class="font-bold text-xl">{{ resource.name }}</h3>
                    <Tag :value="resource.type" severity="info" />
                  </div>

                  <div v-if="resource.gitRepo" class="flex flex-col gap-2 opacity-70">
                    <div class="flex items-center gap-2">
                      <i class="pi pi-github"></i>
                      <span>{{ resource.gitRepo }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <i class="pi pi-code-branch"></i>
                      <span>Branch: {{ resource.defaultBranch }}</span>
                    </div>
                  </div>
                </div>

                <div class="flex gap-2">
                  <Button
                    icon="pi pi-pencil"
                    severity="secondary"
                    outlined
                    @click="editResource(resource)"
                    v-tooltip.top="'Edit resource'"
                  />
                  <Button
                    icon="pi pi-trash"
                    severity="danger"
                    outlined
                    @click="confirmDeleteResource(resource)"
                    v-tooltip.top="'Delete resource'"
                  />
                </div>
              </div>
            </template>
          </Card>
        </div>
      </template>
    </Card>

    <!-- Resource Modal -->
    <ResourceModal
      v-if="showResourceModal && projectId"
      :project-id="projectId"
      :resource="editingResource"
      :all-resources="resources"
      @close="closeResourceModal"
      @saved="handleResourceSaved"
    />

    <!-- Delete Resource Confirmation -->
    <Dialog
      v-model:visible="showDeleteDialog"
      header="Delete Resource?"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <p class="mb-4">
        Are you sure you want to delete <strong>{{ resourceToDelete?.name }}</strong>?
      </p>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          @click="showDeleteDialog = false"
        />
        <Button
          label="Delete"
          severity="danger"
          @click="deleteResource"
        />
      </template>
    </Dialog>
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
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import ProgressSpinner from 'primevue/progressspinner';
import ResourceModal from '../components/ResourceModal.vue';
import { useNotification } from '../composables/useNotification';

interface Resource {
  id: number;
  name: string;
  type: string;
  gitRepo?: string;
  defaultBranch?: string;
}

const route = useRoute();
const router = useRouter();
const { showSuccess, showError } = useNotification();

const projectId = ref<number | null>(null);
const isEdit = computed(() => !!route.params.id);

const form = ref({
  name: '',
  baseDomain: '',
});

const resources = ref<Resource[]>([]);
const saving = ref(false);
const loadingResources = ref(false);
const showResourceModal = ref(false);
const editingResource = ref<Resource | null>(null);
const resourceToDelete = ref<Resource | null>(null);
const showDeleteDialog = ref(false);

function getResourceIcon(type: string): string {
  const icons: Record<string, string> = {
    'mysql-db': 'pi pi-database',
    'laravel-api': 'pi pi-cog',
    'nextjs-front': 'pi pi-palette',
  };
  return icons[type] || 'pi pi-box';
}

async function loadProject() {
  if (!isEdit.value) return;

  try {
    const response = await axios.get(`/api/projects/${route.params.id}`);
    projectId.value = response.data.id;
    form.value.name = response.data.name;
    form.value.baseDomain = response.data.baseDomain;
    await loadResources();
  } catch (error) {
    console.error('Error loading project:', error);
    showError('Failed to load project');
    router.push('/projects');
  }
}

async function loadResources() {
  if (!projectId.value) return;

  try {
    loadingResources.value = true;
    const response = await axios.get(`/api/projects/${projectId.value}/resources`);
    resources.value = response.data;
  } catch (error) {
    console.error('Error loading resources:', error);
    showError('Failed to load resources');
  } finally {
    loadingResources.value = false;
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
      await axios.put(`/api/projects/${projectId.value}`, form.value);
      showSuccess('Project updated successfully');
    } else {
      const response = await axios.post('/api/projects', form.value);
      projectId.value = response.data.id;
      showSuccess('Project created successfully');
      router.push(`/projects/${projectId.value}`);
    }
  } catch (error: any) {
    console.error('Error saving project:', error);
    showError(error.response?.data?.message || 'Failed to save project');
  } finally {
    saving.value = false;
  }
}

function editResource(resource: Resource) {
  editingResource.value = resource;
  showResourceModal.value = true;
}

function closeResourceModal() {
  showResourceModal.value = false;
  editingResource.value = null;
}

async function handleResourceSaved() {
  closeResourceModal();
  await loadResources();
}

function confirmDeleteResource(resource: Resource) {
  resourceToDelete.value = resource;
  showDeleteDialog.value = true;
}

async function deleteResource() {
  const resource = resourceToDelete.value;
  if (!resource) return;

  try {
    await axios.delete(`/api/projects/${projectId.value}/resources/${resource.id}`);
    showDeleteDialog.value = false;
    resourceToDelete.value = null;
    showSuccess('Resource deleted successfully');
    await loadResources();
  } catch (error) {
    console.error('Error deleting resource:', error);
    showError('Failed to delete resource');
  }
}

onMounted(() => {
  loadProject();
});
</script>
