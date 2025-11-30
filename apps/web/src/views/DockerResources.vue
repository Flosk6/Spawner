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
      <h1 class="text-3xl font-bold text-gray-900">Docker Resources</h1>
      <p class="mt-2 text-sm text-gray-600">
        Monitor and manage Docker disk usage on your VPS
      </p>
    </div>

    <!-- Docker Resources Content -->
    <div class="bg-white shadow rounded-lg p-6 mb-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-xl font-semibold">Docker Resources</h2>
          <p class="text-sm text-gray-600 mt-1">Monitor and manage Docker disk usage</p>
        </div>
        <button
          @click="refreshDockerStats"
          :disabled="loadingDockerStats"
          class="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {{ loadingDockerStats ? 'Refreshing...' : 'Refresh' }}
        </button>
      </div>

      <div v-if="dockerStats" class="space-y-6">
        <!-- Overview -->
        <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div class="flex items-center justify-between">
            <div class="flex-1">
              <h3 class="text-sm font-semibold text-blue-900">Total Docker Usage</h3>
              <p class="text-xs text-blue-700 mt-1">All Docker resources on this system</p>
            </div>
            <div class="text-right">
              <p class="text-2xl font-bold text-blue-900">{{ formatBytes(getTotalSize()) }}</p>
              <p class="text-xs text-blue-700">{{ formatBytes(getReclaimableSize()) }} reclaimable</p>
            </div>
          </div>
        </div>

        <!-- Intelligent Cleanup -->
        <div class="bg-gradient-to-r from-green-50 to-blue-50 border border-green-200 rounded-lg p-4 mb-4">
          <div class="flex items-center justify-between mb-3">
            <div class="flex-1">
              <h3 class="text-sm font-semibold text-green-900 flex items-center">
                <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Nettoyage Intelligent
              </h3>
              <p class="text-xs text-green-700 mt-1">
                Supprime automatiquement: images dangling, images >30 jours inutilisées, containers stopped >7 jours, build cache
              </p>
            </div>
            <button
              @click="runIntelligentCleanup"
              :disabled="runningIntelligentCleanup"
              class="ml-4 px-6 py-3 bg-gradient-to-r from-green-600 to-blue-600 text-white rounded-lg text-sm font-medium hover:from-green-700 hover:to-blue-700 disabled:opacity-50 shadow-md"
            >
              {{ runningIntelligentCleanup ? 'Nettoyage en cours...' : 'Lancer le nettoyage intelligent' }}
            </button>
          </div>
          <div v-if="getIntelligentCleanupEstimate()" class="text-xs text-green-800">
            Estimation: {{ getIntelligentCleanupEstimate().count }} ressources à nettoyer (~{{ formatBytes(getIntelligentCleanupEstimate().size) }})
          </div>
        </div>

        <!-- Images -->
        <div class="border border-gray-200 rounded-lg">
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900">Images</h3>
                <p class="text-xs text-gray-500 mt-1">{{ imagesList.length }} total images</p>
              </div>
              <div class="text-right mr-4">
                <p class="text-sm font-semibold text-gray-900">{{ formatBytes(getImagesSize()) }}</p>
                <p class="text-xs text-gray-500">{{ formatBytes(getDanglingImagesSize()) }} unused</p>
              </div>
              <button
                @click="toggleSection('images')"
                class="p-2 hover:bg-gray-100 rounded"
              >
                <svg class="w-5 h-5 transform transition-transform" :class="{ 'rotate-180': expandedSections.images }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                :style="{ width: getImagesPercentage() + '%' }"
              ></div>
            </div>

            <!-- Expandable List -->
            <div v-if="expandedSections.images" class="mt-4 border-t border-gray-200 pt-4">
              <div v-if="danglingImages.length > 0" class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <label class="flex items-center text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      v-model="selectAllDanglingImages"
                      @change="toggleAllDanglingImages"
                      class="mr-2 rounded"
                    />
                    Select all dangling images ({{ danglingImages.length }})
                  </label>
                  <span class="text-xs text-gray-500">{{ formatBytes(getDanglingImagesSize()) }}</span>
                </div>

                <div class="max-h-64 overflow-y-auto space-y-2">
                  <div
                    v-for="image in danglingImages"
                    :key="image.Id"
                    class="border border-gray-200 rounded p-3"
                  >
                    <label class="flex items-start cursor-pointer">
                      <input
                        type="checkbox"
                        :value="image.Id"
                        v-model="selectedImages"
                        class="mr-3 mt-1 rounded"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-gray-900 font-mono text-xs truncate">{{ getImageName(image) }}</span>
                          <span class="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded-full whitespace-nowrap">
                            Safe to delete
                          </span>
                        </div>
                        <div class="text-xs text-gray-600 space-y-0.5">
                          <div>Age: {{ formatAge(image.ageInDays) }}</div>
                          <div>Type: Dangling image (build artifact)</div>
                          <div v-if="image.usedByContainers && image.usedByContainers.length > 0">
                            Used by: {{ image.usedByContainers.map(c => c.name).join(', ') }}
                          </div>
                          <div v-else class="text-green-600">Not used by any container</div>
                        </div>
                      </div>
                      <span class="text-gray-700 font-semibold ml-4 text-sm whitespace-nowrap">{{ formatBytes(image.Size) }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div v-if="usedImages.length > 0" class="mb-4">
                <p class="text-sm font-medium text-gray-700 mb-2">Tagged images ({{ usedImages.length }})</p>
                <div class="max-h-64 overflow-y-auto space-y-2">
                  <div
                    v-for="image in usedImages.slice(0, 20)"
                    :key="image.Id"
                    :class="[
                      'border rounded p-3',
                      image.recommendation === 'in-use' ? 'border-green-200 bg-green-50' :
                      image.recommendation === 'safe' ? 'border-gray-200 bg-gray-50' :
                      'border-yellow-200 bg-yellow-50'
                    ]"
                  >
                    <div class="flex items-start">
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-gray-900 font-mono text-xs truncate">{{ getImageName(image) }}</span>
                          <span
                            :class="[
                              'px-2 py-0.5 text-xs rounded-full whitespace-nowrap',
                              image.recommendation === 'in-use' ? 'bg-green-100 text-green-800' :
                              image.recommendation === 'safe' ? 'bg-red-100 text-red-800' :
                              'bg-yellow-100 text-yellow-800'
                            ]"
                          >
                            {{ getRecommendationLabel(image.recommendation) }}
                          </span>
                        </div>
                        <div class="text-xs text-gray-600 space-y-0.5">
                          <div>Age: {{ formatAge(image.ageInDays) }}</div>
                          <div v-if="image.usedByContainers && image.usedByContainers.length > 0" class="text-green-700">
                            Used by: {{ image.usedByContainers.map(c => `${c.name} (${c.state})`).join(', ') }}
                          </div>
                          <div v-else class="text-orange-600">
                            Not used by any container
                            <span v-if="image.ageInDays > 30" class="text-red-600"> - Old and unused!</span>
                          </div>
                        </div>
                      </div>
                      <span class="text-gray-700 font-semibold ml-4 text-sm whitespace-nowrap">{{ formatBytes(image.Size) }}</span>
                    </div>
                  </div>
                  <p v-if="usedImages.length > 20" class="text-xs text-gray-500 text-center py-2">
                    ... and {{ usedImages.length - 20 }} more images
                  </p>
                </div>
              </div>

              <button
                v-if="selectedImages.length > 0"
                @click="removeSelectedImages"
                :disabled="removingImages"
                class="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {{ removingImages ? 'Removing...' : `Remove ${selectedImages.length} selected image(s) (${formatBytes(getSelectedImagesSize())})` }}
              </button>
            </div>
          </div>
        </div>

        <!-- Containers -->
        <div class="border border-gray-200 rounded-lg">
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900">Containers</h3>
                <p class="text-xs text-gray-500 mt-1">{{ containersList.length }} total containers</p>
              </div>
              <div class="text-right mr-4">
                <p class="text-sm font-semibold text-gray-900">{{ formatBytes(getContainersSize()) }}</p>
                <p class="text-xs text-gray-500">{{ stoppedContainers.length }} stopped</p>
              </div>
              <button
                @click="toggleSection('containers')"
                class="p-2 hover:bg-gray-100 rounded"
              >
                <svg class="w-5 h-5 transform transition-transform" :class="{ 'rotate-180': expandedSections.containers }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                :style="{ width: getContainersPercentage() + '%' }"
              ></div>
            </div>

            <!-- Expandable List -->
            <div v-if="expandedSections.containers" class="mt-4 border-t border-gray-200 pt-4">
              <div v-if="stoppedContainers.length > 0" class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <label class="flex items-center text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      v-model="selectAllStoppedContainers"
                      @change="toggleAllStoppedContainers"
                      class="mr-2 rounded"
                    />
                    Select all stopped containers ({{ stoppedContainers.length }})
                  </label>
                </div>

                <div class="max-h-64 overflow-y-auto space-y-2">
                  <div
                    v-for="container in stoppedContainers"
                    :key="container.Id"
                    :class="[
                      'border rounded p-3',
                      container.recommendation === 'safe' ? 'border-green-200 bg-gray-50' : 'border-yellow-200 bg-yellow-50'
                    ]"
                  >
                    <label class="flex items-start cursor-pointer">
                      <input
                        type="checkbox"
                        :value="container.Id"
                        v-model="selectedContainers"
                        class="mr-3 mt-1 rounded"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-1">
                          <span class="text-gray-900 font-mono text-xs truncate">{{ getContainerName(container) }}</span>
                          <span
                            :class="[
                              'px-2 py-0.5 text-xs rounded-full whitespace-nowrap',
                              container.recommendation === 'safe' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                            ]"
                          >
                            {{ getRecommendationLabel(container.recommendation) }}
                          </span>
                          <span v-if="container.isSpawnerContainer" class="px-2 py-0.5 bg-blue-100 text-blue-800 text-xs rounded-full whitespace-nowrap">
                            Spawner
                          </span>
                        </div>
                        <div class="text-xs text-gray-600 space-y-0.5">
                          <div>State: {{ container.State }} - Age: {{ formatAge(container.ageInDays) }}</div>
                          <div v-if="container.environmentName" class="text-blue-700">
                            Environment: {{ container.environmentName }}
                          </div>
                          <div>Image: {{ container.Image }}</div>
                        </div>
                      </div>
                      <span class="text-gray-700 font-semibold ml-4 text-sm whitespace-nowrap">{{ formatBytes(container.SizeRw || 0) }}</span>
                    </label>
                  </div>
                </div>
              </div>

              <div v-if="runningContainers.length > 0" class="mb-4">
                <p class="text-sm font-medium text-gray-700 mb-2">Running containers ({{ runningContainers.length }})</p>
                <div class="max-h-48 overflow-y-auto space-y-2">
                  <div
                    v-for="container in runningContainers.slice(0, 10)"
                    :key="container.Id"
                    class="flex items-center justify-between p-2 bg-green-50 rounded text-xs"
                  >
                    <span class="text-gray-900 font-mono flex-1">{{ getContainerName(container) }}</span>
                    <span class="text-green-600 ml-2">(running)</span>
                  </div>
                  <p v-if="runningContainers.length > 10" class="text-xs text-gray-500 text-center">
                    ... and {{ runningContainers.length - 10 }} more
                  </p>
                </div>
              </div>

              <button
                v-if="selectedContainers.length > 0"
                @click="removeSelectedContainers"
                :disabled="removingContainers"
                class="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {{ removingContainers ? 'Removing...' : `Remove ${selectedContainers.length} selected container(s)` }}
              </button>
            </div>
          </div>
        </div>

        <!-- Volumes -->
        <div class="border border-gray-200 rounded-lg">
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900">Volumes</h3>
                <p class="text-xs text-gray-500 mt-1">{{ volumesList.length }} total volumes</p>
              </div>
              <div class="text-right mr-4">
                <p class="text-sm font-semibold text-gray-900">{{ formatBytes(getVolumesSize()) }}</p>
              </div>
              <button
                @click="toggleSection('volumes')"
                class="p-2 hover:bg-gray-100 rounded"
              >
                <svg class="w-5 h-5 transform transition-transform" :class="{ 'rotate-180': expandedSections.volumes }" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                :style="{ width: getVolumesPercentage() + '%' }"
              ></div>
            </div>

            <!-- Expandable List -->
            <div v-if="expandedSections.volumes" class="mt-4 border-t border-gray-200 pt-4">
              <div v-if="volumesList.length > 0" class="mb-4">
                <div class="flex items-center justify-between mb-2">
                  <label class="flex items-center text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      v-model="selectAllVolumes"
                      @change="toggleAllVolumes"
                      class="mr-2 rounded"
                    />
                    Select all volumes ({{ volumesList.length }})
                  </label>
                  <span class="text-xs text-gray-500">{{ formatBytes(getVolumesSize()) }}</span>
                </div>

                <div class="max-h-64 overflow-y-auto space-y-2">
                  <div
                    v-for="volume in volumesList"
                    :key="volume.Name"
                    class="flex items-center justify-between p-2 bg-gray-50 rounded text-xs"
                  >
                    <label class="flex items-center flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        :value="volume.Name"
                        v-model="selectedVolumes"
                        class="mr-2 rounded"
                      />
                      <span class="text-gray-900 font-mono flex-1">{{ volume.Name }}</span>
                    </label>
                    <span class="text-gray-600 ml-4">{{ formatBytes(volume.UsageData?.Size || 0) }}</span>
                  </div>
                </div>
              </div>

              <button
                v-if="selectedVolumes.length > 0"
                @click="removeSelectedVolumes"
                :disabled="removingVolumes"
                class="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {{ removingVolumes ? 'Removing...' : `Remove ${selectedVolumes.length} selected volume(s) (${formatBytes(getSelectedVolumesSize())})` }}
              </button>
            </div>
          </div>
        </div>

        <!-- Build Cache -->
        <div class="border border-gray-200 rounded-lg">
          <div class="p-4">
            <div class="flex items-center justify-between mb-3">
              <div class="flex-1">
                <h3 class="text-base font-semibold text-gray-900">Build Cache</h3>
                <p class="text-xs text-gray-500 mt-1">{{ dockerStats.BuildCache?.length || 0 }} cache entries</p>
              </div>
              <div class="text-right mr-4">
                <p class="text-sm font-semibold text-gray-900">{{ formatBytes(getBuildCacheSize()) }}</p>
                <p class="text-xs text-gray-500">{{ formatBytes(getReclaimableCacheSize()) }} reclaimable</p>
              </div>
            </div>

            <!-- Progress Bar -->
            <div class="w-full bg-gray-200 rounded-full h-2 mb-3">
              <div
                class="bg-blue-600 h-2 rounded-full transition-all duration-300"
                :style="{ width: getCachePercentage() + '%' }"
              ></div>
            </div>

            <button
              @click="pruneCache"
              :disabled="pruningCache"
              class="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {{ pruningCache ? 'Cleaning...' : 'Clean Build Cache' }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="text-center py-8 text-gray-500">
        <p>Loading Docker statistics...</p>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import api from '../services/api';

