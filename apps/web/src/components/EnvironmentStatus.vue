<template>
  <span class="badge" :class="`tone-${tone}`"><span class="dot"></span>{{ statusLabel(status) }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EnvironmentStatus } from '../types';
import { STATUS_TONES, statusLabel, statusTone } from '../utils/environment';

const props = defineProps<{ status: EnvironmentStatus }>();

const tone = computed(() => STATUS_TONES[statusTone(props.status)]);
</script>
