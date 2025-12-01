<template>
  <div class="min-h-screen">
    <Toast />
    <ConfirmDialog />

    <!-- Modern Header -->
    <header v-if="authStore.isAuthenticated" class="sticky top-0 z-50 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 backdrop-blur-sm bg-opacity-90 dark:bg-opacity-90">
      <div class="px-6 py-3">
        <div class="flex items-center justify-between">
          <!-- Logo -->
          <router-link to="/" class="flex items-center gap-1 hover:opacity-80 transition-opacity">
            <Logo size="md" :show-text="true" />
          </router-link>

          <!-- Navigation -->
          <nav class="flex items-center gap-1">
            <router-link
              v-for="item in menuItems"
              :key="item.label"
              :to="item.path"
              class="group relative px-4 py-2 rounded-lg font-medium transition-all duration-200"
              :class="[
                isActive(item.path)
                  ? 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/50'
              ]"
            >
              <div class="flex items-center gap-2">
                <i :class="item.icon" class="text-sm"></i>
                <span>{{ item.label }}</span>
              </div>
              <!-- Active indicator -->
              <div
                v-if="isActive(item.path)"
                class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-purple-600 to-violet-600 rounded-full"
              ></div>
            </router-link>
          </nav>

          <!-- User Menu -->
          <div class="flex items-center gap-3">
            <UserMenu v-if="authStore.user" :user="authStore.user" />
          </div>
        </div>
      </div>
    </header>

    <main class="p-6">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useAuthStore } from './stores/auth';
import UserMenu from './components/UserMenu.vue';
import Logo from './components/Logo.vue';

const authStore = useAuthStore();
const route = useRoute();

const menuItems = computed(() => [
  {
    label: 'Environments',
    icon: 'pi pi-server',
    path: '/environments'
  },
  {
    label: 'Projects',
    icon: 'pi pi-folder',
    path: '/projects'
  },
  {
    label: 'Git Settings',
    icon: 'pi pi-key',
    path: '/settings/git'
  },
  {
    label: 'Docker',
    icon: 'pi pi-box',
    path: '/docker'
  },
  {
    label: 'System',
    icon: 'pi pi-cog',
    path: '/settings/system'
  }
]);

function isActive(path: string): boolean {
  return route.path.startsWith(path);
}

onMounted(() => {
  authStore.checkAuth();
});
</script>
