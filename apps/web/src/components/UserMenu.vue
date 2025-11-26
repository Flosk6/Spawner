<template>
  <div class="relative" ref="menuRef">
    <button @click="isOpen = !isOpen"
      class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-700 hover:text-white transition-colors">
      <img v-if="user.avatarUrl" :src="user.avatarUrl" :alt="user.username" class="w-8 h-8 rounded-full" />
      <div v-else class="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center">
        <span class="text-white font-medium">{{ user.username[0].toUpperCase() }}</span>
      </div>
      <span class="text-primary font-medium">{{ user.username }}</span>
      <svg class="w-4 h-4 text-gray-400 transition-transform" :class="{ 'rotate-180': isOpen }" fill="none"
        stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
      </svg>
    </button>

    <div v-if="isOpen"
      class="absolute right-0 mt-2 w-48 bg-gray-800 rounded-lg shadow-xl border border-gray-700 py-1 z-50">
      <div class="px-4 py-2 border-b border-gray-700">
        <p class="text-sm text-gray-400">Signed in as</p>
        <p class="text-sm font-medium text-white truncate">{{ user.username }}</p>
      </div>
      <button @click="handleLogout"
        class="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
        Logout
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useAuthStore } from '../stores/auth';
import type { User } from '@spawner/types';

interface Props {
  user: User;
}

defineProps<Props>();

const authStore = useAuthStore();
const isOpen = ref(false);
const menuRef = ref<HTMLElement | null>(null);

function handleLogout() {
  authStore.logout();
}

function handleClickOutside(event: MouseEvent) {
  if (menuRef.value && !menuRef.value.contains(event.target as Node)) {
    isOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>
