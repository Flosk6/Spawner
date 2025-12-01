<template>
  <div class="relative" ref="menuRef">
    <button
      @click="isOpen = !isOpen"
      class="flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 hover:bg-slate-100 dark:hover:bg-slate-800/50"
    >
      <img
        v-if="user.avatarUrl"
        :src="user.avatarUrl"
        :alt="user.username"
        class="w-8 h-8 rounded-full ring-2 ring-slate-200 dark:ring-slate-700"
      />
      <div
        v-else
        class="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center ring-2 ring-slate-200 dark:ring-slate-700"
      >
        <span class="text-white font-semibold text-sm">{{ user.username[0].toUpperCase() }}</span>
      </div>
      <span class="font-medium text-slate-700 dark:text-slate-300">{{ user.username }}</span>
      <i
        class="pi pi-chevron-down text-xs text-slate-400 transition-transform duration-200"
        :class="{ 'rotate-180': isOpen }"
      ></i>
    </button>

    <Transition
      enter-active-class="transition ease-out duration-100"
      enter-from-class="transform opacity-0 scale-95"
      enter-to-class="transform opacity-100 scale-100"
      leave-active-class="transition ease-in duration-75"
      leave-from-class="transform opacity-100 scale-100"
      leave-to-class="transform opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50"
      >
        <div class="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/20 dark:to-violet-950/20">
          <div class="flex items-center gap-3">
            <img
              v-if="user.avatarUrl"
              :src="user.avatarUrl"
              :alt="user.username"
              class="w-12 h-12 rounded-full ring-2 ring-purple-200 dark:ring-purple-700"
            />
            <div
              v-else
              class="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center ring-2 ring-purple-200 dark:ring-purple-700"
            >
              <span class="text-white font-bold text-lg">{{ user.username[0].toUpperCase() }}</span>
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-semibold text-slate-900 dark:text-white truncate">{{ user.username }}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400">{{ user.email || 'GitHub User' }}</p>
            </div>
          </div>
        </div>

        <div class="p-2">
          <button
            @click="handleLogout"
            class="w-full text-left px-3 py-2 text-sm font-medium rounded-lg transition-all duration-200 flex items-center gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20"
          >
            <i class="pi pi-sign-out text-sm"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </Transition>
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
