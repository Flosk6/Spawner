<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Projects</h1>
      <p class="page-lead">Repositories holding a <code>.spawner/spawner.yaml</code>.</p>
    </div>
    <div v-if="authStore.isAdmin" class="page-actions">
      <button type="button" class="btn btn-primary" @click="edit(null)"><Plus />New project</button>
    </div>
  </div>

  <div v-if="loading" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <div v-else-if="projects.length === 0" class="card empty">
    <FolderGit2 class="size-6" />
    <span class="empty-title">No project yet</span>
    <span>A project is a repository with a <code>.spawner/</code> directory, see <code>examples/node-postgres</code>.</span>
    <span v-if="!authStore.isAdmin">An admin adds the projects.</span>
    <button v-else type="button" class="btn btn-primary btn-sm mt-2" @click="edit(null)"><Plus />Add your first project</button>
  </div>

  <div v-else class="grid auto-rows-fr gap-4 sm:grid-cols-2 xl:grid-cols-3">
    <article v-for="project in projects" :key="project.id" class="card relative flex flex-col transition-colors hover:border-line-strong">
      <div class="flex items-start gap-3 px-4 pt-4">
        <span class="project-icon" aria-hidden="true">{{ initial(project) }}</span>
        <div class="min-w-0 flex-1">
          <RouterLink :to="`/projects/${project.slug}`" class="row-title block after:absolute after:inset-0">{{ project.name }}</RouterLink>
          <div class="row-sub font-mono">{{ project.slug }}</div>
          <div class="row-sub font-mono"><span class="truncate">{{ project.repoUrl }}</span></div>
        </div>
        <button
          v-if="authStore.isAdmin"
          type="button"
          class="btn btn-ghost btn-sm btn-icon relative z-10 -mr-1.5 -mt-1"
          :aria-label="`Actions for ${project.name}`"
          @click="openMenu($event, project)"
        >
          <Ellipsis />
        </button>
      </div>

      <div class="flex flex-wrap gap-1.5 px-4 pb-4 pt-3">
        <span class="badge badge-sm"><GitBranch /><span class="font-mono">{{ project.defaultRef }}</span></span>
        <span v-if="project.rootDir !== '.'" class="badge badge-sm"><Folder /><span class="font-mono">{{ project.rootDir }}</span></span>
        <span v-if="project.allowPublic" class="badge badge-sm tone-warn"><Globe />Public URLs allowed</span>
        <span v-if="project.allowAlwaysOn" class="badge badge-sm"><Sun />May never sleep</span>
      </div>

      <div class="card-foot mt-auto">
        <RouterLink
          :to="{ path: '/environments', query: { project: project.slug } }"
          class="relative z-10 inline-flex items-center gap-1.5 font-medium text-fg-2 hover:text-accent-text"
        >
          <Layers class="size-3.5" />{{ project.environmentCount }} environment{{ project.environmentCount === 1 ? '' : 's' }}
        </RouterLink>
      </div>
    </article>

    <button v-if="authStore.isAdmin" type="button" class="card-dashed min-h-0" @click="edit(null)"><Plus class="size-5" />Add a project</button>
  </div>

  <ActionMenu ref="cardMenu" :items="menuItems" />
  <ProjectDialog v-model:visible="dialogVisible" :project="editing" @saved="load" />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Ellipsis, Folder, FolderGit2, GitBranch, Globe, Layers, LoaderCircle, Pencil, Plus, Sun, Trash2 } from 'lucide-vue-next';
import ActionMenu, { type MenuAction } from '../components/ActionMenu.vue';
import ProjectDialog from '../components/ProjectDialog.vue';
import { useNotification } from '../composables/useNotification';
import { useAuthStore } from '../stores/auth';
import { errorMessage, projectsApi } from '../services/api';
import type { Project, ProjectSummary } from '../types';

const authStore = useAuthStore();
const { showError, showSuccess, confirmDelete } = useNotification();

const projects = ref<ProjectSummary[]>([]);
const loading = ref(true);
const dialogVisible = ref(false);
const editing = ref<Project | null>(null);
const cardMenu = ref<InstanceType<typeof ActionMenu> | null>(null);
const menuFor = ref<ProjectSummary | null>(null);

const menuItems = computed<MenuAction[]>(() => {
  const project = menuFor.value;
  if (!project) {
    return [];
  }
  return [
    { label: 'Edit', icon: Pencil, command: () => edit(project) },
    { separator: true },
    { label: 'Delete', icon: Trash2, danger: true, command: () => confirmRemove(project) },
  ];
});

/** The letter of the project's square icon. */
function initial(project: Project): string {
  return (project.name || project.slug || '').charAt(0).toUpperCase();
}

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

function openMenu(event: Event, project: ProjectSummary) {
  menuFor.value = project;
  cardMenu.value?.toggle(event);
}

function confirmRemove(project: ProjectSummary) {
  confirmDelete(
    project.name,
    async () => {
      try {
        await projectsApi.remove(project.slug);
        showSuccess(`${project.name} deleted`);
        await load();
      } catch (err) {
        showError(errorMessage(err, 'The project could not be deleted'));
      }
    },
    'Its variables are deleted with it; its repository is not touched. Spawner refuses while the project still has environments.',
  );
}

onMounted(load);
</script>
