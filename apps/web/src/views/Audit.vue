<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <div class="flex flex-wrap justify-between items-end gap-4">
      <div>
        <h1 class="text-4xl font-bold mb-2">Audit</h1>
        <p class="text-lg opacity-70">Who did what, over the last 90 days</p>
      </div>
      <Select v-model="action" :options="actions" option-label="label" option-value="value" placeholder="All actions" show-clear class="w-56" @change="reload" />
    </div>

    <section class="panel">
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
import { onMounted, ref } from 'vue';
import Button from 'primevue/button';
import Select from 'primevue/select';
import { useNotification } from '../composables/useNotification';
import { auditApi, errorMessage } from '../services/api';
import type { AuditEvent } from '../types';
import { timeAgo } from '../utils/format';

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
