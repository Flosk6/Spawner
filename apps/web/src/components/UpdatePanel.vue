<template>
  <section class="panel">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
      <h2 class="panel-title !mb-0"><i class="pi pi-sync text-sm"></i>Spawner {{ status?.current ?? '' }}</h2>
      <div v-if="status" class="flex gap-2">
        <Button label="Check now" icon="pi pi-refresh" text size="small" :loading="checking" :disabled="updating" @click="check" />
        <Button
          v-if="status.latest && status.managed"
          :label="`Update to ${status.latest.version}`"
          icon="pi pi-download"
          size="small"
          :loading="updating"
          @click="confirmUpdate"
        />
      </div>
    </div>

    <div v-if="!status" class="flex justify-center py-6"><ProgressSpinner style="width: 2rem; height: 2rem" /></div>

    <template v-else>
      <Message v-if="updating" severity="info" :closable="false" class="mb-3">{{ progress }}</Message>
      <Message v-else-if="status.run?.state === 'failed'" severity="error" :closable="false" class="mb-3">
        {{ status.run.error }}
        <details v-if="status.run.log.length > 0" class="mt-2">
          <summary class="cursor-pointer text-sm">The installer's output</summary>
          <pre class="mt-2 text-xs whitespace-pre-wrap">{{ status.run.log.join('\n') }}</pre>
        </details>
      </Message>
      <Message v-else-if="status.run?.state === 'succeeded' && status.run.to === status.current" severity="success" :closable="false" class="mb-3">
        Updated from {{ status.run.from }} {{ timeAgo(status.run.finishedAt) }}, by {{ status.run.by }}.
      </Message>

      <p v-if="status.latest" class="text-sm">
        Spawner <strong>{{ status.latest.version }}</strong> is available<span v-if="status.latest.publishedAt">, released {{ timeAgo(status.latest.publishedAt) }}</span>.
        <a v-if="status.latest.url" :href="status.latest.url" target="_blank" rel="noopener" class="underline">Release notes</a>
      </p>
      <p v-else class="text-sm text-slate-500">
        Spawner is up to date<span v-if="status.checkedAt">: checked {{ timeAgo(status.checkedAt) }}</span>.
      </p>
      <p v-if="status.checkError" class="field-hint">The list of releases could not be read: {{ status.checkError }}</p>
      <p v-if="status.latest && !status.managed" class="field-hint">{{ status.reason }}.</p>
      <p v-if="status.managed" class="field-hint">
        Updating backs the database up, then restarts Spawner on the new version: the dashboard is away for about a minute, environments keep running. If the new
        version does not start, Spawner goes back to this one.<span v-if="!status.automaticChecks"> Spawner does not look for new versions by itself here (SPAWNER_UPDATE_CHECK).</span>
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
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
    `Update Spawner to ${next}? Spawner backs its database up, then restarts on the new version: the dashboard is away for about a minute, environments keep running. If ${next} does not start, Spawner goes back to ${status.value?.current}.`,
    async () => {
      try {
        await systemApi.startUpdate();
        follow(next);
      } catch (error) {
        showError(errorMessage(error, 'The update could not start'));
      }
    },
    undefined,
    `Update to ${next}`,
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
