<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex flex-wrap justify-between items-end gap-4">
      <div>
        <h1 class="text-4xl font-bold mb-2">Audit</h1>
        <p class="text-lg opacity-70">Who did what, over the last 90 days</p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <SelectButton v-model="view" :options="views" option-label="label" option-value="value" :allow-empty="false" />
        <Select
          v-if="view === 'events'"
          v-model="action"
          :options="actions"
          option-label="label"
          option-value="value"
          placeholder="All actions"
          show-clear
          class="w-56"
          @change="reload"
        />
      </div>
    </div>

    <section v-if="view === 'terminals'" class="panel">
      <p class="field-hint !mt-0 mb-4">What each terminal showed is recorded (2 MiB at most) and kept 30 days. Passwords typed without echo are not.</p>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="py-2 pr-4">When</th>
              <th class="py-2 pr-4">Who</th>
              <th class="py-2 pr-4">Where</th>
              <th class="py-2 pr-4">Duration</th>
              <th class="py-2 pr-4">End</th>
              <th></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
            <tr v-for="session in sessions" :key="session.id">
              <td class="py-2 pr-4 whitespace-nowrap" :title="new Date(session.startedAt).toLocaleString()">{{ timeAgo(session.startedAt) }}</td>
              <td class="py-2 pr-4">{{ session.actor }}</td>
              <td class="py-2 pr-4 font-mono text-xs">{{ session.environment }} {{ session.service }}</td>
              <td class="py-2 pr-4">{{ session.endedAt ? formatSeconds((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000) : 'open' }}</td>
              <td class="py-2 pr-4 text-slate-500">{{ endLabel(session) }}</td>
              <td class="py-2 text-right">
                <Button label="Recording" size="small" text :disabled="session.recordedBytes === 0" @click="openRecording(session)" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="sessions.length === 0" class="text-sm text-slate-500 py-4">No terminal was opened in the last 30 days.</p>
    </section>

    <Dialog v-model:visible="recordingVisible" :header="recordingTitle" modal :style="{ width: 'min(1000px, 95vw)' }">
      <pre class="max-h-[70vh] overflow-auto rounded-lg bg-slate-950 text-slate-200 text-xs leading-relaxed p-4 font-mono whitespace-pre-wrap break-all">{{ recording }}</pre>
    </Dialog>

    <section v-if="view === 'events'" class="panel">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs uppercase text-slate-500">
            <tr>
              <th class="py-2 pr-4">When</th>
              <th class="py-2 pr-4">Who</th>
              <th class="py-2 pr-4">Action</th>
              <th class="py-2 pr-4">On</th>
              <th class="py-2 pr-4">Details</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
            <tr v-for="event in events" :key="event.id" class="align-top">
              <td class="py-2 pr-4 whitespace-nowrap" :title="new Date(event.createdAt).toLocaleString()">{{ timeAgo(event.createdAt) }}</td>
              <td class="py-2 pr-4">{{ event.actor }}</td>
              <td class="py-2 pr-4 font-mono text-xs">{{ event.action }}</td>
              <td class="py-2 pr-4">{{ event.target ?? '' }}</td>
              <td class="py-2 pr-4 font-mono text-xs text-slate-500 break-all">{{ describe(event) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!loading && events.length === 0" class="text-sm text-slate-500 py-4">Nothing recorded.</p>
      <div class="flex justify-center pt-4">
        <Button v-if="more" label="Older events" severity="secondary" text :loading="loading" @click="loadMore" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import Button from 'primevue/button';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import SelectButton from 'primevue/selectbutton';
import { useNotification } from '../composables/useNotification';
import { auditApi, errorMessage, terminalsApi } from '../services/api';
import type { AuditEvent, TerminalSessionInfo } from '../types';
import { timeAgo } from '../utils/format';
import { formatSeconds } from '../utils/palette';

const PAGE = 50;
const actions = [
  { label: 'Logins', value: 'auth.' },
  { label: 'Environments', value: 'env.' },
  { label: 'Commands', value: 'env.exec' },
  { label: 'Terminals', value: 'terminal.' },
  { label: 'Invitations', value: 'invite.' },
  { label: 'Tokens', value: 'token.' },
  { label: 'Projects', value: 'project.' },
  { label: 'Team', value: 'user.' },
  { label: 'Settings', value: 'settings.' },
];

const { showError } = useNotification();
const views = [
  { label: 'Events', value: 'events' },
  { label: 'Terminals', value: 'terminals' },
];
const view = ref<'events' | 'terminals'>('events');
const sessions = ref<TerminalSessionInfo[]>([]);
const recording = ref('');
const recordingTitle = ref('');
const recordingVisible = ref(false);
const END_LABELS: Record<string, string> = {
  exit: 'shell exited',
  idle: '15 minutes without input',
  max_duration: 'after 4 hours',
  closed: 'closed',
  error: 'connection lost',
  interrupted: 'Spawner restarted',
};

function endLabel(session: TerminalSessionInfo): string {
  if (!session.endReason) {
    return 'open';
  }
  const reason = END_LABELS[session.endReason] ?? session.endReason;
  return session.exitCode !== null && session.endReason === 'exit' ? `${reason} (${session.exitCode})` : reason;
}

/** Terminal output without its escape codes (colors, cursor moves). */
function plainText(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
    .replace(/\r+\n/g, '\n')
    .replace(/\r/g, '');
}

async function openRecording(session: TerminalSessionInfo) {
  try {
    recording.value = plainText(await terminalsApi.recording(session.id));
    recordingTitle.value = `${session.actor} in ${session.environment} ${session.service}, ${new Date(session.startedAt).toLocaleString()}`;
    recordingVisible.value = true;
  } catch (err) {
    showError(errorMessage(err, 'The recording could not be loaded'));
  }
}

watch(view, async (value) => {
  if (value === 'terminals') {
    sessions.value = await terminalsApi.list().catch(() => []);
  }
});
const events = ref<AuditEvent[]>([]);
const action = ref<string | null>(null);
const loading = ref(false);
const more = ref(false);

function describe(event: AuditEvent): string {
  return event.details ? JSON.stringify(event.details) : (event.ip ?? '');
}

async function fetchPage(before?: number) {
  loading.value = true;
  try {
    const page = await auditApi.list({ before, action: action.value ?? undefined });
    events.value = before ? [...events.value, ...page] : page;
    more.value = page.length === PAGE;
  } catch (err) {
    showError(errorMessage(err, 'The audit trail could not be loaded'));
  } finally {
    loading.value = false;
  }
}

function reload() {
  fetchPage();
}

function loadMore() {
  fetchPage(events.value[events.value.length - 1]?.id);
}

onMounted(reload);
</script>
