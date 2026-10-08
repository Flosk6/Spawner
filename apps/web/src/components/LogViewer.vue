<template>
  <section class="card">
    <div class="card-head flex-wrap py-2.5">
      <div class="chips" role="group" aria-label="Services">
        <button type="button" class="chip" :class="{ 'is-active': service === null }" :aria-pressed="service === null" @click="service = null">All services</button>
        <button
          v-for="name in services"
          :key="name"
          type="button"
          class="chip"
          :class="{ 'is-active': service === name }"
          :aria-pressed="service === name"
          @click="service = name"
        >
          <span class="swatch" :style="{ background: colorFor(name, services) }"></span>{{ name }}
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="input-wrap w-full sm:w-52">
          <Search />
          <input v-model="search" class="input h-10 sm:h-7" type="search" placeholder="Search the lines" aria-label="Search the lines" />
        </div>
        <button type="button" class="btn btn-secondary btn-sm" :class="{ 'is-on': errorsOnly }" :aria-pressed="errorsOnly" @click="errorsOnly = !errorsOnly">
          <TriangleAlert />Errors only
        </button>
        <Select v-model="tail" :options="TAILS" option-label="label" option-value="value" size="small" class="w-32" aria-label="Lines" />
        <button
          v-if="!archived"
          type="button"
          class="btn btn-secondary btn-sm"
          :class="{ 'is-on': follow }"
          :aria-pressed="follow"
          v-tooltip.top="follow ? 'New lines arrive as they are written' : 'Follow the new lines'"
          @click="follow = !follow"
        >
          <span class="dot" :class="follow ? 'tone-ok' : ''"></span>{{ follow ? 'Live' : 'Paused' }}
        </button>
        <a :href="downloadUrl" download class="btn btn-ghost btn-sm btn-icon" aria-label="Download these lines" v-tooltip.top="'Download these lines'"><Download /></a>
      </div>
    </div>
    <div v-if="archived" class="card-foot border-t-0 border-b"><Info class="size-3.5" />The environment is deleted: these are the last lines kept of each service.</div>
    <div
      ref="box"
      class="console h-[32rem] rounded-b-[9px]"
      :class="{ 'no-service': !showService }"
      :style="{ '--log-service': `${width}ch` }"
      role="log"
      aria-live="off"
      @scroll="onScroll"
    >
      <p v-if="loading && lines.length === 0" class="console-empty">Loading...</p>
      <p v-else-if="lines.length === 0" class="console-empty">
        {{ errorsOnly || search ? `No matching line${follow ? ' yet' : ''}.` : archived ? 'Nothing was kept.' : 'No output yet.' }}
      </p>
      <div v-for="(line, index) in lines" :key="index" class="log-line" :class="{ 'is-err': line.stream === 'stderr' }">
        <span class="log-time">{{ line.time.slice(11, 19) }}</span>
        <span v-if="showService" class="log-svc" :style="{ color: colorFor(line.service, services) }">{{ line.service }}</span>
        <span class="log-msg">{{ line.text }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import Select from 'primevue/select';
import { Download, Info, Search, TriangleAlert } from 'lucide-vue-next';
import { environmentsApi, type LogFilter } from '../services/api';
import type { LogLine } from '../types';
import { colorFor } from '../utils/palette';

const props = defineProps<{ environmentId: string; services: string[]; archived: boolean; initialService?: string | null; initialErrors?: boolean }>();

const MAX_LINES = 5000;
/** How long a followed stream may take to send its first lines before the box says it is empty. */
const FIRST_LINES_MS = 1500;
const TAILS = [
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

const showService = computed(() => !service.value);
const width = computed(() => Math.max(4, ...props.services.map((name) => name.length)));
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