const toast = useToast();
const confirm = useConfirm();

// Refs
const dockerStats = ref(null);
const imagesList = ref([]);
const containersList = ref([]);
const volumesList = ref([]);
const expandedSections = ref({
  images: false,
  containers: false,
  volumes: false,
});
const selectedImages = ref([]);
const selectedContainers = ref([]);
const selectedVolumes = ref([]);
const selectAllDanglingImages = ref(false);
const selectAllStoppedContainers = ref(false);
const selectAllVolumes = ref(false);
const loadingDockerStats = ref(false);
const pruningCache = ref(false);
const removingImages = ref(false);
const removingContainers = ref(false);
const removingVolumes = ref(false);
const runningIntelligentCleanup = ref(false);
const showCleanupPreview = ref(false);
const cleanupPreview = ref(null);

// Computed
const danglingImages = computed(() => {
  return imagesList.value.filter(img =>
    !img.RepoTags || img.RepoTags.length === 0 || img.RepoTags.includes('<none>:<none>')
  );
});

const usedImages = computed(() => {
  return imagesList.value.filter(img =>
    img.RepoTags && img.RepoTags.length > 0 && !img.RepoTags.includes('<none>:<none>')
  );
});

const stoppedContainers = computed(() => {
  return containersList.value.filter(c => c.State !== 'running');
});

