<template>
  <section class="card">
    <div class="card-head flex-wrap">
      <div class="card-title"><CircleArrowUp />Spawner {{ status?.current ?? '' }}</div>
      <div v-if="status" class="flex flex-wrap items-center gap-2">
        <button type="button" class="btn btn-ghost btn-sm" :disabled="checking || updating" @click="check">
          <LoaderCircle v-if="checking" class="spinner" /><RefreshCw v-else />Check now
        </button>
        <button v-if="status.latest && status.managed" type="button" class="btn btn-primary btn-sm" :disabled="updating" @click="confirmUpdate">
          <LoaderCircle v-if="updating" class="spinner" /><Download v-else />Update to {{ status.latest.version }}
        </button>
      </div>
    </div>

    <div v-if="!status" class="flex justify-center py-10"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

    <div v-else class="card-body flex flex-col gap-3">
      <div v-if="updating" class="alert tone-info">
        <LoaderCircle class="spinner" />
        <div class="alert-body"><span class="alert-title">{{ progress }}</span></div>
      </div>
      <div v-else-if="status.run?.state === 'failed'" class="alert tone-danger">
        <CircleX />
        <div class="alert-body">
          <span class="alert-title">{{ status.run.error }}</span>
          <details v-if="status.run.log.length > 0" class="mt-1">
            <summary class="cursor-pointer text-sm font-medium text-fg-2">The installer's output</summary>
            <pre class="pre max-h-96 overflow-auto">{{ status.run.log.join('\n') }}</pre>
          </details>
        </div>
      </div>
      <div v-else-if="status.run?.state === 'succeeded' && status.run.to === status.current" class="alert tone-ok">
        <CircleCheck />
        <div class="alert-body">
          <span class="alert-title">Updated from {{ status.run.from }} {{ timeAgo(status.run.finishedAt) }}, by {{ status.run.by }}.</span>
        </div>
      </div>

      <p v-if="status.latest">
        Spawner <strong class="font-semibold">{{ status.latest.version }}</strong>
        is available<template v-if="status.latest.publishedAt">, released {{ timeAgo(status.latest.publishedAt) }}</template>.
        <a v-if="status.latest.url" :href="status.latest.url" target="_blank" rel="noopener" class="link inline-flex items-center gap-1">
          Release notes<ExternalLink class="size-3.5" />
        </a>
      </p>
      <p v-else class="text-fg-2">Spawner is up to date<template v-if="status.checkedAt">: checked {{ timeAgo(status.checkedAt) }}</template>.</p>
      <p v-if="status.checkError" class="field-hint">The list of releases could not be read: {{ status.checkError }}</p>
      <p v-if="status.latest && !status.managed" class="field-hint">{{ status.reason }}.</p>
      <p v-if="status.managed" class="field-hint">
        Updating backs the database up, then restarts Spawner on the new version: the dashboard is away for about a minute, environments keep
        running. If the new version does not start, Spawner goes back to this one.
        <template v-if="!status.automaticChecks">
          Spawner does not look for new versions by itself here (<code>SPAWNER_UPDATE_CHECK</code>).
        </template>
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CircleArrowUp, CircleCheck, CircleX, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-vue-next';
import { useNotification } from '../composables/useNotification';
import { errorMessage, systemApi } from '../services/api';
import type { UpdateStatus } from '../types';
import { timeAgo } from '../utils/format';

const POLL_MS = 3000;
/** How long Spawner may stay away while it restarts before the page says so. */
const PATIENCE_MS = 10 * 60_000;

const { showError, showSuccess, confirmAction } = useNotification();
const status = ref<UpdateStatus | null>(null);
const checking = ref(false);
const updating = ref(false);
const away = ref(false);
let target: string | null = null;
let since = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const progress = computed(() => {
  if (away.value) {
    return `Spawner restarts on ${target}: the dashboard comes back within a minute or two.`;
  }
  if (status.value?.run?.phase === 'downloading') {
    return `Downloading Spawner ${target}...`;
  }
  return `Installing Spawner ${target}: the database is backed up, then Spawner restarts.`;
});

async function load() {
  try {
    status.value = await systemApi.update();
    if (status.value.run?.state === 'running' && !updating.value) {
      follow(status.value.run.to);
    }
  } catch (error) {
    showError(errorMessage(error, 'Could not read the version of Spawner'));
  }
}

async function check() {
  checking.value = true;
  try {
    status.value = await systemApi.checkUpdate();
  } catch (error) {
    showError(errorMessage(error, 'Could not read the list of releases'));
  } finally {
    checking.value = false;
  }
}

function confirmUpdate() {
  const next = status.value?.latest?.version;
  if (!next) {
    return;
  }
  confirmAction(
    `Spawner backs its database up, then restarts on the new version: the dashboard is away for about a minute, environments keep running. If ${next} does not start, Spawner goes back to ${status.value?.current}.`,
    async () => {
      try {
        await systemApi.startUpdate();
        follow(next);
      } catch (error) {
        showError(errorMessage(error, 'The update could not start'));
      }
    },
    { header: `Update to ${next}`, acceptLabel: `Update to ${next}` },
  );
}

/**
 * Follows an update until Spawner answers on the new version (then the page
 * reloads, for the new interface) or the update failed. While Spawner
 * restarts, it does not answer at all: that is expected.
 */
function follow(version: string) {
  updating.value = true;
  target = version;
  since = Date.now();
  poll();
}

async function poll() {
  try {
    const answer = await systemApi.update();
    away.value = false;
    status.value = answer;
    if (answer.run?.state === 'succeeded' && answer.current === target) {
      updating.value = false;
      showSuccess(`Spawner ${target} is running`, 'Updated');
      timer = setTimeout(() => window.location.reload(), 1500);
      return;
    }
    if (answer.run?.state === 'failed') {
      updating.value = false;
      return;
    }
  } catch {
    away.value = true;
  }
  if (Date.now() - since > PATIENCE_MS) {
    updating.value = false;
    showError('Spawner has not come back after 10 minutes: look at the server (docker logs spawner)');
    return;
  }
  timer = setTimeout(poll, POLL_MS);
}

onMounted(load);
onBeforeUnmount(() => {
  if (timer) {
    clearTimeout(timer);
  }
});
</script>
