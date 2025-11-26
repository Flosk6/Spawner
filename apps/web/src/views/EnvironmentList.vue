<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-6">
      <router-link to="/projects" class="text-blue-600 hover:text-blue-700">
        ← Back to Projects
      </router-link>
    </div>

    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="text-3xl font-bold text-gray-800">Environments</h1>
        <p v-if="project" class="text-gray-600 mt-1">
          Project: <strong>{{ project.name }}</strong>
        </p>
      </div>
      <router-link
        :to="`/projects/${projectId}/environments/new`"
        class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition"
      >
        + New Environment
      </router-link>
    </div>

    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-600">Loading environments...</p>
    </div>

    <div v-else-if="environments.length === 0" class="text-center py-12">
      <p class="text-gray-600 mb-4">No environments yet</p>
      <router-link
        :to="`/projects/${projectId}/environments/new`"
        class="text-blue-600 hover:text-blue-700 font-medium"
      >
        Create your first environment
      </router-link>
    </div>

    <div v-else class="bg-white rounded-lg shadow-md overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Status
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Branches
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Created
            </th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-gray-200">
          <tr
            v-for="env in environments"
            :key="env.id"
            class="hover:bg-gray-50 transition"
          >
            <td class="px-6 py-4 whitespace-nowrap">
              <div class="font-medium text-gray-900">{{ env.name }}</div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span
                :class="{
                  'bg-green-100 text-green-800': env.status === 'running',
                  'bg-yellow-100 text-yellow-800': env.status === 'creating',
                  'bg-red-100 text-red-800': env.status === 'failed',
                  'bg-gray-100 text-gray-800': env.status === 'deleting',
                }"
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
              >
                {{ env.status }}
              </span>
            </td>
            <td class="px-6 py-4">
              <div class="text-sm text-gray-600">
                <div v-for="(branch, resourceName) in env.branches" :key="resourceName">
                  <span class="font-medium">{{ resourceName }}:</span> {{ branch }}
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
              {{ formatDate(env.createdAt) }}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <router-link
                :to="`/environments/${env.id}`"
                class="text-blue-600 hover:text-blue-900 mr-4"
              >
                View
              </router-link>
              <button
                @click="confirmDelete(env)"
                class="text-red-600 hover:text-red-900"
              >
                Delete
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Delete confirmation modal -->
    <div
      v-if="envToDelete && !deleting"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      @click="envToDelete = null"
    >
      <div class="bg-white rounded-lg p-6 max-w-md w-full" @click.stop>
        <h3 class="text-xl font-bold text-gray-800 mb-4">Delete Environment?</h3>
        <p class="text-gray-600 mb-2">
          Are you sure you want to delete <strong>{{ envToDelete.name }}</strong>?
        </p>
        <p class="text-sm text-red-600 mb-6">
          All containers and data will be removed. This cannot be undone.
        </p>
        <div class="flex gap-3">
          <button
            @click="envToDelete = null"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-medium transition"
          >
            Cancel
          </button>
          <button
            @click="deleteEnvironment"
            class="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium transition"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Progress Modal -->
    <div
      v-if="deleting"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
    >
      <div class="bg-white rounded-lg p-6 max-w-md w-full">
        <div class="text-center">
          <div class="mb-4">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          </div>
          <h3 class="text-xl font-semibold text-gray-900 mb-2">
            Deleting Environment
          </h3>
          <p class="text-gray-600 mb-4">
            {{ deletionStep }}
          </p>
          <div class="bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              class="bg-red-600 h-full transition-all duration-500"
              :style="{ width: deletionProgress + '%' }"
            ></div>
          </div>
          <p class="text-sm text-gray-500 mt-2">
            This may take up to 15 seconds...
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import axios from 'axios';

const route = useRoute();

const projectId = ref(null);
const project = ref(null);
const environments = ref([]);
const loading = ref(true);
const envToDelete = ref(null);

// Delete progress state
const deleting = ref(false);
const deletionStep = ref('');
const deletionProgress = ref(0);

async function loadData() {
  projectId.value = parseInt(route.params.projectId);

  try {
    loading.value = true;

    // Load project details
    const projectResponse = await axios.get(`/api/projects/${projectId.value}`);
    project.value = projectResponse.data;

    // Load environments for this project
    const envsResponse = await axios.get(`/api/projects/${projectId.value}/environments`);
    environments.value = envsResponse.data;
  } catch (error) {
    console.error('Error loading data:', error);
    alert('Failed to load environments');
  } finally {
    loading.value = false;
  }
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

function confirmDelete(env) {
  envToDelete.value = env;
}

async function deleteEnvironment() {
  const env = envToDelete.value;
  try {
    deleting.value = true;
    deletionStep.value = 'Stopping containers...';
    deletionProgress.value = 20;

    // Start deletion
    const deletePromise = axios.delete(`/api/environments/${env.id}`);

    // Simulate progress updates
    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing volumes...';
    deletionProgress.value = 40;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Removing networks...';
    deletionProgress.value = 60;

    await new Promise(resolve => setTimeout(resolve, 2000));
    deletionStep.value = 'Cleaning up files...';
    deletionProgress.value = 80;

    // Wait for actual deletion to complete
    await deletePromise;

    deletionStep.value = 'Complete!';
    deletionProgress.value = 100;

    await new Promise(resolve => setTimeout(resolve, 500));

    // Reset and reload
    envToDelete.value = null;
    deleting.value = false;
    await loadData();
  } catch (error) {
    console.error('Error deleting environment:', error);
    deleting.value = false;
    alert('Failed to delete environment');
  }
}

onMounted(() => {
  loadData();
});
</script>