const runningContainers = computed(() => {
  return containersList.value.filter(c => c.State === 'running');
});

onMounted(async () => {
  await loadDockerStats();
  setInterval(() => {
    loadDockerStats();
  }, 30000);
});

async function loadDockerStats() {
  loadingDockerStats.value = true;
  try {
    const [statsRes, imagesRes, containersRes, volumesRes] = await Promise.all([
      api.get('/system/docker/stats'),
      api.get('/system/docker/images'),
      api.get('/system/docker/containers'),
      api.get('/system/docker/volumes'),
    ]);

    dockerStats.value = statsRes.data.data;
    imagesList.value = imagesRes.data.data;
    containersList.value = containersRes.data.data;
    volumesList.value = volumesRes.data.data.Volumes || [];
  } catch (error) {
    console.error('Failed to load Docker stats:', error);
  } finally {
    loadingDockerStats.value = false;
  }
}

async function refreshDockerStats() {
  await loadDockerStats();
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getTotalSize() {
  const imagesSize = dockerStats.value?.LayersSize || 0;
  const containersSize = containersList.value.reduce((sum, c) => sum + (c.SizeRw || 0), 0);
  const volumesSize = volumesList.value.reduce((sum, v) => sum + (v.UsageData?.Size || 0), 0);
  const cacheSize = dockerStats.value?.BuildCache?.reduce((sum, c) => sum + (c.Size || 0), 0) || 0;
  return imagesSize + containersSize + volumesSize + cacheSize;
}

function getReclaimableSize() {
  const danglingSize = imagesList.value.filter(img => img.isDangling).reduce((sum, img) => sum + (img.Size || 0), 0);
  const reclaimableCache = dockerStats.value?.BuildCache?.filter(c => !c.InUse).reduce((sum, c) => sum + (c.Size || 0), 0) || 0;
  return danglingSize + reclaimableCache;
}

function getIntelligentCleanupEstimate() {
  if (!imagesList.value.length && !containersList.value.length) return null;

  let count = 0;
  let size = 0;

  imagesList.value.forEach(img => {
    if (img.isDangling || (img.usedByContainers.length === 0 && img.ageInDays > 30)) {
      count++;
      size += img.Size || 0;
    }
  });

  containersList.value.forEach(container => {
    if (container.isStopped && container.ageInDays > 7) {
      count++;
      size += container.SizeRw || 0;
    }
  });

  size += getReclaimableSize();

  return { count, size };
}

function getImageName(image) {
  if (image.RepoTags && image.RepoTags.length > 0 && !image.RepoTags.includes('<none>:<none>')) {
    return image.RepoTags[0];
  }
  return `<none>:<none> (${image.Id.substring(7, 19)})`;
}

function getContainerName(container) {
  if (container.Names && container.Names.length > 0) {
    return container.Names[0].replace(/^\//, '');
  }
  return container.Id.substring(0, 12);
}

async function runIntelligentCleanup() {
  const estimate = getIntelligentCleanupEstimate();
  if (!estimate || estimate.count === 0) {
    toast.add({
      severity: 'info',
      summary: 'Aucun nettoyage nécessaire',
      detail: 'Aucune ressource à nettoyer selon les critères intelligents',
      life: 3000
    });
    return;
  }

  const imagesToClean = [];
  const containersToClean = [];

  imagesList.value.forEach(img => {
    if (img.isDangling || (img.usedByContainers.length === 0 && img.ageInDays > 30)) {
      imagesToClean.push({
        id: img.Id,
        name: getImageName(img),
        size: img.Size || 0
      });
    }
  });

  containersList.value.forEach(container => {
    if (container.isStopped && container.ageInDays > 7) {
      containersToClean.push({
        id: container.Id,
        name: getContainerName(container)
      });
    }
  });

  cleanupPreview.value = {
    count: estimate.count,
    size: estimate.size,
    images: imagesToClean,
    containers: containersToClean
  };

  showCleanupPreview.value = true;
}

async function confirmIntelligentCleanup() {
  runningIntelligentCleanup.value = true;
  try {
    const response = await api.post('/system/docker/intelligent-cleanup', {
      imageDaysThreshold: 30,
      containerDaysThreshold: 7,
    });

    const result = response.data.data;
    const totalFreed = result.images.spaceFreed + result.cache.spaceFreed;

    showCleanupPreview.value = false;

    toast.add({
      severity: 'success',
      summary: 'Nettoyage terminé!',
      detail: `${result.images.removed} images, ${result.containers.removed} containers supprimés. ${formatBytes(totalFreed)} libérés.`,
      life: 5000
    });

    await loadDockerStats();
  } catch (error) {
    console.error('Failed to run intelligent cleanup:', error);
    toast.add({
      severity: 'error',
      summary: 'Échec du nettoyage',
      detail: error.response?.data?.message || 'Une erreur est survenue',
      life: 5000
    });
  } finally {
    runningIntelligentCleanup.value = false;
  }
}

function toggleSection(section) {
  expandedSections.value[section] = !expandedSections.value[section];
}

function toggleAllDanglingImages() {
  if (selectAllDanglingImages.value) {
    selectedImages.value = danglingImages.value.map(img => img.Id);
  } else {
    selectedImages.value = [];
  }
}

function toggleAllStoppedContainers() {
  if (selectAllStoppedContainers.value) {
    selectedContainers.value = stoppedContainers.value.map(c => c.Id);
  } else {
    selectedContainers.value = [];
  }
}

function toggleAllVolumes() {
  if (selectAllVolumes.value) {
    selectedVolumes.value = volumesList.value.map(v => v.Name);
  } else {
    selectedVolumes.value = [];
  }
}

async function removeSelectedImages() {
  confirm.require({
    message: `Supprimer ${selectedImages.value.length} image(s) sélectionnée(s)? Cette action est irréversible.`,
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      removingImages.value = true;
      try {
        const response = await api.post('/system/docker/images/remove', {
          imageIds: selectedImages.value,
          force: false,
        });

        const results = response.data.data;
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success);

        if (successful > 0) {
          toast.add({
            severity: 'success',
            summary: 'Images supprimées',
            detail: `${successful} sur ${selectedImages.value.length} images supprimées`,
            life: 3000
          });
        }

        if (failed.length > 0) {
          const errorMessages = failed.map(f => f.error).join('\n');
          toast.add({
            severity: 'warn',
            summary: `${failed.length} image(s) non supprimée(s)`,
            detail: errorMessages,
            life: 6000
          });
        }

        selectedImages.value = [];
        selectAllDanglingImages.value = false;
        await loadDockerStats();
      } catch (error) {
        console.error('Failed to remove images:', error);
        toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: error.response?.data?.message || 'Échec de la suppression des images',
          life: 3000
        });
      } finally {
        removingImages.value = false;
      }
    }
  });
}

