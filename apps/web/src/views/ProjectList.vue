<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-4xl font-bold mb-2">Projects</h1>
        <p class="text-lg opacity-70">Configure your application projects</p>
      </div>
      <button @click="$router.push('/projects/new')"
        class="group relative px-4 py-2 rounded-lg font-semibold text-white overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-purple-500/30">
        <div
          class="absolute inset-0 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 transition-all duration-300 group-hover:scale-105">
        </div>
        <div
          class="absolute inset-0 bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 opacity-0 group-hover:opacity-50 transition-opacity duration-300">
        </div>
        <div class="relative flex items-center gap-2">
          <i class="pi pi-plus text-lg"></i>
          <span class="text-lg">New Project</span>
        </div>
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="projects.length === 0" class="text-center py-20">
      <i class="pi pi-folder-open text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-6 opacity-60">No projects yet</p>
      <button @click="$router.push('/projects/new')"
        class="group relative px-8 py-4 rounded-lg font-semibold text-white overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-purple-500/30">
        <div
          class="absolute inset-0 bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 transition-all duration-300 group-hover:scale-105">
        </div>
        <div
          class="absolute inset-0 bg-gradient-to-r from-purple-400 via-violet-400 to-indigo-400 opacity-0 group-hover:opacity-50 transition-opacity duration-300">
        </div>
        <div class="relative flex items-center gap-2">
          <i class="pi pi-plus text-xl"></i>
          <span class="text-xl">Create your first project</span>
        </div>
      </button>
    </div>

    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div v-for="project in projects" :key="project.id"
        class="group relative rounded-xl p-[1px] bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 hover:shadow-2xl hover:shadow-blue-500/20 transition-all duration-300 cursor-pointer"
        @click="$router.push(`/projects/${project.id}`)">
        <div class="relative rounded-xl bg-white dark:bg-dark-800 p-6 h-full overflow-hidden">
          <div
            class="absolute top-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-slate-400/40 dark:via-white/30 to-transparent">
          </div>

          <div class="mb-6">
            <h2
              class="text-2xl font-bold mb-2 text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
              {{ project.name }}</h2>
            <div class="flex items-center gap-2 text-slate-600 dark:text-slate-400">
              <i class="pi pi-globe text-sm"></i>
              <span class="text-sm">{{ project.baseDomain }}</span>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 mb-6">
            <div
              class="bg-slate-200/60 dark:bg-dark-700/50 backdrop-blur-sm rounded-lg p-4 border border-slate-300/50 dark:border-purple-800/30">
              <div class="flex items-center justify-center gap-2 mb-2">
                <i class="pi pi-box text-blue-600 dark:text-blue-400 text-xl"></i>
                <span class="text-3xl font-bold text-slate-900 dark:text-white">{{ project.resources?.length || 0
                  }}</span>
              </div>
              <div class="text-sm text-slate-600 dark:text-slate-400 text-center">Resources</div>
            </div>

            <div
              class="bg-slate-200/60 dark:bg-dark-700/50 backdrop-blur-sm rounded-lg p-4 border border-slate-300/50 dark:border-purple-800/30">
              <div class="flex items-center justify-center gap-2 mb-2">
                <i class="pi pi-sitemap text-green-600 dark:text-green-400 text-xl"></i>
                <span class="text-3xl font-bold text-slate-900 dark:text-white">{{ project.environments?.length || 0
                  }}</span>
              </div>
              <div class="text-sm text-slate-600 dark:text-slate-400 text-center">Environments</div>
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex gap-2">
            <button
              class="flex-1 px-4 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 hover:border-slate-400 dark:hover:border-slate-600 text-sm font-medium text-slate-900 dark:text-white rounded-lg transition-all duration-200 flex items-center justify-center gap-2 group/btn">
              <i class="pi pi-cog text-sm group-hover/btn:scale-110 transition-transform"></i>
              Edit
            </button>
            <button
              class="px-4 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-red-100 dark:hover:bg-red-900/30 border border-slate-300/50 dark:border-purple-800/30 hover:border-red-400 dark:hover:border-red-500/50 rounded-lg transition-all duration-200"
              @click.stop="confirmDelete(project)" v-tooltip.top="'Delete'">
              <i
                class="pi pi-trash text-slate-600 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"></i>
            </button>
          </div>

          <div
            class="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-10 dark:group-hover:opacity-10 bg-gradient-to-br from-blue-500 to-purple-500 transition-opacity pointer-events-none">
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import axios from 'axios';
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
