<template>
  <div class="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
    <section class="card flex flex-col gap-0.5 p-1.5">
      <p v-if="jobs.length === 0" class="field-hint p-3">No job yet.</p>
      <button
        v-for="job in jobs"
        :key="job.id"
        type="button"
        class="job"
        :class="{ 'is-active': job.id === selectedId }"
        :aria-pressed="job.id === selectedId"
        @click="selectedId = job.id"
      >
        <component :is="statusIcon(job)" :class="[statusColor(job), { spinner: isRunning(job) }]" />
        <span class="job-main">
          <span class="job-top">{{ job.type }}<span class="badge badge-sm" :class="`tone-${statusTone(job)}`">{{ job.status }}</span></span>
          <span class="job-meta">{{ timeAgo(job.createdAt) }}<template v-if="job.actor"> · {{ job.actor }}</template><template v-if="duration(job)"> · {{ duration(job) }}</template></span>
        </span>
      </button>
    </section>
    <div class="flex min-w-0 flex-col gap-2">
      <JobLog v-if="selected" :job="selected" :environment-status="environmentStatus" @finished="refresh" />
      <p v-if="selected && hiddenLog" class="field-hint">The logs of the last five jobs are kept.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue';
import { CircleCheck, CircleDashed, CircleX, LoaderCircle } from 'lucide-vue-next';
import JobLog from './JobLog.vue';
import { environmentsApi } from '../services/api';
import type { EnvironmentStatus, Job } from '../types';
import type { Tone } from '../utils/environment';
import { timeAgo } from '../utils/format';
import { formatSeconds } from '../utils/palette';

const props = defineProps<{ environmentId: string; environmentStatus: EnvironmentStatus; lastJobId?: string | null; focusJob?: string | null }>();
const emit = defineEmits<{ finished: [] }>();

const jobs = ref<Job[]>([]);
const selectedId = ref<string | null>(props.focusJob ?? null);
const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) ?? null);
const hiddenLog = computed(() => jobs.value.findIndex((job) => job.id === selectedId.value) >= 5);

function isRunning(job: Job): boolean {
  return job.status === 'running' || job.status === 'queued';
}

function statusIcon(job: Job): Component {
  if (job.status === 'succeeded') {
    return CircleCheck;
  }
  if (job.status === 'failed') {
    return CircleX;
  }
  return isRunning(job) ? LoaderCircle : CircleDashed;
}

function statusTone(job: Job): Tone {
  return { succeeded: 'ok', failed: 'danger', running: 'info', queued: 'info', cancelled: 'muted' }[job.status] as Tone;
}

function statusColor(job: Job): string {
  return { ok: 'text-ok-text', danger: 'text-danger-text', info: 'text-info-text', muted: 'text-fg-3' }[statusTone(job) as 'ok' | 'danger' | 'info' | 'muted'];
}

function duration(job: Job): string {
  return job.startedAt && job.finishedAt ? formatSeconds((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000) : '';
}

async function refresh() {
  jobs.value = await environmentsApi.jobs(props.environmentId).catch(() => []);
  if (!selectedId.value || !jobs.value.some((job) => job.id === selectedId.value)) {
    selectedId.value = jobs.value[0]?.id ?? null;
  }
  emit('finished');
}

watch(
  () => props.lastJobId,
  async (id) => {
    await refresh();
    if (id) {
      selectedId.value = id;
    }
  },
);

watch(
  () => props.focusJob,
  (id) => {
    if (id) {
      selectedId.value = id;
    }
  },
);

onMounted(refresh);
</script>
