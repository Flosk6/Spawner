<template>
  <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
    <Toast />
    <ConfirmDialog />

    <!-- Intelligent Cleanup Preview Dialog -->
    <Dialog v-model:visible="showCleanupPreview" modal header="Aperçu du nettoyage intelligent" :style="{ width: '50rem' }">
      <div v-if="cleanupPreview" class="space-y-4">
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-semibold text-blue-900">Résumé</h3>
              <p class="text-xs text-blue-700 mt-1">Ressources qui seront supprimées</p>
            </div>
            <div class="text-right">
              <p class="text-2xl font-bold text-blue-900">{{ cleanupPreview.count }}</p>
              <p class="text-xs text-blue-700">~{{ formatBytes(cleanupPreview.size) }}</p>
            </div>
          </div>
        </div>

        <div v-if="cleanupPreview.images.length > 0" class="border border-gray-200 rounded-lg p-3">
          <h4 class="font-semibold text-sm mb-2">Images ({{ cleanupPreview.images.length }})</h4>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <div v-for="img in cleanupPreview.images" :key="img.id" class="text-xs text-gray-700 flex justify-between">
              <span class="truncate mr-2">{{ img.name }}</span>
              <span class="text-gray-500">{{ formatBytes(img.size) }}</span>
            </div>
          </div>
        </div>

        <div v-if="cleanupPreview.containers.length > 0" class="border border-gray-200 rounded-lg p-3">
          <h4 class="font-semibold text-sm mb-2">Containers ({{ cleanupPreview.containers.length }})</h4>
          <div class="max-h-40 overflow-y-auto space-y-1">
            <div v-for="container in cleanupPreview.containers" :key="container.id" class="text-xs text-gray-700">
              {{ container.name }}
            </div>
          </div>
        </div>

        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p class="text-xs text-yellow-800">
            <strong>Critères:</strong> Images dangling, images >30 jours inutilisées, containers stopped >7 jours, build cache
          </p>
        </div>
      </div>

      <template #footer>
        <Button label="Annuler" severity="secondary" @click="showCleanupPreview = false" />
        <Button label="Confirmer le nettoyage" severity="success" @click="confirmIntelligentCleanup" :loading="runningIntelligentCleanup" />
      </template>
    </Dialog>

    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-900">System Settings</h1>
      <p class="mt-2 text-sm text-gray-600">
        Manage Spawner updates, Docker resources, and system patches
      </p>
    </div>

    <!-- Version Information -->
    <div class="bg-white shadow rounded-lg p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">Version Information</h2>

      <div class="grid grid-cols-2 gap-4 mb-4">
        <div>
          <p class="text-sm text-gray-600">Current Version</p>
          <p class="text-lg font-semibold">{{ versionInfo.current || 'Loading...' }}</p>
        </div>
        <div>
          <p class="text-sm text-gray-600">Latest Version</p>
          <p class="text-lg font-semibold">{{ versionInfo.latest || 'Loading...' }}</p>
        </div>
      </div>

      <div v-if="updateAvailable" class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
        <div class="flex items-start">
          <svg class="h-5 w-5 text-blue-400 mt-0.5 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" />
          </svg>
          <div>
            <h3 class="text-sm font-medium text-blue-800">Update Available</h3>
            <p class="text-sm text-blue-700 mt-1">
              A new version of Spawner is available: {{ updateInfo.latestVersion }}
            </p>
            <div v-if="updateInfo.changelog" class="mt-2 text-xs text-blue-600 max-h-32 overflow-y-auto">
              <p class="font-semibold mb-1">Changelog:</p>
              <pre class="whitespace-pre-wrap">{{ updateInfo.changelog }}</pre>
            </div>
          </div>
        </div>
      </div>

      <div class="flex gap-3">
        <button
          @click="checkForUpdates"
          :disabled="checking"
          class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {{ checking ? 'Checking...' : 'Check for Updates' }}
        </button>

        <button
          v-if="updateAvailable"
          @click="applyUpdate"
          :disabled="updating"
          class="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {{ updating ? 'Updating...' : 'Apply Update' }}
        </button>
      </div>
    </div>

    <!-- Auto-Update Settings -->
    <div class="bg-white shadow rounded-lg p-6 mb-6">
      <h2 class="text-xl font-semibold mb-4">Auto-Update Configuration</h2>

      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <label class="text-sm font-medium text-gray-700">Enable Auto-Update</label>
            <p class="text-xs text-gray-500">Automatically apply updates when available</p>
          </div>
          <button
            @click="toggleAutoUpdate"
            :class="[
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
              settings.autoUpdateEnabled ? 'bg-blue-600' : 'bg-gray-200'
            ]"
          >
            <span
              :class="[
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
                settings.autoUpdateEnabled ? 'translate-x-5' : 'translate-x-0'
              ]"
            />
          </button>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Update Check Schedule
          </label>
          <input
            v-model="settings.updateCheckCron"
            type="text"
            placeholder="0 * * * * (hourly)"
            class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Cron expression for update checks</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">
            Auto-Update Schedule
          </label>
          <input
            v-model="settings.autoUpdateCron"
            type="text"
            placeholder="0 0 * * * (daily at midnight)"
            class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p class="text-xs text-gray-500 mt-1">Cron expression for automatic updates</p>
        </div>

        <button
          @click="saveSettings"
          :disabled="saving"
          class="px-4 py-2 bg-green-600 text-white rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
        >
          {{ saving ? 'Saving...' : 'Save Settings' }}
        </button>
      </div>
    </div>

    <!-- System Patches -->
    <div class="bg-white shadow rounded-lg p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-semibold">System Patches</h2>
        <button
          @click="checkPatches"
          :disabled="checkingPatches"
          class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {{ checkingPatches ? 'Checking...' : 'Check for Patches' }}
        </button>
      </div>

      <div v-if="patches.length === 0" class="text-center py-8 text-gray-500">
        <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p class="mt-2">No pending patches</p>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="patch in patches"
          :key="patch.id"
          class="border border-gray-200 rounded-lg p-4"
        >
          <div class="flex items-start justify-between">
            <div class="flex-1">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold">{{ patch.packageName }}</h3>
                <span
                  :class="[
                    'px-2 py-0.5 text-xs rounded-full',
                    patch.type === 'security' ? 'bg-red-100 text-red-800' :
                    patch.type === 'bugfix' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-blue-100 text-blue-800'
                  ]"
                >
                  {{ patch.type }}
                </span>
              </div>
              <p class="text-sm text-gray-600 mt-1">
                {{ patch.currentVersion }} → {{ patch.latestVersion }}
              </p>
              <p v-if="patch.changelog" class="text-xs text-gray-500 mt-1">
                {{ patch.changelog }}
              </p>
            </div>
            <button
              @click="applyPatch(patch.id)"
              :disabled="applyingPatch === patch.id"
              class="ml-4 px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {{ applyingPatch === patch.id ? 'Applying...' : 'Apply' }}
            </button>
          </div>
        </div>

        <button
          @click="applyAllPatches"
          :disabled="applyingAll"
          class="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {{ applyingAll ? 'Applying All...' : 'Apply All Patches' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import api from '../services/api';

