<template>
  <Toast position="bottom-right" />
  <ConfirmDialog :style="{ width: 'min(28rem, calc(100vw - 2rem))' }">
    <template #container="{ message, acceptCallback, rejectCallback }">
      <div class="confirm">
        <div class="confirm-head">
          <span class="confirm-icon" :class="{ 'tone-danger': message.acceptClass === 'danger' }"><TriangleAlert /></span>
          <h2 class="confirm-title">{{ message.header }}</h2>
        </div>
        <p class="confirm-text">{{ message.message }}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-ghost" @click="rejectCallback">{{ message.rejectLabel }}</button>
          <button type="button" class="btn" :class="message.acceptClass === 'danger' ? 'btn-danger-solid' : 'btn-primary'" @click="acceptCallback">
            {{ message.acceptLabel }}
          </button>
        </div>
      </div>
    </template>
  </ConfirmDialog>

  <div v-if="shell" class="app-shell">
    <AppSidebar :open="navigationOpen" @close="navigationOpen = false" />
    <div class="app-main">
      <AppTopbar @menu="navigationOpen = true" />
      <main class="app-page">
        <RouterView />
      </main>
    </div>
    <CommandPalette />
  </div>
  <RouterView v-else />
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ConfirmDialog from 'primevue/confirmdialog';
import Toast from 'primevue/toast';
import { TriangleAlert } from 'lucide-vue-next';
import AppSidebar from './components/AppSidebar.vue';
import AppTopbar from './components/AppTopbar.vue';
import CommandPalette from './components/CommandPalette.vue';
import { useBreadcrumbs } from './composables/useBreadcrumbs';
import { useTheme } from './composables/useTheme';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const authStore = useAuthStore();
const crumbs = useBreadcrumbs();
const navigationOpen = ref(false);

useTheme();

/** Sign-in pages and the CLI approval stand alone, without the sidebar. */
const shell = computed(() => authStore.isAuthenticated && route.meta.layout !== 'focus');

watch(
  () => route.fullPath,
  () => (navigationOpen.value = false),
);

watch(
  crumbs,
  (trail) => {
    const page = trail[trail.length - 1]?.label;
    document.title = page ? `${page} · Spawner` : 'Spawner';
  },
  { immediate: true },
);

onMounted(() => authStore.checkAuth());
</script>
