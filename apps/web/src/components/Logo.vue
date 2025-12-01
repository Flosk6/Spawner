<template>
  <div class="flex items-center gap-2.5">
    <img
      :src="logoUrl"
      :alt="alt"
      :class="sizeClass"
      class="object-contain"
    />
    <span
      v-if="showText"
      :class="textSizeClass"
      class="font-black tracking-tight bg-gradient-to-r from-purple-600 via-violet-600 to-indigo-600 dark:from-purple-400 dark:via-violet-400 dark:to-indigo-400 bg-clip-text text-transparent"
    >
      {{ text }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import logoUrl from '../assets/spawner-logo.png';

interface Props {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  text?: string;
  alt?: string;
}

const props = withDefaults(defineProps<Props>(), {
  size: 'md',
  showText: true,
  text: 'Spawner',
  alt: 'Spawner Logo'
});

const sizeClass = computed(() => {
  const sizes = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
    xl: 'h-24 w-24'
  };
  return sizes[props.size];
});

const textSizeClass = computed(() => {
  const sizes = {
    sm: 'text-2xl',
    md: 'text-3xl',
    lg: 'text-4xl',
    xl: 'text-6xl'
  };
  return sizes[props.size];
});
</script>
