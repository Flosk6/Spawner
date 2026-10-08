<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Audit</h1>
      <p class="page-lead">Who did what, over the last 90 days.</p>
    </div>
    <div class="page-actions">
      <SegmentedControl v-model="view" :options="VIEWS" label="View" />
    </div>
  </div>

  <section v-if="view === 'events'" class="card">
    <div class="card-head is-flush">
      <div class="card-title"><ScrollText />Events</div>
      <Select
        v-model="action"
        :options="ACTIONS"
        option-label="label"
        option-value="value"
        placeholder="All actions"
        show-clear
        class="w-44 sm:w-56"
        aria-label="Action"
        @change="reload"
      />
    </div>
    <div v-if="loading && events.length === 0" class="flex justify-center border-t py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>
    <div v-else class="table-wrap">
      <table class="table is-compact">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th class="hidden md:table-cell">On</th>
            <th class="hidden md:table-cell">Details</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="event in events" :key="event.id" class="[&>td]:align-top">
            <td class="whitespace-nowrap text-fg-2" :title="new Date(event.createdAt).toLocaleString()">{{ timeAgo(event.createdAt) }}</td>
            <td class="font-medium">{{ event.actor }}</td>
            <td>
              <span class="badge badge-sm font-mono">{{ event.action }}</span>
              <div v-if="event.target" class="mt-1 md:hidden">{{ event.target }}</div>
              <div v-if="describe(event)" class="break-all font-mono text-xs leading-5 text-fg-3 md:hidden">{{ describe(event) }}</div>
            </td>
            <td class="hidden md:table-cell">{{ event.target ?? '' }}</td>
            <td class="hidden break-all font-mono text-xs leading-5 text-fg-3 md:table-cell">{{ describe(event) }}</td>
          </tr>
          <tr v-if="events.length === 0">
            <td colspan="5"><div class="empty">Nothing recorded.</div></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="more" class="card-foot justify-center">
      <button type="button" class="btn btn-ghost btn-sm" :disabled="loading" @click="loadMore">
        <LoaderCircle v-if="loading" class="spinner" /><ArrowDown v-else />Older events
      </button>
    </div>
  </section>

  <section v-else class="card">
    <div class="card-head is-flush">
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="card-title"><SquareTerminal />Terminal sessions</div>
        <p class="field-hint">What each terminal showed is recorded (2 MiB at most) and kept 30 days. Passwords typed without echo are not.</p>
      </div>
    </div>
    <div v-if="sessionsLoading && sessions.length === 0" class="flex justify-center border-t py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>
    <div v-else class="table-wrap">
      <table class="table is-compact">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Where</th>
            <th class="hidden md:table-cell">Duration</th>
            <th class="hidden md:table-cell">End</th>
            <th><span class="sr-only">Recording</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="session in sessions" :key="session.id">
            <td class="whitespace-nowrap text-fg-2" :title="new Date(session.startedAt).toLocaleString()">{{ timeAgo(session.startedAt) }}</td>
            <td class="font-medium">{{ session.actor }}</td>
            <td class="font-mono text-xs leading-5">
              <span>{{ session.environment }}</span> <span class="text-fg-3">{{ session.service }}</span>
              <div class="font-sans text-fg-3 md:hidden">{{ duration(session) }}, {{ endLabel(session) }}</div>
            </td>
            <td class="hidden whitespace-nowrap tabular-nums text-fg-2 md:table-cell">{{ duration(session) }}</td>
            <td class="hidden text-fg-3 md:table-cell">{{ endLabel(session) }}</td>
            <td class="cell-actions">
              <button type="button" class="btn btn-ghost btn-sm" aria-label="Recording" :disabled="session.recordedBytes === 0" @click="openRecording(session)">
                <Eye /><span class="hidden sm:inline">Recording</span>
              </button>
            </td>
          </tr>
          <tr v-if="sessions.length === 0">
            <td colspan="6"><div class="empty">No terminal was opened in the last 30 days.</div></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <Dialog v-model:visible="recordingVisible" :header="recordingTitle" modal :style="{ width: 'min(1000px, calc(100vw - 2rem))' }">
    <pre class="console m-0 max-h-[60vh] whitespace-pre-wrap break-all rounded-lg border px-4">{{ recording }}</pre>
  </Dialog>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import Dialog from 'primevue/dialog';
import Select from 'primevue/select';
import { ArrowDown, Eye, LoaderCircle, ScrollText, SquareTerminal } from 'lucide-vue-next';
import SegmentedControl from '../components/SegmentedControl.vue';
import { useNotification } from '../composables/useNotification';
import { auditApi, errorMessage, terminalsApi } from '../services/api';
import type { AuditEvent, TerminalSessionInfo } from '../types';
import { timeAgo } from '../utils/format';
import { formatSeconds } from '../utils/palette';

const PAGE = 50;
const ACTIONS = [
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
const VIEWS: { label: string; value: 'events' | 'terminals' }[] = [
  { label: 'Events', value: 'events' },
  { label: 'Terminals', value: 'terminals' },
];
const END_LABELS: Record<string, string> = {
  exit: 'shell exited',
  idle: '15 minutes without input',
  max_duration: 'after 4 hours',
  closed: 'closed',
  error: 'connection lost',
  interrupted: 'Spawner restarted',
};

const { showError } = useNotification();

const view = ref<'events' | 'terminals'>('events');
const events = ref<AuditEvent[]>([]);
const action = ref<string | null>(null);
const loading = ref(true);
const more = ref(false);
const sessions = ref<TerminalSessionInfo[]>([]);
const sessionsLoading = ref(false);
const recording = ref('');
const recordingTitle = ref('');
const recordingVisible = ref(false);

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

/** How long a closed session lasted; "open" while it runs. */
function duration(session: TerminalSessionInfo): string {
  return session.endedAt ? formatSeconds((new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()) / 1000) : 'open';
}

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
    sessionsLoading.value = true;
    sessions.value = await terminalsApi.list().catch(() => []);
    sessionsLoading.value = false;
  }
});

onMounted(reload);
</script>
