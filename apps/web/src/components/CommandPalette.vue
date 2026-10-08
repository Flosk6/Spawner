<template>
  <Teleport to="body">
    <div v-if="open" class="palette-backdrop" @mousedown.self="hide()">
      <div class="palette" role="dialog" aria-modal="true" aria-label="Search" @keydown.esc.prevent="hide()">
        <div class="palette-search">
          <Search />
          <input
            ref="input"
            v-model="query"
            class="palette-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            :aria-activedescendant="active ? `palette-${active.id}` : undefined"
            placeholder="Search environments, projects and pages"
            autocomplete="off"
            spellcheck="false"
            @keydown="onKey"
          />
        </div>
        <div id="palette-results" class="palette-list" role="listbox" aria-label="Results">
          <template v-for="group in groups" :key="group.label">
            <div class="palette-label">{{ group.label }}</div>
            <button
              v-for="item in group.items"
              :id="`palette-${item.id}`"
              :key="item.id"
              type="button"
              role="option"
              class="palette-item"
              :class="{ 'is-active': item.id === active?.id }"
              :aria-selected="item.id === active?.id"
              @mousemove="activeId = item.id"
              @click="run(item)"
            >
              <span v-if="item.tone" class="flex size-4 items-center justify-center"><span class="dot" :class="`tone-${item.tone}`"></span></span>
              <component :is="item.icon" v-else-if="item.icon" />
              <span class="truncate">{{ item.label }}</span>
              <span v-if="item.hint" class="palette-hint">{{ item.hint }}</span>
            </button>
          </template>
          <div v-if="groups.length === 0" class="empty">Nothing matches "{{ query }}".</div>
        </div>
        <div class="palette-foot">
          <span class="inline-flex items-center gap-1.5"><span class="kbd">↑</span><span class="kbd">↓</span>to move</span>
          <span class="inline-flex items-center gap-1.5"><span class="kbd">↵</span>to open</span>
          <span class="inline-flex items-center gap-1.5"><span class="kbd">esc</span>to close</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';
import {
  FolderGit2,
  KeyRound,
  Layers,
  LayoutDashboard,
  LogOut,
  Moon,
  Plus,
  ScrollText,
  Search,
  Server,
  SlidersHorizontal,
  Sun,
  UserRound,
  Users,
} from 'lucide-vue-next';
import { usePalette } from '../composables/usePalette';
import { useTheme } from '../composables/useTheme';
import { environmentsApi, projectsApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { Environment, ProjectSummary } from '../types';
import { STATUS_TONES, statusLabel, statusTone, type Tone } from '../utils/environment';

interface PaletteItem {
  id: string;
  label: string;
  hint?: string;
  icon?: Component;
  tone?: Tone;
  /** More words that find the item: an environment's branches and owner. */
  keywords?: string;
  run: () => unknown;
}

const { open, hide, toggle } = usePalette();
const router = useRouter();
const authStore = useAuthStore();
const { resolved, setPreference } = useTheme();

const query = ref('');
const activeId = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);
const environments = ref<Environment[]>([]);
const projects = ref<ProjectSummary[]>([]);
let returnFocus: HTMLElement | null = null;

function page(label: string, path: string, icon: Component): PaletteItem {
  return { id: `page-${path}`, label, icon, run: () => router.push(path) };
}

const pages = computed<PaletteItem[]>(() => [
  page('Overview', '/home', LayoutDashboard),
  page('Environments', '/environments', Layers),
  page('Projects', '/projects', FolderGit2),
  page('Account and tokens', '/account', UserRound),
  ...(authStore.isAdmin
    ? [
        page('Team', '/team', Users),
        page('System', '/system/overview', Server),
        page('Settings', '/system/settings', SlidersHorizontal),
        page('Git keys', '/system/settings/git', KeyRound),
        page('Audit', '/system/audit', ScrollText),
      ]
    : []),
]);

const actions = computed<PaletteItem[]>(() => {
  const dark = resolved.value === 'dark';
  return [
    { id: 'action-new', label: 'New environment', icon: Plus, run: () => router.push({ path: '/environments', query: { new: '1' } }) },
    { id: 'action-theme', label: dark ? 'Switch to the light theme' : 'Switch to the dark theme', icon: dark ? Sun : Moon, run: () => setPreference(dark ? 'light' : 'dark') },
    { id: 'action-logout', label: 'Log out', icon: LogOut, run: () => authStore.logout() },
  ];
});

/** Every word typed must appear in the label, the hint or the keywords. */
function matches(item: PaletteItem, words: string[]): boolean {
  const text = `${item.label} ${item.hint ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

const groups = computed(() => {
  const words = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const environmentItems: PaletteItem[] = environments.value.map((environment) => ({
    id: `env-${environment.id}`,
    label: environment.slug,
    hint: `${environment.project} · ${statusLabel(environment.status)}`,
    tone: STATUS_TONES[statusTone(environment.status)],
    keywords: `${environment.sources.map((source) => source.ref ?? '').join(' ')} ${environment.owner?.name ?? ''}`,
    run: () => router.push(`/environments/${environment.id}`),
  }));
  const projectItems: PaletteItem[] = projects.value.map((project) => ({
    id: `project-${project.slug}`,
    label: project.name,
    hint: project.slug,
    icon: FolderGit2,
    run: () => router.push(`/projects/${project.slug}`),
  }));
  const searching = words.length > 0;
  return [
    { label: 'Environments', items: environmentItems.filter((item) => matches(item, words)).slice(0, searching ? 8 : 5) },
    { label: 'Projects', items: searching ? projectItems.filter((item) => matches(item, words)).slice(0, 5) : [] },
    { label: 'Pages', items: searching ? pages.value.filter((item) => matches(item, words)) : [] },
    { label: 'Actions', items: actions.value.filter((item) => matches(item, words)) },
  ].filter((group) => group.items.length > 0);
});

const flat = computed(() => groups.value.flatMap((group) => group.items));
const active = computed(() => flat.value.find((item) => item.id === activeId.value) ?? flat.value[0] ?? null);

watch(query, () => (activeId.value = null));

function move(step: number) {
  const list = flat.value;
  if (list.length === 0) {
    return;
  }
  const index = Math.max(0, list.findIndex((item) => item.id === active.value?.id));
  activeId.value = list[(index + step + list.length) % list.length].id;
  void nextTick(() => document.getElementById(`palette-${activeId.value}`)?.scrollIntoView({ block: 'nearest' }));
}

function onKey(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    move(event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Enter' && active.value) {
    event.preventDefault();
    run(active.value);
  }
}

function run(item: PaletteItem) {
  hide();
  void item.run();
}

async function load() {
  const [environmentList, projectList] = await Promise.all([
    environmentsApi.list().catch(() => environments.value),
    projectsApi.list().catch(() => projects.value),
  ]);
  environments.value = environmentList;
  projects.value = projectList;
}

watch(open, async (value) => {
  if (value) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    query.value = '';
    activeId.value = null;
    await nextTick();
    input.value?.focus();
    void load();
  } else {
    returnFocus?.focus();
  }
});

/** Ctrl+K, or Cmd+K on a Mac, opens and closes the palette from anywhere. */
function onGlobalKey(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    toggle();
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));
</script>
