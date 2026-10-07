<template>
  <div>
    <p v-if="!disk" class="text-sm text-slate-500">Not measured yet: the disk is measured every 15 minutes and after each build.</p>
    <template v-else>
      <div class="flex items-baseline justify-between mb-3">
        <span class="text-2xl font-bold">{{ formatSize(disk.totalBytes) }}</span>
        <span class="text-xs text-slate-500">measured {{ timeAgo(measuredAt) }}</span>
      </div>
      <div class="flex h-2.5 rounded-full overflow-hidden bg-slate-200 dark:bg-dark-700 mb-4">
        <div v-for="part in parts" :key="part.label" :style="{ width: `${share(part.bytes)}%`, background: part.color }" :title="`${part.label}: ${formatSize(part.bytes)}`"></div>
      </div>
      <ul class="space-y-1.5 text-sm">
        <li v-for="part in parts" :key="part.label" class="flex items-center justify-between gap-3">
          <span class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-sm" :style="{ background: part.color }"></span>{{ part.label }}</span>
          <span class="font-mono text-xs">{{ formatSize(part.bytes) }}</span>
        </li>
        <li class="flex items-center justify-between gap-3 text-slate-500 pt-2 border-t border-slate-200 dark:border-purple-800/30">
          <span>Shared image layers (stored once for all)</span>
          <span class="font-mono text-xs">{{ formatSize(disk.imagesSharedBytes) }}</span>
        </li>
      </ul>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { environmentsApi } from '../services/api';
import type { EnvironmentDisk } from '../types';
import { timeAgo } from '../utils/format';
import { formatSize } from '../utils/palette';

const props = defineProps<{ environmentId: string }>();

const disk = ref<EnvironmentDisk | null>(null);
const measuredAt = ref<string | null>(null);

const parts = computed(() =>
  disk.value
    ? [
        { label: 'Own image layers', bytes: disk.value.imagesUniqueBytes, color: '#8b5cf6' },
        { label: 'Volumes (data)', bytes: disk.value.volumesBytes, color: '#06b6d4' },
        { label: 'Written by the containers', bytes: disk.value.writableBytes, color: '#f59e0b' },
        { label: 'Sources', bytes: disk.value.sourcesBytes, color: '#10b981' },
      ]
    : [],
);

function share(bytes: number): number {
  return disk.value && disk.value.totalBytes > 0 ? (bytes / disk.value.totalBytes) * 100 : 0;
}

onMounted(async () => {
  const result = await environmentsApi.disk(props.environmentId).catch(() => null);
  disk.value = result?.disk ?? null;
  measuredAt.value = result?.measuredAt ?? null;
});
</script>
