<template>
  <div>
    <!-- Back Button - Sticky at top -->
    <div v-if="!loading && !error" class="mb-6">
      <Button label="Back" icon="pi pi-arrow-left" text @click="$router.push('/projects')" />
    </div>

    <div v-if="loading" class="flex justify-center items-center min-h-[400px]">
      <ProgressSpinner />
    </div>

    <div v-else-if="error" class="text-center py-20">
      <Message severity="error" :closable="false">{{ error }}</Message>
    </div>

    <div v-else-if="project" class="flex gap-6">
      <!-- Left Sidebar - Navigation -->
      <div class="w-64 flex-shrink-0">
        <!-- Project Info Header -->
        <div class="mb-6 p-4 rounded-xl bg-gradient-to-br from-blue-500/10 to-purple-500/10 border border-blue-500/20 dark:border-blue-400/20">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <i class="pi pi-folder text-white text-xl"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="font-bold text-lg text-slate-900 dark:text-white truncate">{{ project.name }}</h2>
              <div class="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
                <i class="pi pi-globe text-xs"></i>
                <span class="truncate">{{ project.baseDomain }}</span>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div class="bg-white/50 dark:bg-slate-800/50 rounded-lg p-2 text-center">
              <div class="text-lg font-bold text-slate-900 dark:text-white">{{ project.resources?.length || 0 }}</div>
              <div class="text-xs text-slate-600 dark:text-slate-400">Resources</div>
            </div>
            <div class="bg-white/50 dark:bg-slate-800/50 rounded-lg p-2 text-center">
              <div class="text-lg font-bold text-slate-900 dark:text-white">{{ environments.length }}</div>
              <div class="text-xs text-slate-600 dark:text-slate-400">Environments</div>
            </div>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <nav class="space-y-1">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            @click="activeTab = tab.value"
            :class="[
              'w-full flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200',
              activeTab === tab.value
                ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/70'
            ]"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
          </button>
        </nav>
      </div>

      <!-- Right Content Area -->
      <div class="flex-1 min-w-0">
        <!-- Overview Tab -->
        <div v-if="activeTab === 'overview'">
          <h2 class="text-3xl font-bold mb-6 text-slate-900 dark:text-white">Overview</h2>

          <div class="grid gap-6">
            <!-- Project Information Card -->
            <Card>
              <template #title>
                <div class="flex items-center gap-2">
                  <i class="pi pi-info-circle text-blue-500"></i>
                  <span>Project Information</span>
                </div>
              </template>
              <template #content>
                <div class="grid gap-4">
                  <div>
                    <label class="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1 block">Project Name</label>
                    <div class="text-lg text-slate-900 dark:text-white">{{ project.name }}</div>
                  </div>
                  <div>
                    <label class="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1 block">Base Domain</label>
                    <div class="text-lg text-slate-900 dark:text-white flex items-center gap-2">
                      <i class="pi pi-globe text-blue-500"></i>
                      {{ project.baseDomain }}
                    </div>
                  </div>
                  <div>
                    <label class="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1 block">Created</label>
                    <div class="text-lg text-slate-900 dark:text-white">{{ formatDate(project.createdAt) }}</div>
                  </div>
                </div>
              </template>
            </Card>

            <!-- Quick Stats Card -->
            <Card>
              <template #title>
                <div class="flex items-center gap-2">
                  <i class="pi pi-chart-bar text-green-500"></i>
                  <span>Quick Stats</span>
                </div>
              </template>
              <template #content>
                <div class="grid grid-cols-3 gap-4">
                  <div class="text-center p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <i class="pi pi-box text-3xl text-blue-500 mb-2"></i>
                    <div class="text-2xl font-bold text-slate-900 dark:text-white">{{ project.resources?.length || 0 }}</div>
                    <div class="text-sm text-slate-600 dark:text-slate-400">Resources</div>
                  </div>
                  <div class="text-center p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <i class="pi pi-server text-3xl text-green-500 mb-2"></i>
                    <div class="text-2xl font-bold text-slate-900 dark:text-white">{{ environments.length }}</div>
                    <div class="text-sm text-slate-600 dark:text-slate-400">Environments</div>
                  </div>
                  <div class="text-center p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <i class="pi pi-check-circle text-3xl text-green-500 mb-2"></i>
                    <div class="text-2xl font-bold text-slate-900 dark:text-white">{{ runningEnvironments }}</div>
                    <div class="text-sm text-slate-600 dark:text-slate-400">Running</div>
                  </div>
                </div>
              </template>
            </Card>
          </div>
        </div>

        <!-- Resources Tab -->
        <div v-if="activeTab === 'resources'">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-3xl font-bold text-slate-900 dark:text-white">Resources</h2>
            <Button
              label="Add Resource"
              icon="pi pi-plus"
              @click="$router.push(`/projects/${project.id}/resources/new`)"
            />
          </div>

          <div v-if="loadingResources" class="flex justify-center py-12">
            <ProgressSpinner />
          </div>

          <div v-else-if="(project.resources?.length || 0) === 0" class="text-center py-20">
            <i class="pi pi-box text-6xl mb-6 block opacity-30"></i>
            <p class="text-xl mb-6 opacity-60">No resources yet</p>
            <Button
              label="Add your first resource"
              icon="pi pi-plus"
              @click="$router.push(`/projects/${project.id}/resources/new`)"
            />
          </div>

          <div v-else class="grid gap-4">
            <div
              v-for="resource in project.resources"
              :key="resource.id"
              class="group relative rounded-xl p-[1px] bg-gradient-to-br from-slate-300 to-slate-400 dark:from-slate-700 dark:to-slate-600 hover:from-blue-500 hover:to-purple-600 transition-all duration-300"
            >
              <div class="relative rounded-xl bg-white dark:bg-slate-900 p-6">
                <div class="flex items-start justify-between">
                  <div class="flex-1">
                    <div class="flex items-center gap-3 mb-3">
                      <i :class="getResourceIcon(resource.type)" class="text-2xl text-blue-500"></i>
                      <h3 class="font-bold text-xl text-slate-900 dark:text-white">{{ resource.name }}</h3>
                      <Tag :value="resource.type" severity="info" />
                    </div>

                    <div v-if="resource.gitRepo" class="flex flex-col gap-2 text-slate-600 dark:text-slate-400">
                      <div class="flex items-center gap-2">
                        <i class="pi pi-github"></i>
                        <span class="text-sm">{{ resource.gitRepo }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <i class="pi pi-code-branch"></i>
                        <span class="text-sm">Branch: {{ resource.defaultBranch }}</span>
                      </div>
                    </div>
                  </div>

                  <div class="flex gap-2">
                    <Button
                      icon="pi pi-pencil"
                      severity="secondary"
                      outlined
                      @click="$router.push(`/projects/${project.id}/resources/${resource.id}/edit`)"
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
              </div>
            </div>
          </div>
        </div>

        <!-- Environments Tab -->
        <div v-if="activeTab === 'environments'">
          <div class="flex justify-between items-center mb-6">
            <h2 class="text-3xl font-bold text-slate-900 dark:text-white">Environments</h2>
            <Button
              label="New Environment"
              icon="pi pi-plus"
              @click="$router.push(`/projects/${project.id}/environments/new`)"
            />
          </div>

          <div v-if="loadingEnvironments" class="flex justify-center py-12">
            <ProgressSpinner />
          </div>

          <div v-else-if="environments.length === 0" class="text-center py-20">
            <i class="pi pi-server text-6xl mb-6 block opacity-30"></i>
            <p class="text-xl mb-6 opacity-60">No environments yet</p>
            <Button
              label="Create your first environment"
              icon="pi pi-plus"
              @click="$router.push(`/projects/${project.id}/environments/new`)"
            />
          </div>

          <div v-else class="grid gap-4">
            <EnvironmentCard
              v-for="environment in environments"
              :key="environment.id"
              :environment="environment"
              @view="$router.push(`/environments/${environment.id}`)"
              @delete="confirmDeleteEnvironment(environment)"
            />
          </div>
        </div>

        <!-- Settings Tab -->
        <div v-if="activeTab === 'settings'">
          <h2 class="text-3xl font-bold mb-6 text-slate-900 dark:text-white">Settings</h2>

          <Card>
            <template #title>Project Configuration</template>
            <template #content>
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-2">
                  <label for="projectName" class="font-semibold">Project Name</label>
                  <InputText
                    id="projectName"
                    v-model="editForm.name"
                    placeholder="my-project"
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <label for="baseDomain" class="font-semibold">Base Domain</label>
                  <InputText
                    id="baseDomain"
                    v-model="editForm.baseDomain"
                    placeholder="preview.yourdomain.com"
                  />
                </div>

                <Button
                  :label="saving ? 'Saving...' : 'Save Changes'"
                  icon="pi pi-save"
                  @click="saveProject"
                  :disabled="saving"
                  :loading="saving"
                />
              </div>
            </template>
          </Card>
        </div>

        <!-- Danger Zone Tab -->
        <div v-if="activeTab === 'danger'">
          <h2 class="text-3xl font-bold mb-6 text-slate-900 dark:text-white">Danger Zone</h2>

          <Card>
            <template #content>
              <div class="border-2 border-red-500/50 rounded-lg p-6">
                <h3 class="text-xl font-bold mb-3 text-red-600 dark:text-red-400">Delete Project</h3>
                <p class="text-slate-600 dark:text-slate-400 mb-4">
                  Once you delete a project, all of its environments and resources will be permanently removed. This action cannot be undone.
                </p>
                <Button
                  label="Delete Project"
                  icon="pi pi-trash"
                  severity="danger"
                  @click="confirmDeleteProject"
                />
              </div>
            </template>
          </Card>
        </div>
      </div>
    </div>

    <!-- Delete Resource Confirmation -->
    <Dialog
      v-model:visible="showDeleteResourceDialog"
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
          @click="showDeleteResourceDialog = false"
        />
        <Button
          label="Delete"
          severity="danger"
          @click="deleteResource"
        />
      </template>
    </Dialog>

    <!-- Delete Environment Confirmation -->
    <Dialog
      v-model:visible="showDeleteEnvDialog"
      header="Delete Environment?"
      :modal="true"
      :style="{ width: '450px' }"
    >
      <p class="mb-4">
        Are you sure you want to delete environment <strong>{{ environmentToDelete?.name }}</strong>?
      </p>
      <template #footer>
        <Button
          label="Cancel"
          severity="secondary"
          outlined
          @click="showDeleteEnvDialog = false"
        />
        <Button
          label="Delete"
          severity="danger"
          @click="deleteEnvironment"
        />
      </template>
    </Dialog>
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
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import EnvironmentCard from '../components/EnvironmentCard.vue';
import { useNotification } from '../composables/useNotification';
import type { Environment } from '../types';

interface Resource {
  id: number;
  name: string;
  type: string;
  gitRepo?: string;
  defaultBranch?: string;
}

interface Project {
  id: number;
  name: string;
  baseDomain: string;
  resources?: Resource[];
  createdAt: string | Date;
}

const route = useRoute();
const router = useRouter();
const { showSuccess, showError } = useNotification();

const project = ref<Project | null>(null);
const environments = ref<Environment[]>([]);
const loading = ref(true);
const loadingResources = ref(false);
const loadingEnvironments = ref(false);
const saving = ref(false);
const error = ref('');

const activeTab = ref('overview');

const tabs = [
  { value: 'overview', label: 'Overview', icon: 'pi pi-home' },
  { value: 'resources', label: 'Resources', icon: 'pi pi-box' },
  { value: 'environments', label: 'Environments', icon: 'pi pi-server' },
  { value: 'settings', label: 'Settings', icon: 'pi pi-cog' },
  { value: 'danger', label: 'Danger Zone', icon: 'pi pi-exclamation-triangle' },
];

const editForm = ref({
  name: '',
  baseDomain: '',
});

const resourceToDelete = ref<Resource | null>(null);
const showDeleteResourceDialog = ref(false);
const environmentToDelete = ref<Environment | null>(null);
const showDeleteEnvDialog = ref(false);

const runningEnvironments = computed(() => {
  return environments.value.filter(e => e.status === 'running').length;
});

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getResourceIcon(type: string): string {
  const icons: Record<string, string> = {
    'mysql-db': 'pi pi-database',
    'laravel-api': 'pi pi-cog',
    'nextjs-front': 'pi pi-palette',
  };
  return icons[type] || 'pi pi-box';
}

async function loadProject() {
  try {
    loading.value = true;
    const response = await axios.get(`/api/projects/${route.params.id}`);
    project.value = response.data;
    editForm.value.name = response.data.name;
    editForm.value.baseDomain = response.data.baseDomain;

    await Promise.all([loadEnvironments()]);
  } catch (err) {
    console.error('Error loading project:', err);
    error.value = 'Failed to load project';
  } finally {
    loading.value = false;
  }
}

async function loadEnvironments() {
  try {
    loadingEnvironments.value = true;
    const response = await axios.get(`/api/environments?projectId=${route.params.id}`);
    environments.value = response.data;
  } catch (err) {
    console.error('Error loading environments:', err);
    showError('Failed to load environments');
  } finally {
    loadingEnvironments.value = false;
  }
}

async function saveProject() {
  if (!editForm.value.name || !editForm.value.baseDomain) {
    showError('Please fill in all fields');
    return;
  }

  try {
    saving.value = true;
    await axios.put(`/api/projects/${project.value?.id}`, editForm.value);
    showSuccess('Project updated successfully');
    if (project.value) {
      project.value.name = editForm.value.name;
      project.value.baseDomain = editForm.value.baseDomain;
    }
  } catch (err: any) {
    console.error('Error saving project:', err);
    showError(err.response?.data?.message || 'Failed to save project');
  } finally {
    saving.value = false;
  }
}

function confirmDeleteResource(resource: Resource) {
  resourceToDelete.value = resource;
  showDeleteResourceDialog.value = true;
}

async function deleteResource() {
  const resource = resourceToDelete.value;
  if (!resource || !project.value) return;

  try {
    await axios.delete(`/api/projects/${project.value.id}/resources/${resource.id}`);
    showDeleteResourceDialog.value = false;
    resourceToDelete.value = null;
    showSuccess('Resource deleted successfully');
    await loadProject();
  } catch (err) {
    console.error('Error deleting resource:', err);
    showError('Failed to delete resource');
  }
}

function confirmDeleteEnvironment(environment: Environment) {
  environmentToDelete.value = environment;
  showDeleteEnvDialog.value = true;
}

async function deleteEnvironment() {
  const environment = environmentToDelete.value;
  if (!environment) return;

  try {
    await axios.delete(`/api/environments/${environment.id}`);
    showDeleteEnvDialog.value = false;
    environmentToDelete.value = null;
    showSuccess('Environment deleted successfully');
    await loadEnvironments();
  } catch (err) {
    console.error('Error deleting environment:', err);
    showError('Failed to delete environment');
  }
}

async function confirmDeleteProject() {
  if (!project.value) return;

  const confirmed = await new Promise<boolean>((resolve) => {
    const dialog = window.confirm(
      `Are you sure you want to delete project "${project.value?.name}"? This will delete all environments and cannot be undone.`
    );
    resolve(dialog);
  });

  if (!confirmed) return;

  try {
    await axios.delete(`/api/projects/${project.value.id}`);
    showSuccess('Project deleted successfully');
    router.push('/projects');
  } catch (err) {
    console.error('Error deleting project:', err);
    showError('Failed to delete project');
  }
}

onMounted(() => {
  loadProject();
});
</script>
