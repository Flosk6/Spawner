<template>
  <div class="min-h-screen">
    <Toast />
    <ConfirmDialog />

    <Menubar v-if="authStore.isAuthenticated" :model="menuItems" class="border-none rounded-none sticky top-0 z-50">
      <template #start>
        <router-link to="/" class="flex items-center gap-1 hover:opacity-80 transition-opacity">
          <Logo size="md" :show-text="true" />
        </router-link>
      </template>
      <template #end>
        <div class="flex items-center gap-3">
          <!-- <Button :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'" :label="isDark ? 'Light' : 'Dark'" text rounded
            @click="toggleTheme" v-tooltip.bottom="isDark ? 'Switch to light mode' : 'Switch to dark mode'" /> -->
          <UserMenu v-if="authStore.user" :user="authStore.user" />
        </div>
      </template>
    </Menubar>

    <main class="p-6">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import Toast from 'primevue/toast';
import ConfirmDialog from 'primevue/confirmdialog';
import Menubar from 'primevue/menubar';
import { useAuthStore } from './stores/auth';
import UserMenu from './components/UserMenu.vue';
import Logo from './components/Logo.vue';

const authStore = useAuthStore();
const router = useRouter();

const menuItems = computed(() => [
  {
    label: 'Environments',
    icon: 'pi pi-server',
    command: () => router.push('/environments')
  },
  {
    label: 'Projects',
    icon: 'pi pi-folder',
    command: () => router.push('/projects')
  },
  {
    label: 'Git Settings',
    icon: 'pi pi-key',
    command: () => router.push('/settings/git')
  },
  {
    label: 'Docker',
    icon: 'pi pi-box',
    command: () => router.push('/docker')
  },
  {
    label: 'System',
    icon: 'pi pi-cog',
    command: () => router.push('/settings/system')
  }
]);

onMounted(() => {
  authStore.checkAuth();
});
</script>
