<template>
  <section class="card">
    <div class="card-head flex-wrap">
      <div class="flex min-w-0 flex-col">
        <span class="card-title">{{ title }}</span>
        <span class="text-xs text-fg-3">{{ timeAgo(job.createdAt) }}<template v-if="job.actor"> by {{ job.actor }}</template></span>
      </div>
      <span v-if="following" class="badge tone-info"><span class="dot"></span>Following</span>
      <button v-else type="button" class="btn btn-ghost btn-sm" @click="load"><RefreshCw />Reload</button>
    </div>
    <div v-if="steps.length" class="steps" aria-label="Phases">
      <div v-for="step in steps" :key="step.phase" class="step" :class="`is-${step.state}`">
        <div class="step-bar"></div>
        <span class="step-name">{{ step.phase }}</span>
        <span class="step-state">{{ STATE_LABELS[step.state] }}</span>
      </div>
    </div>
    <div ref="output" class="console no-service h-80 rounded-b-[9px] lg:h-[26rem]" role="log">
      <!-- One line of markup: the spaces between the parts are what a copy of the text keeps. -->
      <div v-for="(line, index) in lines" :key="index" class="log-line" :class="{ 'is-plain': !line.time }"><span v-if="line.time" class="log-time" :title="line.stamp">{{ line.time }}</span> <span class="log-msg">{{ line.text }}</span></div>
      <p v-if="lines.length === 0" class="console-empty">{{ following ? 'Waiting for output...' : 'No output.' }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { RefreshCw } from 'lucide-vue-next';
import { jobsApi } from '../services/api';
import type { EnvironmentStatus, Job, JobPhase } from '../types';
import { timeAgo } from '../utils/format';

type StepState = 'done' | 'run' | 'fail' | 'wait';

const DEPLOY_PHASES: JobPhase[] = ['preparing', 'validating', 'building', 'seeding', 'routing'];
const STATE_LABELS: Record<StepState, string> = { done: 'Done', run: 'In progress', fail: 'Failed', wait: 'Waiting' };

const props = defineProps<{ job: Job; environmentStatus: EnvironmentStatus }>();
const emit = defineEmits<{ finished: [] }>();

const lines = ref<{ time: string; stamp: string; text: string }[]>([]);
const following = ref(false);
const output = ref<HTMLElement | null>(null);
let stop: (() => void) | null = null;

/** "Update failed during validating". */
const title = computed(() => {
  const job = props.job;
  const during = job.phase && job.status === 'failed' ? ` during ${job.phase}` : '';
  return `${job.type.charAt(0).toUpperCase()}${job.type.slice(1)} ${job.status}${during}`;
});

/**
 * Where a deploy is: a running job is at the phase the environment shows, a
 * failed one stopped at the phase it records. A finished deploy shows none,
 * since its log says which phases ran (seeding is skipped on most updates).
 */
const steps = computed<{ phase: JobPhase; state: StepState }[]>(() => {
  const job = props.job;
  if ((job.type !== 'create' && job.type !== 'update') || job.status === 'succeeded' || job.status === 'cancelled') {
    return [];
  }
  const at = job.status === 'failed' ? job.phase : (props.environmentStatus as JobPhase);
  const current = at ? DEPLOY_PHASES.indexOf(at) : -1;
  if (job.status === 'failed' && current < 0) {
    return [];
  }
  return DEPLOY_PHASES.map((phase, index) => {
    if (current < 0 || index > current) {
      return { phase, state: 'wait' };
    }
    if (index < current) {
      return { phase, state: 'done' };
    }
    return { phase, state: job.status === 'failed' ? 'fail' : 'run' };
  });
});

/**
 * A line of the job log: "2026-10-08T14:00:21.123Z Building and starting ...".
 * The time stays in UTC, as in the logs of the services; the full date is its title.
 */
function parse(line: string): { time: string; stamp: string; text: string } {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (.*)$/.exec(line);
  return match ? { time: match[1].slice(11, 19), stamp: match[1], text: match[2] } : { time: '', stamp: '', text: line };
}

async function append(line: string) {
  const box = output.value;
  const atBottom = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40;
  lines.value.push(parse(line));
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
  lines.value = text ? text.replace(/\n$/, '').split('\n').map(parse) : [];
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