async function removeSelectedContainers() {
  confirm.require({
    message: `Supprimer ${selectedContainers.value.length} container(s) sélectionné(s)? Cette action est irréversible.`,
    header: 'Confirmation',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      removingContainers.value = true;
      try {
        const response = await api.post('/system/docker/containers/remove', {
          containerIds: selectedContainers.value,
        });

        const successful = response.data.data.filter(r => r.success).length;
        toast.add({
          severity: 'success',
          summary: 'Containers supprimés',
          detail: `${successful} sur ${selectedContainers.value.length} containers supprimés`,
          life: 3000
        });

        selectedContainers.value = [];
        selectAllStoppedContainers.value = false;
        await loadDockerStats();
      } catch (error) {
        console.error('Failed to remove containers:', error);
        toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Échec de la suppression des containers',
          life: 3000
        });
      } finally {
        removingContainers.value = false;
      }
    }
  });
}

async function removeSelectedVolumes() {
  confirm.require({
    message: `Supprimer ${selectedVolumes.value.length} volume(s) sélectionné(s)? Les données seront perdues définitivement.`,
    header: 'Attention',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      removingVolumes.value = true;
      try {
        const response = await api.post('/system/docker/volumes/remove', {
          volumeNames: selectedVolumes.value,
        });

        const successful = response.data.data.filter(r => r.success).length;
        toast.add({
          severity: 'success',
          summary: 'Volumes supprimés',
          detail: `${successful} sur ${selectedVolumes.value.length} volumes supprimés`,
          life: 3000
        });

        selectedVolumes.value = [];
        selectAllVolumes.value = false;
        await loadDockerStats();
      } catch (error) {
        console.error('Failed to remove volumes:', error);
        toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Échec de la suppression des volumes',
          life: 3000
        });
      } finally {
        removingVolumes.value = false;
      }
    }
  });
}

