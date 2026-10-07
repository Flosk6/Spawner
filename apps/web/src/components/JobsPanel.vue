<template>
  <div class="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
    <ul class="divide-y divide-slate-200 dark:divide-purple-800/30">
      <li v-for="job in jobs" :key="job.id">
        <button
          class="w-full text-left py-2.5 px-2 rounded-lg transition-colors"
          :class="job.id === selectedId ? 'bg-purple-50 dark:bg-purple-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'"
          @click="selectedId = job.id"
        >
          <div class="flex items-center gap-2 text-sm">
            <i :class="statusIcon(job)"></i>
            <span class="font-medium capitalize">{{ job.type }}</span>
            <span class="text-slate-500">{{ job.status }}</span>
          </div>
          <p class="text-xs text-slate-500 mt-0.5 truncate">
            {{ timeAgo(job.createdAt) }}<template v-if="job.actor"> · {{ job.actor }}</template><template v-if="duration(job)"> · {{ duration(job) }}</template>
          </p>
        </button>
      </li>
    </ul>
    <div class="min-w-0">
      <JobLog v-if="selected" :job="selected" @finished="refresh" />
      <p v-else class="text-sm text-slate-500">No job yet.</p>
      <p v-if="selected && hiddenLog" class="field-hint">The logs of the last five jobs are kept.</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import JobLog from './JobLog.vue';
import { environmentsApi } from '../services/api';
import type { Job } from '../types';
import { timeAgo } from '../utils/format';
import { formatSeconds } from '../utils/palette';

const props = defineProps<{ environmentId: string; lastJobId?: string | null; focusJob?: string | null }>();
const emit = defineEmits<{ finished: [] }>();

const jobs = ref<Job[]>([]);
const selectedId = ref<string | null>(props.focusJob ?? null);
const selected = computed(() => jobs.value.find((job) => job.id === selectedId.value) ?? null);
const hiddenLog = computed(() => jobs.value.findIndex((job) => job.id === selectedId.value) >= 5);

function statusIcon(job: Job): string {
  if (job.status === 'succeeded') {
    return 'pi pi-check-circle text-green-500 text-sm';
  }
  if (job.status === 'failed') {
    return 'pi pi-times-circle text-red-500 text-sm';
  }
  return 'pi pi-spin pi-spinner text-blue-500 text-sm';
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
