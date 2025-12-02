<template>
  <div class="container mx-auto px-4 py-8 max-w-6xl">
    <div class="mb-6">
      <router-link to="/projects" class="text-blue-600 hover:text-blue-700 dark:text-purple-400">
        ← Back to Projects
      </router-link>
    </div>

    <h1 class="text-3xl font-bold text-gray-800 dark:text-slate-200 mb-4">Git SSH Keys Management</h1>

    <p class="text-gray-600 dark:text-slate-400 mb-8">
      Each repository requires its own SSH Deploy Key. Generate a unique key for each repository and add it to
      GitHub/GitLab.
    </p>

    <!-- Instructions Card -->
    <div class="bg-blue-50 dark:bg-purple-900/20 border border-blue-200 dark:border-purple-700/40 rounded-lg p-6 mb-6">
      <h2 class="text-lg font-bold text-blue-900 dark:text-purple-200 mb-3">How to add Deploy Keys</h2>
      <div class="text-sm text-blue-800 dark:text-purple-300 space-y-2">
        <p class="font-medium">For each repository below:</p>
        <ol class="list-decimal list-inside ml-4 space-y-1">
          <li>Click "Generate Key" to create a unique SSH key for that repository</li>
          <li>Copy the public key that appears</li>
          <li>Go to your GitHub/GitLab repository</li>
          <li><strong>GitHub:</strong> Settings → Deploy keys → Add deploy key</li>
          <li><strong>GitLab:</strong> Settings → Repository → Deploy Keys</li>
          <li>Paste the key, give it a title (e.g., "Spawner"), and save</li>
        </ol>
        <p class="text-xs text-blue-700 dark:text-purple-400 mt-3 font-medium">
          Each Deploy Key is unique per repository - this is a GitHub/GitLab requirement
        </p>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <p class="text-gray-600 dark:text-slate-400">Loading repositories...</p>
    </div>

    <div v-else-if="repos.length === 0" class="text-center py-12 bg-white rounded-lg shadow-md">
      <p class="text-gray-600 dark:text-slate-400 mb-4">No Git repositories found in your projects</p>
      <router-link to="/projects" class="text-blue-600 hover:text-blue-700 dark:text-purple-400 font-medium">
        Create a project with Git resources first
      </router-link>
    </div>

    <div v-else class="bg-white dark:bg-dark-800 rounded-lg shadow-md overflow-hidden">
      <table class="min-w-full divide-y divide-gray-200 dark:divide-purple-800/30">
        <thead class="bg-gray-50 dark:bg-dark-700">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">
              Git Repository
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">
              Used By
            </th>
            <th class="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">
              SSH Key Status
            </th>
            <th class="px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-slate-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody class="bg-white dark:bg-dark-800 divide-y divide-gray-200 dark:divide-purple-800/30">
          <tr v-for="repo in repos" :key="repo.gitRepo" class="hover:bg-gray-50 dark:hover:bg-purple-500/10 dark:bg-dark-700 transition">
            <td class="px-6 py-4">
              <div class="text-sm text-gray-900 dark:text-white font-mono">{{ repo.gitRepo }}</div>
            </td>
            <td class="px-6 py-4">
              <div class="text-sm text-gray-700 dark:text-slate-300">
                <div v-for="usage in repo.usedBy" :key="usage.resourceId" class="mb-1">
                  <span class="font-medium">{{ usage.projectName }}</span>
                  <span class="text-gray-500 dark:text-slate-500 mx-1">/</span>
                  <span>{{ usage.resourceName }}</span>
                </div>
              </div>
            </td>
            <td class="px-6 py-4 whitespace-nowrap">
              <span v-if="repo.keyExists"
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                ✓ Key exists
              </span>
              <span v-else
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800 dark:text-slate-200">
                No key
              </span>
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
              <button v-if="!repo.keyExists" @click="generateKeyForRepo(repo)"
                :disabled="generatingRepoUrl === repo.gitRepo"
                class="text-blue-600 hover:text-blue-900 dark:text-purple-200 disabled:opacity-50">
                {{ generatingRepoUrl === repo.gitRepo ? 'Generating...' : 'Generate Key' }}
              </button>
              <button v-else @click="showKey(repo)" class="text-green-600 hover:text-green-900 mr-4">
                View Key
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- View Key Modal -->
    <div v-if="selectedRepo" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      @click="selectedRepo = null">
      <div class="bg-white dark:bg-dark-800 rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" @click.stop>
        <div class="flex justify-between items-start mb-4">
          <div class="flex-1">
            <h3 class="text-xl font-bold text-gray-800 dark:text-slate-200">SSH Deploy Key</h3>
            <p class="text-xs text-gray-500 dark:text-slate-500 mt-2 font-mono">{{ selectedRepo.gitRepo }}</p>
            <div class="mt-3 text-sm text-gray-700 dark:text-slate-300">
              <p class="font-medium text-gray-600 dark:text-slate-400 mb-1">Used by:</p>
              <div v-for="usage in selectedRepo.usedBy" :key="usage.resourceId" class="ml-2">
                <span class="font-medium">{{ usage.projectName }}</span>
                <span class="text-gray-500 dark:text-slate-500 mx-1">/</span>
                <span>{{ usage.resourceName }}</span>
              </div>
            </div>
          </div>
          <button @click="selectedRepo = null" class="text-gray-400 hover:text-gray-600 dark:text-slate-400 text-2xl leading-none ml-4">
            ×
          </button>
        </div>

        <div class="mb-4">
          <label class="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
            Public Key (Add this to your Git provider)
          </label>
          <div class="relative">
            <textarea :value="selectedRepo.publicKey" readonly rows="8"
              class="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 dark:bg-dark-700 font-mono text-xs"></textarea>
            <button @click="copyKey(selectedRepo.publicKey)"
              class="absolute top-2 right-2 bg-gray-200 hover:bg-gray-300 text-gray-700 dark:text-slate-300 px-3 py-1 rounded text-sm transition">
              {{ copied ? 'Copied!' : 'Copy' }}
            </button>
          </div>
        </div>

        <div class="bg-blue-50 dark:bg-purple-900/20 border border-blue-200 dark:border-purple-700/40 rounded-lg p-4">
          <h4 class="font-medium text-blue-900 dark:text-purple-200 mb-2">How to add this Deploy Key:</h4>
          <ol class="text-sm text-blue-800 dark:text-purple-300 space-y-1 list-decimal list-inside">
            <li>Copy the public key above</li>
            <li>Go to your repository on GitHub/GitLab</li>
            <li><strong>GitHub:</strong> Settings → Deploy keys → Add deploy key</li>
            <li><strong>GitLab:</strong> Settings → Repository → Deploy Keys</li>
            <li>Paste the key and give it a title (e.g., "Spawner")</li>
            <li>Save (read-only access is sufficient)</li>
          </ol>
        </div>

        <div class="flex gap-3 mt-6">
          <button @click="confirmRegenerateRepo = selectedRepo"
            class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg font-medium transition">
            Regenerate Key
          </button>
          <button @click="selectedRepo = null"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 dark:text-slate-300 px-4 py-2 rounded-lg font-medium transition">
            Close
          </button>
        </div>
      </div>
    </div>

    <!-- Regenerate Confirmation Modal -->
    <div v-if="confirmRegenerateRepo"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50"
      @click="confirmRegenerateRepo = null">
      <div class="bg-white dark:bg-dark-800 rounded-lg p-6 max-w-md w-full" @click.stop>
        <h3 class="text-xl font-bold text-gray-800 dark:text-slate-200 mb-4">Regenerate SSH Key?</h3>
        <p class="text-gray-600 dark:text-slate-400 mb-2">
          This will generate a new SSH key for:
        </p>
        <p class="text-sm font-mono text-gray-800 dark:text-slate-200 bg-gray-100 p-2 rounded mb-4">
          {{ confirmRegenerateRepo.gitRepo }}
        </p>
        <p class="text-sm text-red-600 mb-6">
          ⚠️ You will need to update the Deploy Key on this repository.
        </p>
        <div class="flex gap-3">
          <button @click="confirmRegenerateRepo = null"
            class="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 dark:text-slate-300 px-4 py-2 rounded font-medium transition">
            Cancel
          </button>
          <button @click="regenerateKey"
            class="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded font-medium transition">
            Regenerate
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

