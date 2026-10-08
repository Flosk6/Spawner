<template>
  <header class="app-topbar">
    <button type="button" class="btn btn-ghost btn-icon -ml-2 lg:hidden" aria-label="Open the navigation" @click="emit('menu')">
      <MenuIcon />
    </button>
    <nav class="crumbs" aria-label="Breadcrumb">
      <template v-for="(crumb, index) in crumbs" :key="`${index}-${crumb.label}`">
        <span v-if="index > 0" class="crumb-sep" aria-hidden="true">/</span>
        <RouterLink v-if="crumb.to && index < crumbs.length - 1" :to="crumb.to" class="crumb">{{ crumb.label }}</RouterLink>
        <span v-else class="crumb-current" aria-current="page">{{ crumb.label }}</span>
      </template>
    </nav>
    <div class="flex-1"></div>
    <RouterLink
      v-if="availableUpdate && route.path !== '/system/overview'"
      to="/system/overview"
      class="btn btn-ghost btn-sm text-accent-text lg:hidden"
      :title="`Spawner ${availableUpdate} is available`"
    >
      <CircleArrowUp />Update
    </RouterLink>
    <a class="btn btn-ghost btn-sm hidden sm:inline-flex" :href="docsUrl" target="_blank" rel="noopener"><BookOpen />Docs</a>
  </header>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { BookOpen, CircleArrowUp, Menu as MenuIcon } from 'lucide-vue-next';
import { useAvailableUpdate } from '../composables/useAvailableUpdate';
import { useBreadcrumbs } from '../composables/useBreadcrumbs';
import { useServerInfo } from '../composables/useServerInfo';

const emit = defineEmits<{ menu: [] }>();

const route = useRoute();
const crumbs = useBreadcrumbs();
const info = useServerInfo();
/** On screens where the sidebar is a drawer, the top bar tells admins about a newer Spawner. */
const availableUpdate = useAvailableUpdate();

/** The documentation of the version running, which may differ from the latest one. */
const docsUrl = computed(() => `https://github.com/Flosk6/Spawner/tree/${info.value ? `v${info.value.version}` : 'master'}/docs`);
</script>