const versionInfo = ref({ current: null, latest: null });
const updateInfo = ref(null);
const settings = ref({
  autoUpdateEnabled: false,
  updateCheckCron: '0 * * * *',
  autoUpdateCron: '0 0 * * *',
});
const patches = ref([]);

const checking = ref(false);
const updating = ref(false);
const saving = ref(false);
const checkingPatches = ref(false);
const applyingPatch = ref(null);
const applyingAll = ref(false);

const updateAvailable = ref(false);

onMounted(async () => {
  await Promise.all([
    loadVersion(),
    loadSettings(),
    loadPatches(),
  ]);
});

async function loadVersion() {
  try {
    const response = await api.get('/system/version');
    versionInfo.value = response.data.data;
  } catch (error) {
    console.error('Failed to load version:', error);
  }
}

async function loadSettings() {
  try {
    const response = await api.get('/system/settings');
    settings.value = response.data.data;
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

async function loadPatches() {
  try {
    const response = await api.get('/system/patches');
    patches.value = response.data.data;
  } catch (error) {
    console.error('Failed to load patches:', error);
  }
}

async function checkForUpdates() {
  checking.value = true;
  try {
    const response = await api.get('/system/updates/check');
    updateInfo.value = response.data.data;

    if (response.data.data.updateAvailable) {
      versionInfo.value.latest = response.data.data.latestVersion;
      alert(`Update available: ${response.data.data.latestVersion}`);
    } else {
      alert('You are running the latest version');
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    alert('Failed to check for updates');
  } finally {
    checking.value = false;
  }
}

async function applyUpdate() {
  if (!confirm('This will restart Spawner. Continue?')) {
    return;
  }

  updating.value = true;
  try {
    await api.post('/system/updates/apply');
    alert('Update started. The service will restart in a few moments.');

    setTimeout(() => {
      window.location.reload();
    }, 30000);
  } catch (error) {
    console.error('Failed to apply update:', error);
    alert('Failed to apply update');
  } finally {
    updating.value = false;
  }
}

async function toggleAutoUpdate() {
  settings.value.autoUpdateEnabled = !settings.value.autoUpdateEnabled;
  await saveSettings();
}

async function saveSettings() {
  saving.value = true;
  try {
    await api.post('/system/settings', settings.value);
    alert('Settings saved successfully');
  } catch (error) {
    console.error('Failed to save settings:', error);
    alert('Failed to save settings');
  } finally {
    saving.value = false;
  }
}

async function checkPatches() {
  checkingPatches.value = true;
  try {
    const response = await api.post('/system/patches/check');
    alert(response.data.message);
    await loadPatches();
  } catch (error) {
    console.error('Failed to check patches:', error);
    alert('Failed to check for patches');
  } finally {
    checkingPatches.value = false;
  }
}

async function applyPatch(patchId) {
  if (!confirm('Apply this patch?')) {
    return;
  }

  applyingPatch.value = patchId;
  try {
    await api.post(`/system/patches/${patchId}/apply`);
    alert('Patch applied successfully');
    await loadPatches();
  } catch (error) {
    console.error('Failed to apply patch:', error);
    alert('Failed to apply patch');
  } finally {
    applyingPatch.value = null;
  }
}

async function applyAllPatches() {
  if (!confirm(`Apply all ${patches.value.length} patches?`)) {
    return;
  }

  applyingAll.value = true;
  try {
    await api.post('/system/patches/apply-all');
    alert('All patches applied successfully');
    await loadPatches();
  } catch (error) {
    console.error('Failed to apply patches:', error);
    alert('Failed to apply all patches');
  } finally {
    applyingAll.value = false;
  }
}
</script>
