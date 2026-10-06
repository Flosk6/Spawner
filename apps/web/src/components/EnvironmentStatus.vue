<template>
  <span class="inline-flex items-center gap-2">
    <span class="relative flex h-2.5 w-2.5">
      <span v-if="tone === 'busy'" :class="['animate-ping absolute inline-flex h-full w-full rounded-full opacity-75', classes.dot]"></span>
      <span :class="['relative inline-flex rounded-full h-2.5 w-2.5', classes.dot]"></span>
    </span>
    <span :class="['text-xs font-semibold uppercase tracking-wider', classes.text]">{{ status }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EnvironmentStatus } from '../types';
import { TONE_CLASSES, statusTone } from '../utils/environment';

const props = defineProps<{ status: EnvironmentStatus }>();

const tone = computed(() => statusTone(props.status));
const classes = computed(() => TONE_CLASSES[tone.value]);
</script>
