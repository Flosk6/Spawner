<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <h1 class="text-3xl font-bold text-gray-800">Projects</h1>
      <div class="flex gap-3">
        <router-link
          to="/settings/git"
          class="bg-gray-600 hover:bg-gray-700 text-white px-6 py-2 rounded-lg font-medium transition"
        >
          🔑 SSH Keys
        </router-link>
        <router-link
          to="/projects/new"
          class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition"
        >
          + New Project
        </router-link>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-600">Loading projects...</p>
    </div>

    <div v-else-if="projects.length === 0" class="text-center py-12">
      <p class="text-gray-600 mb-4">No projects yet</p>
      <router-link
        to="/projects/new"
        class="text-blue-600 hover:text-blue-700 font-medium"
      >
        Create your first project
      </router-link>
    </div>

    <div v-else class="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="project in projects"
        :key="project.id"
        class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition"
      >
        <h2 class="text-xl font-bold text-gray-800 mb-2">{{ project.name }}</h2>
        <p class="text-gray-600 mb-4 text-sm">{{ project.baseDomain }}</p>

        <div class="flex items-center gap-4 text-sm text-gray-500 mb-4">
          <span>{{ project.resources?.length || 0 }} resources</span>
          <span>•</span>
          <span>{{ project.environments?.length || 0 }} environments</span>
        </div>

        <div class="flex gap-2">
          <router-link
            :to="`/projects/${project.id}`"
            class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded text-center text-sm font-medium transition"
          >
            Edit
          </router-link>
          <router-link
            :to="`/projects/${project.id}/environments`"
            class="flex-1 bg-blue-100 hover:bg-blue-200 text-blue-700 px-4 py-2 rounded text-center text-sm font-medium transition"
          >
            Environments
          </router-link>
          <button
            @click="confirmDelete(project)"
            class="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded text-sm font-medium transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <div
      v-if="projectToDelete"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      @click="projectToDelete = null"
    >
      <div
        class="bg-white rounded-lg p-6 max-w-md w-full"
        @click.stop
      >
        <h3 class="text-xl font-bold text-gray-800 mb-4">Delete Project?</h3>
        <p class="text-gray-600 mb-2">
          Are you sure you want to delete <strong>{{ projectToDelete.name }}</strong>?
        </p>
        <p class="text-sm text-red-600 mb-6">
          This will also delete all {{ projectToDelete.environments?.length || 0 }} environments and cannot be undone.
        </p>
        <div class="flex gap-3">
          <button
            @click="projectToDelete = null"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-medium transition"
          >
            Cancel
          </button>
          <button
            @click="deleteProject"
            class="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import axios from 'axios';

const router = useRouter();
const projects = ref([]);
const loading = ref(true);
const projectToDelete = ref(null);

async function loadProjects() {
  try {
    loading.value = true;
    const response = await axios.get('/api/projects');
    projects.value = response.data;
  } catch (error) {
    console.error('Error loading projects:', error);
    alert('Failed to load projects');
  } finally {
    loading.value = false;
  }
}

function confirmDelete(project) {
  projectToDelete.value = project;
}

async function deleteProject() {
  const project = projectToDelete.value;
  try {
    await axios.delete(`/api/projects/${project.id}`);
    projectToDelete.value = null;
    await loadProjects();
  } catch (error) {
    console.error('Error deleting project:', error);
    alert('Failed to delete project');
  }
}

onMounted(() => {
  loadProjects();
});
</script>