async function pruneCache() {
  confirm.require({
    message: 'Supprimer le build cache? Cela ralentira les prochains builds.',
    header: 'Confirmation',
    icon: 'pi pi-question-circle',
    acceptLabel: 'Supprimer',
    rejectLabel: 'Annuler',
    accept: async () => {
      pruningCache.value = true;
      try {
        const response = await api.post('/system/docker/prune-cache');
        const spaceFreed = response.data.data?.SpaceReclaimed || 0;

        toast.add({
          severity: 'success',
          summary: 'Cache nettoyé',
          detail: `${formatBytes(spaceFreed)} libérés`,
          life: 3000
        });

        await loadDockerStats();
      } catch (error) {
        console.error('Failed to prune cache:', error);
        toast.add({
          severity: 'error',
          summary: 'Erreur',
          detail: 'Échec du nettoyage du cache',
          life: 3000
        });
      } finally {
        pruningCache.value = false;
      }
    }
  });
}

function getImagesSize() {
  return dockerStats.value?.LayersSize || 0;
}

function getDanglingImagesSize() {
  return danglingImages.value.reduce((sum, img) => sum + (img.Size || 0), 0);
}

function getSelectedImagesSize() {
  return selectedImages.value.reduce((sum, id) => {
    const img = imagesList.value.find(i => i.Id === id);
    return sum + (img?.Size || 0);
  }, 0);
}

