<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-4xl font-bold">Projects</h1>
      <div class="flex gap-3">
        <Button
          label="SSH Keys"
          icon="pi pi-key"
          severity="secondary"
          outlined
          @click="$router.push('/settings/git')"
        />
        <Button
          label="New Project"
          icon="pi pi-plus"
          @click="$router.push('/projects/new')"
        />
      </div>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="projects.length === 0" class="text-center py-20">
      <i class="pi pi-folder-open text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">No projects yet</p>
      <Button
        label="Create your first project"
        icon="pi pi-plus"
        size="large"
        @click="$router.push('/projects/new')"
      />
    </div>

    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <Card v-for="project in projects" :key="project.id" class="hover:shadow-lg transition-shadow cursor-pointer">
        <template #header>
          <div class="p-6 pb-0">
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1">
                <h2 class="text-2xl font-bold mb-2">{{ project.name }}</h2>
                <div class="flex items-center gap-2 opacity-70">
                  <i class="pi pi-globe"></i>
                  <span>{{ project.baseDomain }}</span>
                </div>
              </div>
              <Button
                icon="pi pi-trash"
                severity="danger"
                text
                rounded
                @click.stop="confirmDelete(project)"
                v-tooltip.top="'Delete project'"
              />
            </div>
          </div>
        </template>

        <template #content>
          <Divider />

          <div class="grid grid-cols-2 gap-4 mb-4">
            <div class="text-center p-3 rounded border">
              <div class="flex items-center justify-center gap-2 mb-2">
                <i class="pi pi-box text-blue-500 text-xl"></i>
                <span class="text-2xl font-bold">{{ project.resources?.length || 0 }}</span>
              </div>
              <div class="text-sm opacity-70">Resources</div>
            </div>

            <div class="text-center p-3 rounded border">
              <div class="flex items-center justify-center gap-2 mb-2">
                <i class="pi pi-server text-green-500 text-xl"></i>
                <span class="text-2xl font-bold">{{ project.environments?.length || 0 }}</span>
              </div>
              <div class="text-sm opacity-70">Environments</div>
            </div>
          </div>

          <Divider />

          <div class="flex flex-col gap-2 mt-4">
            <Button
              label="Manage Environments"
              icon="pi pi-server"
              outlined
              class="w-full"
              @click="$router.push(`/projects/${project.id}/environments`)"
            />
            <Button
              label="Edit Project"
              icon="pi pi-cog"
              severity="secondary"
              outlined
              class="w-full"
              @click="$router.push(`/projects/${project.id}`)"
            />
          </div>
        </template>
      </Card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import axios from 'axios';
import Card from 'primevue/card';
import Button from 'primevue/button';
import Divider from 'primevue/divider';
import ProgressSpinner from 'primevue/progressspinner';
import { useNotification } from '../composables/useNotification';

interface Project {
  id: number;
  name: string;
  baseDomain: string;
  resources?: any[];
  environments?: any[];
}

const { showSuccess, showError, confirmDelete: confirmDeleteDialog } = useNotification();

const projects = ref<Project[]>([]);
const loading = ref(true);

async function loadProjects() {
  try {
    loading.value = true;
    const response = await axios.get('/api/projects');
    projects.value = response.data;
  } catch (error) {
    console.error('Error loading projects:', error);
    showError('Failed to load projects');
  } finally {
    loading.value = false;
  }
}

function confirmDelete(project: Project) {
  confirmDeleteDialog(
    project.name,
    () => deleteProject(project)
  );
}

async function deleteProject(project: Project) {
  try {
    await axios.delete(`/api/projects/${project.id}`);
    showSuccess(`Project "${project.name}" deleted successfully`);
    await loadProjects();
  } catch (error) {
    console.error('Error deleting project:', error);
    showError('Failed to delete project');
  }
}

onMounted(() => {
  loadProjects();
});
</script>
