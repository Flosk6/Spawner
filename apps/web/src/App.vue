<template>
  <div class="min-h-screen bg-slate-50 dark:bg-transparent">
    <Toast />
    <ConfirmDialog />

    <!-- Modern Header -->
    <header v-if="authStore.isAuthenticated" class="sticky top-0 z-50 bg-white/90 dark:bg-dark-900/90 border-b border-slate-200 dark:border-purple-900/30 backdrop-blur-md">
      <div class="px-6 py-3">
        <div class="flex items-center justify-between">
          <!-- Logo -->
          <router-link to="/" class="flex items-center gap-1 hover:opacity-80 transition-opacity">
            <Logo size="md" :show-text="true" />
          </router-link>

          <!-- Navigation -->
          <nav class="flex items-center gap-1">
            <template v-for="item in menuItems" :key="item.label">
              <!-- Item with submenu -->
              <div v-if="item.submenu" class="relative group">
                <div
                  class="px-4 py-2 rounded-lg font-medium transition-all duration-200 cursor-pointer"
                  :class="[
                    isActive(item.path)
                      ? 'text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-500/10'
                  ]"
                >
                  <div class="flex items-center gap-2">
                    <i :class="item.icon" class="text-sm"></i>
                    <span>{{ item.label }}</span>
                    <i class="pi pi-angle-down text-xs"></i>
                  </div>
                  <!-- Active indicator -->
                  <div
                    v-if="isActive(item.path)"
                    class="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-gradient-to-r from-purple-600 to-violet-600 rounded-full"
                  ></div>
                </div>

                <!-- Dropdown submenu -->
                <div class="absolute top-full left-0 mt-1 min-w-[160px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                  <div class="bg-white dark:bg-dark-800 rounded-lg shadow-lg border border-slate-200 dark:border-purple-800/30 py-1">
                    <router-link
                      v-for="subitem in item.submenu"
                      :key="subitem.label"
                      :to="subitem.path"
                      class="block px-4 py-2 text-sm transition-colors"
                      :class="[
                        route.path === subitem.path
                          ? 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-300'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-purple-500/10'
                      ]"
                    >
                      {{ subitem.label }}
                    </router-link>
                  </div>
                </div>
              </div>

              <!-- Regular item without submenu -->
              <router-link
                v-else
                :to="item.path"
                class="group relative px-4 py-2 rounded-lg font-medium transition-all duration-200"
                :class="[
                  isActive(item.path)
                    ? 'text-purple-600 dark:text-purple-300 bg-purple-50 dark:bg-purple-500/10'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-purple-500/10'
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
            </template>
          </nav>

          <!-- Theme Toggle & User Menu -->
          <div class="flex items-center gap-3">
            <button
              @click="toggleTheme"
              class="p-2 rounded-lg transition-all duration-200 hover:bg-slate-100 dark:hover:bg-purple-500/10"
              :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
            >
              <i v-if="isDark" class="pi pi-sun text-xl text-yellow-400"></i>
              <i v-else class="pi pi-moon text-xl text-slate-600"></i>
            </button>
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
import { onMounted, computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import { useAuthStore } from './stores/auth';
import UserMenu from './components/UserMenu.vue';
import Logo from './components/Logo.vue';

const authStore = useAuthStore();
const route = useRoute();
const isDark = ref(true);

const menuItems = computed(() => [
  {
    label: 'Home',
    icon: 'pi pi-home',
    path: '/home'
  },
  {
    label: 'Projects',
    icon: 'pi pi-folder',
    path: '/projects'
  },
  {
    label: 'Environments',
    icon: 'pi pi-sitemap',
    path: '/environments'
  },
  {
    label: 'System',
    icon: 'pi pi-cog',
    path: '/system',
    submenu: [
      { label: 'Overview', path: '/system/overview' },
      { label: 'Docker', path: '/system/docker' },
      { label: 'Git Keys', path: '/system/settings/git' },
      { label: 'Settings', path: '/system/settings' },
    ]
  }
]);

function isActive(path: string): boolean {
  if (path === '/system') {
    return route.path.startsWith('/system');
  }
  return route.path.startsWith(path);
}

function toggleTheme() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.documentElement.classList.add('dark');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', 'light');
  }
}

onMounted(() => {
  authStore.checkAuth();

  // Check saved theme preference or system preference
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme === 'light' || (!savedTheme && !systemPrefersDark)) {
    isDark.value = false;
    document.documentElement.classList.remove('dark');
  } else {
    isDark.value = true;
    document.documentElement.classList.add('dark');
  }
});
</script>