function getContainersSize() {
  return containersList.value.reduce((sum, c) => sum + (c.SizeRw || 0), 0);
}

function getVolumesSize() {
  return volumesList.value.reduce((sum, v) => sum + (v.UsageData?.Size || 0), 0);
}

function getSelectedVolumesSize() {
  return selectedVolumes.value.reduce((sum, name) => {
    const vol = volumesList.value.find(v => v.Name === name);
    return sum + (vol?.UsageData?.Size || 0);
  }, 0);
}

function getBuildCacheSize() {
  return dockerStats.value?.BuildCache?.reduce((sum, c) => sum + (c.Size || 0), 0) || 0;
}

function getReclaimableCacheSize() {
  return dockerStats.value?.BuildCache?.filter(c => !c.InUse).reduce((sum, c) => sum + (c.Size || 0), 0) || 0;
}

function getImagesPercentage() {
  const total = getTotalSize();
  return total > 0 ? Math.round((getImagesSize() / total) * 100) : 0;
}

function getContainersPercentage() {
  const total = getTotalSize();
  return total > 0 ? Math.round((getContainersSize() / total) * 100) : 0;
}

function getVolumesPercentage() {
  const total = getTotalSize();
  return total > 0 ? Math.round((getVolumesSize() / total) * 100) : 0;
}

function getCachePercentage() {
  const total = getTotalSize();
  return total > 0 ? Math.round((getBuildCacheSize() / total) * 100) : 0;
}

function formatAge(days) {
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function getRecommendationLabel(recommendation) {
  switch (recommendation) {
    case 'safe':
      return 'Safe to delete';
    case 'probably-safe':
      return 'Probably safe';
    case 'in-use':
      return 'In use';
    default:
      return 'Unknown';
  }
}
</script>
