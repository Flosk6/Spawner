<template>
  <span class="avatar" :class="{ 'avatar-sm': small }" :style="user.avatarUrl ? undefined : { background: color }" :title="user.name">
    <img v-if="user.avatarUrl" :src="user.avatarUrl" alt="" />
    <template v-else>{{ initial }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

/** Fills that keep white initials above 4.5:1, in both themes. */
const COLORS = ['#574b89', '#0e7490', '#b45309', '#047857', '#be185d', '#1d4ed8', '#6d28d9', '#c2410c'];

const props = defineProps<{ user: { id?: number; name: string; avatarUrl?: string | null }; small?: boolean }>();

const initial = computed(() => props.user.name.trim().charAt(0).toUpperCase() || '?');

/** The same person keeps the same color everywhere: by id, or by name for an owner known by name only. */
const color = computed(() => {
  const key = props.user.id ?? [...props.user.name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return COLORS[Math.abs(key) % COLORS.length];
});
</script>
