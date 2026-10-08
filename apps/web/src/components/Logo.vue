<template>
  <span class="inline-flex items-center gap-2.5">
    <svg class="brand-mark" :width="size" :height="size" viewBox="0 0 32 32" aria-hidden="true">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M16 1c3.3 2.5 5 6.1 5 10.3V17H11v-5.7C11 7.1 12.7 3.5 16 1z M16 6.8a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z M11 11.8l-3.4 3.9V20l3.4-2.4z M21 11.8l3.4 3.9V20L21 17.6z M13.2 17h5.6l-.8 2h-4z"
      />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        d="M16 20.5v6.9 M16 20.5c0 2.3-1.9 3.1-4.1 3.1-1.9 0-2.9 1-2.9 2.6 M16 20.5c0 2.3 1.9 3.1 4.1 3.1 1.9 0 2.9 1 2.9 2.6"
      />
      <path fill="currentColor" d="M9 29.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M23 29.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M16 31.4a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
    </svg>
    <span v-if="showText" class="wordmark" :style="{ fontSize: `${textSize}px` }">Spawner</span>
  </span>
</template>

<script setup lang="ts">
/** The mark (a rocket above three branches) in the violet of the brand, and the wordmark. */
withDefaults(defineProps<{ size?: number; showText?: boolean; textSize?: number }>(), { size: 26, showText: true, textSize: 18 });
</script>
