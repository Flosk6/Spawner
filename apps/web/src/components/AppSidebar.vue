<template>
  <div class="app-scrim" :class="{ 'is-open': open }" @click="emit('close')"></div>
  <aside class="app-sidebar" :class="{ 'is-open': open }" aria-label="Navigation">
    <div class="flex flex-col gap-3">
      <RouterLink to="/home" class="side-brand" aria-label="Spawner, overview" @click="emit('close')">
        <Logo />
      </RouterLink>
      <div v-if="info" class="side-server" :title="`Spawner ${info.version} on ${info.previewDomain}`">
        <span class="dot tone-ok"></span>
        <span class="min-w-0 truncate font-mono text-[11.5px] text-fg-2">{{ info.previewDomain }}</span>
        <span>v{{ info.version }}</span>
      </div>
      <button type="button" class="side-search" @click="palette.show()">
        <Search class="size-4" />
        <span>Search</span>
        <span class="kbd ml-auto">{{ shortcut }}</span>
      </button>
    </div>

    <nav class="side-nav">
      <div class="side-group">
        <RouterLink
          v-for="item in MAIN"
          :key="item.to"
          :to="item.to"
          class="side-item"
          :class="{ 'is-active': isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          @click="emit('close')"
        >
          <component :is="item.icon" />{{ item.label }}
        </RouterLink>
      </div>
      <div v-if="authStore.isAdmin" class="side-group">
        <div class="side-label">Admin</div>
        <RouterLink
          v-for="item in ADMIN"
          :key="item.to"
          :to="item.to"
          class="side-item"
          :class="{ 'is-active': isActive(item.to) }"
          :aria-current="isActive(item.to) ? 'page' : undefined"
          @click="emit('close')"
        >
          <component :is="item.icon" />{{ item.label }}
        </RouterLink>
      </div>
    </nav>

    <div class="side-foot">
      <RouterLink v-if="availableUpdate" to="/system/overview" class="side-update" @click="emit('close')">
        <CircleArrowUp class="size-4" />Spawner {{ availableUpdate }} is available
      </RouterLink>
      <ThemeSwitch />
      <UserMenu v-if="authStore.user" :user="authStore.user" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { CircleArrowUp, FolderGit2, KeyRound, Layers, LayoutDashboard, ScrollText, Search, Server, SlidersHorizontal, Users } from 'lucide-vue-next';
import Logo from './Logo.vue';
import ThemeSwitch from './ThemeSwitch.vue';
import UserMenu from './UserMenu.vue';
import { usePalette } from '../composables/usePalette';
import { useServerInfo } from '../composables/useServerInfo';
import { systemApi } from '../services/api';
import { useAuthStore } from '../stores/auth';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const MAIN = [
  { label: 'Overview', to: '/home', icon: LayoutDashboard },
  { label: 'Environments', to: '/environments', icon: Layers },
  { label: 'Projects', to: '/projects', icon: FolderGit2 },
];

const ADMIN = [
  { label: 'Team', to: '/team', icon: Users },
  { label: 'System', to: '/system/overview', icon: Server },
  { label: 'Settings', to: '/system/settings', icon: SlidersHorizontal },
  { label: 'Git keys', to: '/system/settings/git', icon: KeyRound },
  { label: 'Audit', to: '/system/audit', icon: ScrollText },
];

const route = useRoute();
const authStore = useAuthStore();
const palette = usePalette();
const info = useServerInfo();
const availableUpdate = ref<string | null>(null);
const shortcut = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';

/** The settings page is under /system too: the longest matching entry wins. */
function isActive(path: string): boolean {
  const matches = [...MAIN, ...ADMIN].filter((item) => route.path === item.to || route.path.startsWith(`${item.to}/`));
  return matches.sort((a, b) => b.to.length - a.to.length)[0]?.to === path;
}

// Admins learn here that a newer Spawner can be installed from the System page.
watch(
  () => authStore.isAdmin,
  async (admin) => {
    availableUpdate.value = null;
    if (!admin) {
      return;
    }
    const status = await systemApi.update().catch(() => null);
    availableUpdate.value = status?.latest && status.managed ? status.latest.version : null;
  },
  { immediate: true },
);
</script>
