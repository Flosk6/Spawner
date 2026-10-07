<template>
  <div>
    <div class="flex h-2.5 rounded-full overflow-hidden bg-slate-200 dark:bg-dark-700">
      <div
        v-for="part in visible"
        :key="part.label"
        :style="{ width: `${(part.bytes / Math.max(total, 1)) * 100}%`, background: part.color }"
        :title="`${part.label}: ${formatSize(part.bytes)}`"
      ></div>
    </div>
    <ul class="mt-3 space-y-1 text-sm">
      <li v-for="part in parts" :key="part.label" class="flex items-center justify-between gap-3">
        <span class="flex items-center gap-2">
          <span class="h-2.5 w-2.5 rounded-sm border border-slate-300 dark:border-slate-600" :style="{ background: part.color }"></span>{{ part.label }}
        </span>
        <span class="font-mono text-xs">{{ formatSize(part.bytes) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatSize } from '../utils/palette';

const props = defineProps<{ parts: { label: string; bytes: number; color: string }[]; total: number }>();

const visible = computed(() => props.parts.filter((part) => part.color !== 'transparent' && part.bytes > 0));
</script>
