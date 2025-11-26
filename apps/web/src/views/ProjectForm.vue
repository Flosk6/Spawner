<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <router-link to="/projects" class="text-blue-600 hover:text-blue-700 mb-4 inline-block">
        ← Back to Projects
      </router-link>
      <h1 class="text-3xl font-bold text-gray-800">
        {{ isEdit ? 'Edit Project' : 'New Project' }}
      </h1>
    </div>

    <!-- Project Info -->
    <div class="bg-white rounded-lg shadow-md p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">Project Information</h2>

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Project Name
          </label>
          <input
            v-model="form.name"
            type="text"
            placeholder="iris-project"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Base Domain
          </label>
          <input
            v-model="form.baseDomain"
            type="text"
            placeholder="preview.yourdomain.com"
            class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <button
          @click="saveProject"
          :disabled="saving"
          class="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg font-medium transition disabled:opacity-50"
        >
          {{ saving ? 'Saving...' : 'Save Project Info' }}
        </button>
      </div>
    </div>

    <!-- Resources Section (only if project exists) -->
    <div v-if="projectId" class="bg-white rounded-lg shadow-md p-6">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-bold text-gray-800">Resources</h2>
        <button
          @click="showResourceModal = true"
          class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition"
        >
          + Add Resource
        </button>
      </div>

      <div v-if="loadingResources" class="text-center py-8 text-gray-600">
        Loading resources...
      </div>

      <div v-else-if="resources.length === 0" class="text-center py-8 text-gray-500">
        No resources yet. Click "Add Resource" to get started.
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="resource in resources"
          :key="resource.id"
          class="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-3 mb-2">
                <span class="text-2xl">{{ getResourceIcon(resource.type) }}</span>
                <h3 class="font-bold text-gray-800">{{ resource.name }}</h3>
                <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                  {{ resource.type }}
                </span>
              </div>

              <div v-if="resource.gitRepo" class="text-sm text-gray-600 space-y-1">
                <p>📦 {{ resource.gitRepo }}</p>
                <p>🌿 Branch: {{ resource.defaultBranch }}</p>
                <p v-if="resource.type === 'laravel-api'">
                  🗄️ Database: {{ getResourceName(resource.dbResourceId) }}
                </p>
                <p v-if="resource.type === 'nextjs-front'">
                  ⚙️ API: {{ getResourceName(resource.apiResourceId) }}
                </p>
              </div>
            </div>

            <div class="flex gap-2">
              <button
                @click="editResource(resource)"
                class="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm font-medium transition"
              >
                Edit
              </button>
              <button
                @click="confirmDeleteResource(resource)"
                class="bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1 rounded text-sm font-medium transition"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Resource Modal -->
    <ResourceModal
      v-if="showResourceModal"
      :project-id="projectId"
      :resource="editingResource"
      :all-resources="resources"
      @close="closeResourceModal"
      @saved="handleResourceSaved"
    />

    <!-- Delete Resource Confirmation -->
    <div
      v-if="resourceToDelete"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      @click="resourceToDelete = null"
    >
      <div class="bg-white rounded-lg p-6 max-w-md w-full" @click.stop>
        <h3 class="text-xl font-bold text-gray-800 mb-4">Delete Resource?</h3>
        <p class="text-gray-600 mb-6">
          Are you sure you want to delete <strong>{{ resourceToDelete.name }}</strong>?
        </p>
        <div class="flex gap-3">
          <button
            @click="resourceToDelete = null"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 py-2 rounded font-medium transition"
          >
            Cancel
          </button>
          <button
            @click="deleteResource"
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
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import axios from 'axios';
import ResourceModal from '../components/ResourceModal.vue';

const route = useRoute();
const router = useRouter();

const projectId = ref(null);
const isEdit = computed(() => !!route.params.id);

const form = ref({
  name: '',
  baseDomain: '',
});

const resources = ref([]);
const saving = ref(false);
const loadingResources = ref(false);
const showResourceModal = ref(false);
const editingResource = ref(null);
const resourceToDelete = ref(null);

function getResourceIcon(type) {
  const icons = {
    'mysql-db': '🗄️',
    'laravel-api': '⚙️',
    'nextjs-front': '🎨',
  };
  return icons[type] || '📦';
}

function getResourceName(resourceId) {
  const resource = resources.value.find(r => r.id === resourceId);
  return resource ? resource.name : 'Unknown';
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
    alert('Failed to load project');
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
  } finally {
    loadingResources.value = false;
  }
}

async function saveProject() {
  if (!form.value.name || !form.value.baseDomain) {
    alert('Please fill in all fields');
    return;
  }

  try {
    saving.value = true;

    if (isEdit.value) {
      await axios.put(`/api/projects/${projectId.value}`, form.value);
      alert('Project updated successfully');
    } else {
      const response = await axios.post('/api/projects', form.value);
      projectId.value = response.data.id;
      alert('Project created successfully');
      router.push(`/projects/${projectId.value}`);
    }
  } catch (error) {
    console.error('Error saving project:', error);
    alert(error.response?.data?.message || 'Failed to save project');
  } finally {
    saving.value = false;
  }
}

function editResource(resource) {
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

function confirmDeleteResource(resource) {
  resourceToDelete.value = resource;
}

async function deleteResource() {
  const resource = resourceToDelete.value;
  try {
    await axios.delete(`/api/projects/${projectId.value}/resources/${resource.id}`);
    resourceToDelete.value = null;
    await loadResources();
  } catch (error) {
    console.error('Error deleting resource:', error);
    alert('Failed to delete resource');
  }
}

onMounted(() => {
  loadProject();
});
</script>
