<template>
  <section class="card">
    <div class="card-head">
      <div class="card-title"><History />Timeline</div>
      <span class="field-hint hidden sm:block">Crashes, out-of-memory kills, health checks and jobs, kept 30 days</span>
    </div>
    <div class="card-body">
      <div v-if="loading" class="flex justify-center py-8"><LoaderCircle class="spinner size-5 text-fg-3" /></div>
      <p v-else-if="events.length === 0" class="field-hint py-2">Nothing happened yet: crashes, out-of-memory kills, failed health checks and jobs show up here.</p>
      <ol v-else class="timeline">
        <li v-for="event in events" :key="event.id" class="tl-item">
          <span class="tl-icon" :class="`tone-${look(event).tone}`"><component :is="look(event).icon" /></span>
          <div class="tl-body">
            <span class="tl-title" :class="{ 'is-problem': isProblem(event) }">{{ event.message }}</span>
            <div class="tl-meta">
              <button v-if="event.service && isProblem(event)" type="button" class="link" @click="$emit('logs', event.service)">Logs of {{ event.service }}</button>
              <button v-if="jobId(event)" type="button" class="link" @click="$emit('job', jobId(event)!)">Job log</button>
            </div>
          </div>
          <span class="tl-time" :title="new Date(event.time).toLocaleString()">{{ timeAgo(event.time) }}</span>
        </li>
      </ol>
      <div v-if="more" class="mt-4 flex justify-center">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="loadingMore" @click="loadMore">
          <LoaderCircle v-if="loadingMore" class="spinner" />Older events
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, type Component } from 'vue';
import { CircleCheck, CircleDot, CirclePlay, CircleX, Clock, HeartCrack, HeartPulse, History, LoaderCircle, TriangleAlert } from 'lucide-vue-next';
import { environmentsApi } from '../services/api';
import type { TimelineEvent } from '../types';
import type { Tone } from '../utils/environment';
import { timeAgo } from '../utils/format';

const props = defineProps<{ environmentId: string; live: boolean }>();
defineEmits<{ logs: [service: string]; job: [jobId: string] }>();

const PAGE = 50;
const events = ref<TimelineEvent[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const more = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const LOOKS: Record<string, { icon: Component; tone: Tone }> = {
  crash: { icon: CircleX, tone: 'danger' },
  oom: { icon: TriangleAlert, tone: 'danger' },
  unhealthy: { icon: HeartCrack, tone: 'warn' },
  healthy: { icon: HeartPulse, tone: 'ok' },
  job_started: { icon: CirclePlay, tone: 'info' },
  job_succeeded: { icon: CircleCheck, tone: 'ok' },
  job_failed: { icon: CircleX, tone: 'danger' },
  extended: { icon: Clock, tone: 'muted' },
};

function look(event: TimelineEvent) {
  return LOOKS[event.type] ?? { icon: CircleDot, tone: 'muted' as Tone };
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
    const older = events.value.filter(
      (event) => !result.events.some((recent) => recent.id === event.id) && BigInt(event.id) < BigInt(result.events[result.events.length - 1]?.id ?? '0'),
    );
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
