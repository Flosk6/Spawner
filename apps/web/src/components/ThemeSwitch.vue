<template>
  <div class="seg w-full" role="group" aria-label="Theme">
    <button
      v-for="option in OPTIONS"
      :key="option.value"
      type="button"
      class="seg-btn flex-1"
      :class="{ 'is-active': preference === option.value }"
      :aria-pressed="preference === option.value"
      :aria-label="option.label"
      :title="option.label"
      @click="setPreference(option.value)"
    >
      <component :is="option.icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Monitor, Moon, Sun } from 'lucide-vue-next';
import { useTheme, type ThemePreference } from '../composables/useTheme';

const OPTIONS: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'Follow the system', icon: Monitor },
];

const { preference, setPreference } = useTheme();
</script>