const loading = ref(true);
const repos = ref([]);
const selectedRepo = ref(null);
const confirmRegenerateRepo = ref(null);
const generatingRepoUrl = ref(null);
const copied = ref(false);

async function loadRepos() {
  try {
    loading.value = true;
    const response = await axios.get('/api/git/keys/repos');
    repos.value = response.data;
  } catch (error) {
    console.error('Error loading repos:', error);
    alert('Failed to load repositories');
  } finally {
    loading.value = false;
  }
}

async function generateKeyForRepo(repo) {
  try {
    generatingRepoUrl.value = repo.gitRepo;
    const response = await axios.post('/api/git/keys/generate', {
      gitRepo: repo.gitRepo,
    });

    // Update the repo in the list
    const index = repos.value.findIndex(r => r.gitRepo === repo.gitRepo);
    if (index !== -1) {
      repos.value[index] = {
        ...repos.value[index],
        keyExists: true,
        publicKey: response.data.publicKey,
      };
    }

    // Show the key modal
    selectedRepo.value = repos.value[index];
  } catch (error) {
    console.error('Error generating key:', error);
    alert('Failed to generate SSH key: ' + (error.response?.data?.message || error.message));
  } finally {
    generatingRepoUrl.value = null;
  }
}

function showKey(repo) {
  selectedRepo.value = repo;
}

function copyKey(publicKey) {
  navigator.clipboard.writeText(publicKey);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
}

async function regenerateKey() {
  const repo = confirmRegenerateRepo.value;
  confirmRegenerateRepo.value = null;
  selectedRepo.value = null;

  await generateKeyForRepo(repo);
}

onMounted(() => {
  loadRepos();
});
</script>
