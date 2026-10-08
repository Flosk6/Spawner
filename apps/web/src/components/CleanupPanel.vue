<template>
  <section class="card">
    <div class="card-head">
      <div class="card-title"><Eraser />Cleanup<span v-if="scan && scan.items.length > 0" class="count">{{ scan.items.length }}</span></div>
      <button v-if="scan && scan.items.length > 0" type="button" class="btn btn-danger btn-sm" :disabled="running" @click="confirmRun">
        <LoaderCircle v-if="running" class="spinner" /><Trash2 v-else />Clean up
      </button>
    </div>
    <div class="card-body flex flex-col gap-3">
      <p class="field-hint">
        Spawner only removes what carries its labels or lives in its data directory, never anything else of the server. What deleted environments
        leave behind goes every minute anyway; the rest waits for you: resources labelled for environments this Spawner does not know may belong to
        another installation.
      </p>
      <div v-if="!scan" class="flex justify-center py-10"><LoaderCircle class="spinner size-6 text-fg-3" /></div>
      <p v-else-if="scan.items.length === 0" class="text-sm text-fg-2">Nothing to clean up.</p>
    </div>
    <div v-if="scan && scan.items.length > 0" class="table-wrap border-t">
      <table class="table is-compact">
        <thead>
          <tr>
            <th>What</th>
            <th class="hidden md:table-cell">Why it can go</th>
            <th class="text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in scan.items" :key="`${item.kind}-${item.id}`">
            <td>
              <div class="flex items-center gap-2">
                <span class="badge badge-sm flex-none">{{ item.kind }}</span>
                <span class="min-w-0 break-all font-mono text-sm">{{ item.name }}</span>
              </div>
              <div class="mt-1 text-fg-2 md:hidden">
                {{ item.reason }}
                <span v-if="!item.automatic" class="badge badge-sm tone-warn ml-1">waits for you</span>
              </div>
            </td>
            <td class="hidden text-fg-2 md:table-cell">
              {{ item.reason }}
              <span v-if="!item.automatic" class="badge badge-sm tone-warn ml-1">waits for you</span>
            </td>
            <td class="whitespace-nowrap text-right tabular-nums">{{ item.sizeBytes === null ? '-' : formatSize(item.sizeBytes) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="scan && scan.totalBytes > 0" class="card-foot">{{ formatSize(scan.totalBytes) }} to free, volumes and networks aside.</div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Eraser, LoaderCircle, Trash2 } from 'lucide-vue-next';
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
  confirmAction(
    'Containers, volumes and images removed this way cannot come back.',
    async () => {
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
    },
    { header: count === 1 ? 'Remove this item?' : `Remove these ${count} items?`, acceptLabel: 'Clean up', danger: true },
  );
}

onMounted(load);
</script>
