<template>
  <section class="panel">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
      <h2 class="panel-title !mb-0"><i class="pi pi-eraser text-sm"></i>Cleanup</h2>
      <Button
        v-if="scan && scan.items.length > 0"
        label="Clean up"
        icon="pi pi-trash"
        severity="danger"
        outlined
        size="small"
        :loading="running"
        @click="confirmRun"
      />
    </div>
    <p class="field-hint mb-4">
      Spawner only removes what carries its labels or lives in its data directory, never anything else of the server. What deleted environments leave behind
      goes every minute anyway; the rest waits for you: resources labelled for environments this Spawner does not know may belong to another installation.
    </p>
    <div v-if="!scan" class="flex justify-center py-6"><ProgressSpinner style="width: 2rem; height: 2rem" /></div>
    <p v-else-if="scan.items.length === 0" class="text-sm text-slate-500">Nothing to clean up.</p>
    <table v-else class="w-full text-sm">
      <thead class="text-left text-xs uppercase text-slate-500">
        <tr>
          <th class="py-2 pr-4">What</th>
          <th class="py-2 pr-4">Why it can go</th>
          <th class="py-2 text-right">Size</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
        <tr v-for="item in scan.items" :key="`${item.kind}-${item.id}`">
          <td class="py-2 pr-4">
            <span class="text-xs text-slate-500 mr-2">{{ item.kind }}</span>
            <span class="font-mono text-xs break-all">{{ item.name }}</span>
          </td>
          <td class="py-2 pr-4 text-slate-600 dark:text-slate-400">
            {{ item.reason }}
            <span v-if="!item.automatic" class="ml-1 text-xs font-medium text-amber-600 dark:text-amber-400">waits for you</span>
          </td>
          <td class="py-2 text-right font-mono text-xs">{{ item.sizeBytes === null ? '-' : formatSize(item.sizeBytes) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-if="scan && scan.totalBytes > 0" class="text-sm text-slate-500 mt-3">{{ formatSize(scan.totalBytes) }} to free, volumes and networks aside.</p>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import ProgressSpinner from 'primevue/progressspinner';
import { useNotification } from '../composables/useNotification';
import { errorMessage, systemApi } from '../services/api';
import type { CleanupScan } from '../types';
import { formatSize } from '../utils/palette';

const { showError, showSuccess, confirmAction } = useNotification();
const scan = ref<CleanupScan | null>(null);
const running = ref(false);

async function load() {
  try {
    scan.value = await systemApi.cleanup();
  } catch (err) {
    showError(errorMessage(err, 'The cleanup could not be listed'));
  }
}

function confirmRun() {
  const count = scan.value?.items.length ?? 0;
  confirmAction(`Remove these ${count} item${count > 1 ? 's' : ''}? Containers, volumes and images removed this way cannot come back.`, async () => {
    running.value = true;
    try {
      const result = await systemApi.runCleanup();
      if (result.failed.length > 0) {
        showError(`${result.failed.length} could not be removed: ${result.failed.map((item) => `${item.name} (${item.error})`).join(', ')}`);
      }
      showSuccess(`Removed ${result.removed.length} item${result.removed.length > 1 ? 's' : ''}, ${formatSize(result.freedBytes)} freed`);
      await load();
    } catch (err) {
      showError(errorMessage(err, 'The cleanup failed'));
    } finally {
      running.value = false;
    }
  });
}

onMounted(load);
</script>
