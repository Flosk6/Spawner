<template>
  <div>
    <p v-if="!loading && events.length === 0" class="text-sm text-slate-500 py-4">
      Nothing happened yet: crashes, out-of-memory kills, failed healthchecks and jobs show up here.
    </p>
    <ol v-else class="relative border-l border-slate-200 dark:border-purple-800/30 ml-2">
      <li v-for="event in events" :key="event.id" class="mb-4 ml-5">
        <span class="absolute -left-[9px] flex h-[18px] w-[18px] items-center justify-center rounded-full bg-white dark:bg-dark-800">
          <i :class="['text-sm', icon(event).icon, icon(event).color]"></i>
        </span>
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-sm" :class="isProblem(event) ? 'text-red-700 dark:text-red-400 font-medium' : 'text-slate-800 dark:text-slate-200'">
            {{ event.message }}
          </span>
          <span class="text-xs text-slate-500" :title="new Date(event.time).toLocaleString()">{{ timeAgo(event.time) }}</span>
        </div>
        <div class="flex flex-wrap gap-3 mt-0.5">
          <button v-if="event.service && isProblem(event)" class="text-xs text-purple-600 dark:text-purple-400 hover:underline" @click="$emit('logs', event.service)">
            Logs of {{ event.service }}
          </button>
          <button v-if="jobId(event)" class="text-xs text-purple-600 dark:text-purple-400 hover:underline" @click="$emit('job', jobId(event)!)">Job log</button>
        </div>
      </li>
    </ol>
    <div v-if="more" class="flex justify-center">
      <Button label="Older events" severity="secondary" text size="small" :loading="loadingMore" @click="loadMore" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import { environmentsApi } from '../services/api';
import type { TimelineEvent } from '../types';
import { timeAgo } from '../utils/format';

const props = defineProps<{ environmentId: string; live: boolean }>();
defineEmits<{ logs: [service: string]; job: [jobId: string] }>();

const PAGE = 50;
const events = ref<TimelineEvent[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const more = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const ICONS: Record<string, { icon: string; color: string }> = {
  crash: { icon: 'pi pi-times-circle', color: 'text-red-500' },
  oom: { icon: 'pi pi-exclamation-triangle', color: 'text-red-500' },
  unhealthy: { icon: 'pi pi-heart', color: 'text-amber-500' },
  healthy: { icon: 'pi pi-heart-fill', color: 'text-green-500' },
  job_started: { icon: 'pi pi-play-circle', color: 'text-blue-500' },
  job_succeeded: { icon: 'pi pi-check-circle', color: 'text-green-500' },
  job_failed: { icon: 'pi pi-times-circle', color: 'text-red-500' },
  extended: { icon: 'pi pi-clock', color: 'text-slate-400' },
};

function icon(event: TimelineEvent) {
  return ICONS[event.type] ?? { icon: 'pi pi-circle', color: 'text-slate-400' };
}

function isProblem(event: TimelineEvent): boolean {
  return ['crash', 'oom', 'unhealthy', 'job_failed'].includes(event.type);
}

function jobId(event: TimelineEvent): string | null {
  const id = (event.details as { jobId?: unknown } | null)?.jobId;
  return typeof id === 'string' ? id : null;
}

async function load() {
  try {
    const result = await environmentsApi.events(props.environmentId);
    const older = events.value.filter((event) => !result.events.some((recent) => recent.id === event.id) && BigInt(event.id) < BigInt(result.events[result.events.length - 1]?.id ?? '0'));
    events.value = [...result.events, ...older];
    more.value = more.value || result.events.length === PAGE;
  } catch {
    events.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  loadingMore.value = true;
  try {
    const page = await environmentsApi.events(props.environmentId, events.value[events.value.length - 1]?.id);
    events.value = [...events.value, ...page.events];
    more.value = page.events.length === PAGE;
  } finally {
    loadingMore.value = false;
  }
}

onMounted(() => {
  load();
  if (props.live) {
    timer = setInterval(load, 15_000);
  }
});

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer);
  }
});

defineExpose({ reload: load });
</script>
