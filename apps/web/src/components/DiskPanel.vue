<template>
  <section class="card">
    <div class="card-head">
      <div class="card-title"><HardDrive />Disk</div>
      <span v-if="disk" class="text-sm font-semibold tabular-nums">{{ formatSize(disk.totalBytes) }}</span>
    </div>
    <div class="card-body flex flex-col gap-3">
      <p v-if="!disk" class="field-hint">Not measured yet: the disk is measured every 15 minutes and after each build.</p>
      <template v-else>
        <div class="bar bar-lg">
          <span
            v-for="part in parts"
            :key="part.label"
            class="bar-fill"
            :style="{ width: `${share(part.bytes)}%`, background: part.color }"
            :title="`${part.label}: ${formatSize(part.bytes)}`"
          ></span>
        </div>
        <ul class="flex flex-col gap-1.5 text-sm">
          <li v-for="part in parts" :key="part.label" class="flex items-center justify-between gap-3">
            <span class="flex items-center gap-2 text-fg-2"><span class="swatch" :style="{ background: part.color }"></span>{{ part.label }}</span>
            <span class="tabular-nums">{{ formatSize(part.bytes) }}</span>
          </li>
          <li class="mt-1 flex items-center justify-between gap-3 border-t pt-2.5 text-fg-3">
            <span>Shared image layers, stored once for all</span>
            <span class="tabular-nums">{{ formatSize(disk.imagesSharedBytes) }}</span>
          </li>
        </ul>
        <p class="field-hint">Measured {{ timeAgo(measuredAt) }}, every 15 minutes and after each job.</p>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { HardDrive } from 'lucide-vue-next';
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
        { label: 'Own image layers', bytes: disk.value.imagesUniqueBytes, color: 'var(--svc-1)' },
        { label: 'Volumes (data)', bytes: disk.value.volumesBytes, color: 'var(--svc-2)' },
        { label: 'Written by the containers', bytes: disk.value.writableBytes, color: 'var(--svc-3)' },
        { label: 'Sources', bytes: disk.value.sourcesBytes, color: 'var(--svc-4)' },
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
