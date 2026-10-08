<template>
  <div class="seg" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      class="seg-btn"
      :class="{ 'is-active': option.value === modelValue }"
      :aria-pressed="option.value === modelValue"
      :title="option.title"
      @click="emit('update:modelValue', option.value)"
    >
      <component :is="option.icon" v-if="option.icon" />{{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number | null">
import type { Component } from 'vue';

/** A small group of mutually exclusive choices, such as a range or a scope. */
defineProps<{
  modelValue: T;
  options: { label: string; value: T; icon?: Component; title?: string }[];
  label?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: T] }>();
</script>
