<template>
  <div>
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <Select v-model="service" :options="serviceOptions" option-label="label" option-value="value" class="w-44" size="small" />
      <IconField class="flex-1 min-w-[180px]">
        <InputIcon class="pi pi-search" />
        <InputText v-model="search" placeholder="Search" size="small" class="w-full" />
      </IconField>
      <ToggleButton v-model="errorsOnly" on-label="Errors" off-label="Errors" on-icon="pi pi-filter-fill" off-icon="pi pi-filter" size="small" />
      <Select v-model="tail" :options="tails" option-label="label" option-value="value" class="w-32" size="small" />
      <ToggleButton
        v-if="!archived"
        v-model="follow"
        on-label="Live"
        off-label="Paused"
        on-icon="pi pi-circle-fill"
        off-icon="pi pi-pause"
        size="small"
      />
      <a :href="downloadUrl" download>
        <Button icon="pi pi-download" severity="secondary" text size="small" v-tooltip.top="'Download these lines'" />
      </a>
    </div>
    <p v-if="archived" class="field-hint !mt-0 mb-2">The environment is deleted: these are the last logs kept of each service.</p>
    <div
      ref="box"
      class="h-[28rem] overflow-auto rounded-lg bg-slate-950 text-slate-200 text-xs leading-relaxed p-3 font-mono"
      @scroll="onScroll"
    >
      <p v-if="loading && lines.length === 0" class="text-slate-500">Loading...</p>
      <p v-else-if="lines.length === 0" class="text-slate-500">
        {{ errorsOnly || search ? `No matching line${follow ? ' yet' : ''}.` : archived ? 'Nothing was kept.' : 'No output yet.' }}
      </p>
      <div v-for="(line, index) in lines" :key="index" class="whitespace-pre-wrap break-all" :class="line.stream === 'stderr' ? 'text-rose-200' : ''">
        <span class="text-slate-500">{{ line.time.slice(11, 19) }} </span>
        <span v-if="showService" class="font-semibold" :style="{ color: colorFor(line.service, services) }">{{ line.service.padEnd(width) }} </span>
        <span>{{ line.text }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Button from 'primevue/button';
import IconField from 'primevue/iconfield';
import InputIcon from 'primevue/inputicon';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleButton from 'primevue/togglebutton';
import { environmentsApi, type LogFilter } from '../services/api';
import type { LogLine } from '../types';
import { colorFor } from '../utils/palette';

const props = defineProps<{ environmentId: string; services: string[]; archived: boolean; initialService?: string | null; initialErrors?: boolean }>();

const MAX_LINES = 5000;
/** How long a followed stream may take to send its first lines before the box says it is empty. */
const FIRST_LINES_MS = 1500;
const tails = [
  { label: '200 lines', value: 200 },
  { label: '1000 lines', value: 1000 },
  { label: '5000 lines', value: 5000 },
];

const service = ref<string | null>(props.initialService ?? null);
const search = ref('');
const grep = ref('');
const errorsOnly = ref(props.initialErrors ?? false);
const tail = ref(200);
const follow = ref(!props.archived);
const lines = ref<LogLine[]>([]);
const loading = ref(true);
const box = ref<HTMLElement | null>(null);
let atBottom = true;
let stop: (() => void) | null = null;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;

const serviceOptions = computed(() => [{ label: 'All services', value: null }, ...props.services.map((name) => ({ label: name, value: name }))]);
const showService = computed(() => !service.value);
const width = computed(() => Math.max(0, ...props.services.map((name) => name.length)));
const filter = computed<LogFilter>(() => ({ services: service.value ? [service.value] : undefined, tail: tail.value, grep: grep.value, errors: errorsOnly.value }));
const downloadUrl = computed(() => environmentsApi.logsDownloadUrl(props.environmentId, { ...filter.value, tail: 5000 }));

function onScroll() {
  const element = box.value;
  atBottom = !element || element.scrollHeight - element.scrollTop - element.clientHeight < 40;
}

async function scrollDown() {
  if (atBottom) {
    await nextTick();
    box.value?.scrollTo({ top: box.value.scrollHeight });
  }
}

function append(line: LogLine) {
  lines.value.push(line);
  if (lines.value.length > MAX_LINES) {
    lines.value.splice(0, lines.value.length - MAX_LINES);
  }
  void scrollDown();
}

async function load() {
  stop?.();
  stop = null;
  const run = ++generation;
  loading.value = true;
  lines.value = [];
  atBottom = true;
  if (follow.value && !props.archived) {
    setTimeout(() => run === generation && (loading.value = false), FIRST_LINES_MS);
    stop = environmentsApi.followLogs(
      props.environmentId,
      filter.value,
      (line) => {
        loading.value = false;
        append(line);
      },
      () => {
        follow.value = false;
      },
    );
    return;
  }
  try {
    lines.value = await environmentsApi.logLines(props.environmentId, filter.value);
  } catch {
    lines.value = [];
  } finally {
    loading.value = false;
  }
  await scrollDown();
}

watch(search, (value) => {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => (grep.value = value.trim()), 400);
});

watch([service, grep, errorsOnly, tail, follow], load, { immediate: true });

onBeforeUnmount(() => stop?.());

/**
 * Shows the logs of one service, errors only if asked: what the timeline
 * links to.
 */
function focus(name: string | null, errors = false) {
  service.value = name;
  errorsOnly.value = errors;
}

defineExpose({ focus });
</script>
