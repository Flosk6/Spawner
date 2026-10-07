<template>
  <div>
    <div class="flex items-center justify-between mb-3 text-sm">
      <div class="flex items-center gap-2 text-slate-600 dark:text-slate-400">
        <i v-if="following" class="pi pi-spin pi-spinner text-blue-500"></i>
        <i v-else-if="job.status === 'succeeded'" class="pi pi-check-circle text-green-500"></i>
        <i v-else-if="job.status === 'failed'" class="pi pi-times-circle text-red-500"></i>
        <span class="font-medium text-slate-900 dark:text-white">{{ job.type }}</span>
        <span>{{ job.status }}{{ job.phase ? ` during ${job.phase}` : '' }}</span>
        <span class="text-slate-400">{{ timeAgo(job.createdAt) }}</span>
      </div>
      <button v-if="!following" class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white" @click="load">
        <i class="pi pi-refresh text-xs mr-1"></i>Reload
      </button>
    </div>
    <pre
      ref="output"
      class="h-80 overflow-auto rounded-lg bg-slate-950 text-slate-200 text-xs leading-relaxed p-4 font-mono whitespace-pre-wrap break-all"
    ><template v-if="lines.length">{{ lines.join('\n') }}</template><span v-else class="text-slate-500">{{ following ? 'Waiting for output...' : 'No output.' }}</span></pre>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { jobsApi } from '../services/api';
import type { Job } from '../types';
import { timeAgo } from '../utils/format';

const props = defineProps<{ job: Job }>();
const emit = defineEmits<{ finished: [] }>();

const lines = ref<string[]>([]);
const following = ref(false);
const output = ref<HTMLElement | null>(null);
let stop: (() => void) | null = null;

async function append(line: string) {
  const box = output.value;
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  lines.value.push(line);
  if (atBottom) {
    await nextTick();
    output.value?.scrollTo({ top: output.value.scrollHeight });
  }
}

async function load() {
  stop?.();
  lines.value = [];
  if (props.job.status === 'queued' || props.job.status === 'running') {
    following.value = true;
    stop = jobsApi.follow(props.job.id, append, () => {
      following.value = false;
      emit('finished');
    });
    return;
  }
  following.value = false;
  const text = await jobsApi.logs(props.job.id).catch(() => '');
  lines.value = text ? text.replace(/\n$/, '').split('\n') : [];
  await nextTick();
  output.value?.scrollTo({ top: output.value.scrollHeight });
}

// A new job replaces the log; the end of a followed job keeps it.
watch(
  () => props.job.id,
  () => load(),
  { immediate: true },
);

onBeforeUnmount(() => stop?.());
</script>
