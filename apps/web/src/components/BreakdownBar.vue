<template>
  <div class="flex flex-col gap-3">
    <div class="bar bar-lg">
      <span
        v-for="part in visible"
        :key="part.label"
        class="bar-fill"
        :style="{ width: `${(part.bytes / Math.max(total, 1)) * 100}%`, background: part.color }"
        :title="`${part.label}: ${formatSize(part.bytes)}`"
      ></span>
    </div>
    <ul class="flex flex-col gap-1.5 text-sm">
      <li v-for="part in parts" :key="part.label" class="flex items-center justify-between gap-3">
        <span class="flex min-w-0 items-center gap-2 text-fg-2">
          <span class="swatch" :class="{ 'border border-line-strong': part.color === 'transparent' }" :style="{ background: part.color }"></span>
          <span class="truncate">{{ part.label }}</span>
        </span>
        <span class="flex-none font-mono text-xs">{{ formatSize(part.bytes) }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { formatSize } from '../utils/palette';

/**
 * The parts of a whole (memory, disk) on one bar, then their legend. A part
 * colored "transparent", what is free, stays out of the bar, whose empty end
 * stands for it, and keeps its row in the legend.
 */
const props = defineProps<{ parts: { label: string; bytes: number; color: string }[]; total: number }>();

const visible = computed(() => props.parts.filter((part) => part.color !== 'transparent' && part.bytes > 0));
</script>
