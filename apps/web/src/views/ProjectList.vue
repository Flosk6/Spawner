<template>
  <div>
    <div class="flex flex-wrap justify-between items-center gap-4 mb-8">
      <div>
        <h1 class="text-4xl font-bold mb-2">Projects</h1>
        <p class="text-lg opacity-70">Repositories holding a <code class="text-base">.spawner/spawner.yaml</code></p>
      </div>
      <button v-if="authStore.isAdmin" class="primary-action" @click="edit(null)">
        <i class="pi pi-plus text-lg"></i>
        <span class="text-lg">New project</span>
      </button>
    </div>

    <div v-if="loading" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <div v-else-if="projects.length === 0" class="text-center py-20">
      <i class="pi pi-folder-open text-6xl mb-6 block opacity-30"></i>
      <p class="text-xl mb-2 opacity-60">No project yet</p>
      <p class="mb-6 opacity-60">
        A project is a repository with a <code>.spawner/</code> directory, see <code>examples/node-postgres</code>.
      </p>
      <p v-if="!authStore.isAdmin" class="opacity-60">An admin adds the projects.</p>
      <button v-else class="primary-action" @click="edit(null)">
        <i class="pi pi-plus"></i>
        <span>Add your first project</span>
      </button>
    </div>

    <div v-else class="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      <div
        v-for="project in projects"
        :key="project.id"
        class="group relative rounded-xl p-[1px] bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 hover:shadow-2xl hover:shadow-blue-500/20 transition-all duration-300 cursor-pointer"
        @click="openEnvironments(project)"
      >
        <div class="relative rounded-xl bg-white dark:bg-dark-800 p-6 h-full overflow-hidden flex flex-col">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div class="min-w-0">
              <h2 class="text-2xl font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {{ project.name }}
              </h2>
              <p class="text-sm font-mono text-slate-500">{{ project.slug }}</p>
            </div>
            <div class="text-center flex-shrink-0">
              <div class="text-3xl font-bold text-slate-900 dark:text-white">{{ project.environmentCount }}</div>
              <div class="text-xs text-slate-500">environment{{ project.environmentCount === 1 ? '' : 's' }}</div>
            </div>
          </div>

          <dl class="space-y-1.5 text-sm text-slate-600 dark:text-slate-400 mb-6">
            <div class="flex items-center gap-2 min-w-0">
              <i class="pi pi-link text-xs"></i>
              <span class="font-mono truncate">{{ project.repoUrl }}</span>
            </div>
            <div class="flex items-center gap-2">
              <i class="pi pi-code-branch text-xs"></i>
              <span class="font-mono">{{ project.defaultRef }}</span>
              <template v-if="project.rootDir !== '.'">
                <span class="opacity-50">in</span>
                <span class="font-mono">{{ project.rootDir }}</span>
              </template>
            </div>
          </dl>

          <div v-if="authStore.isAdmin" class="mt-auto flex gap-2" @click.stop>
            <button
              class="flex-1 px-4 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-slate-300 dark:hover:bg-slate-700 border border-slate-300/50 dark:border-purple-800/30 text-sm font-medium text-slate-900 dark:text-white rounded-lg transition-all flex items-center justify-center gap-2"
              @click="edit(project)"
            >
              <i class="pi pi-cog text-sm"></i>Edit
            </button>
            <button
              class="px-4 py-2.5 bg-slate-200/70 dark:bg-dark-700/70 hover:bg-red-100 dark:hover:bg-red-900/30 border border-slate-300/50 dark:border-purple-800/30 hover:border-red-400 rounded-lg transition-all text-slate-600 dark:text-slate-400 hover:text-red-600"
              v-tooltip.top="'Delete'"
              @click="confirmRemove(project)"
            >
              <i class="pi pi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    </div>

    <ProjectDialog v-model:visible="dialogVisible" :project="editing" @saved="load" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ProgressSpinner from 'primevue/progressspinner';
import ProjectDialog from '../components/ProjectDialog.vue';
import { useNotification } from '../composables/useNotification';
import { useAuthStore } from '../stores/auth';
import { errorMessage, projectsApi } from '../services/api';
import type { Project, ProjectSummary } from '../types';

const router = useRouter();
const authStore = useAuthStore();
const { showError, showSuccess, confirmDelete } = useNotification();

const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const dialogVisible = ref(false);
const editing = ref<Project | null>(null);

async function load() {
  try {
    projects.value = await projectsApi.list();
  } catch (err) {
    showError(errorMessage(err, 'The projects could not be loaded'));
  } finally {
    loading.value = false;
  }
}

function edit(project: Project | null) {
  editing.value = project;
  dialogVisible.value = true;
}

function openEnvironments(project: Project) {
  router.push(`/projects/${project.slug}`);
}

function confirmRemove(project: ProjectSummary) {
  confirmDelete(project.name, async () => {
    try {
      await projectsApi.remove(project.slug);
      showSuccess(`${project.name} deleted`);
      await load();
    } catch (err) {
      showError(errorMessage(err, 'The project could not be deleted'));
    }
  });
}

onMounted(load);
</script>
