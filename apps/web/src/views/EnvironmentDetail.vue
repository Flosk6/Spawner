<template>
  <div class="max-w-7xl mx-auto">
    <router-link to="/environments" class="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white mb-6">
      <i class="pi pi-arrow-left text-xs"></i>Environments
    </router-link>

    <div v-if="loading && !environment" class="flex justify-center py-20">
      <ProgressSpinner />
    </div>

    <Message v-else-if="loadError" severity="error" :closable="false">{{ loadError }}</Message>

    <template v-else-if="environment">
      <!-- Header -->
      <div class="flex flex-wrap items-start justify-between gap-4 mb-8">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-3 mb-2">
            <h1 class="text-3xl font-bold text-slate-900 dark:text-white break-all">{{ environment.slug }}</h1>
            <router-link
              :to="{ path: '/environments', query: { project: environment.project } }"
              class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/80 dark:bg-dark-700/50 border border-slate-300/50 dark:border-purple-800/30 text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              <i class="pi pi-folder text-blue-600 dark:text-blue-400 text-xs"></i>{{ environment.project }}
            </router-link>
            <EnvironmentStatus :status="environment.status" />
          </div>
          <p class="text-sm text-slate-500">
            Created {{ timeAgo(environment.createdAt) }} from the {{ environment.createdVia }}
            <template v-if="environment.expiresAt && environment.status !== 'failed'"> · expires {{ timeLeft(environment.expiresAt) }}</template>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <a v-if="environment.url && environment.status === 'ready'" :href="environment.url" target="_blank" rel="noopener">
            <Button label="Open" icon="pi pi-external-link" />
          </a>
          <span v-tooltip.bottom="redeployBlocked ?? ''">
            <SplitButton
              label="Redeploy"
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              :model="redeployOptions"
              :disabled="busy || acting || !!redeployBlocked"
              @click="redeploy({})"
            />
          </span>
          <Button
            v-if="environment.status === 'ready'"
            label="Stop"
            icon="pi pi-pause"
            severity="secondary"
            outlined
            :disabled="busy || acting"
            @click="act('stop')"
          />
          <Button
            v-if="environment.status === 'stopped'"
            label="Start"
            icon="pi pi-play"
            severity="secondary"
            outlined
            :disabled="busy || acting"
            @click="act('start')"
          />
          <Button label="Delete" icon="pi pi-trash" severity="danger" outlined :disabled="environment.status === 'deleting' || acting" @click="confirmRemove" />
        </div>
      </div>

      <Message v-if="environment.status === 'failed' && environment.error" severity="error" :closable="false" class="mb-6">
        <div class="font-semibold mb-1">Failed{{ environment.phase ? ` during ${environment.phase}` : '' }}</div>
        <pre class="whitespace-pre-wrap text-sm font-mono">{{ environment.error }}</pre>
      </Message>

      <div class="grid gap-6 lg:grid-cols-2 mb-6">
        <!-- URLs -->
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-globe text-sm"></i>URLs</h2>
          <p v-if="environment.exposures.length === 0" class="text-sm text-slate-500">Known once the environment is deployed.</p>
          <ul v-else class="space-y-3">
            <li v-for="exposure in environment.exposures" :key="exposure.name" class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-medium text-slate-900 dark:text-white">{{ exposure.name }}</span>
                <span v-if="exposure.entrypoint" class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300">
                  entrypoint
                </span>
                <span class="text-xs text-slate-500 font-mono">{{ exposure.service }}:{{ exposure.port }}</span>
              </div>
              <a
                :href="environment.urls[exposure.name]"
                target="_blank"
                rel="noopener"
                class="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline break-all"
              >{{ environment.urls[exposure.name] }}</a>
            </li>
          </ul>
        </section>

        <!-- Sources -->
        <section class="panel">
          <h2 class="panel-title"><i class="pi pi-code-branch text-sm"></i>Sources</h2>
          <p v-if="environment.sources.length === 0" class="text-sm text-slate-500">Known once the code is fetched.</p>
          <ul v-else class="space-y-3">
            <li v-for="source in environment.sources" :key="source.name" class="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span class="font-medium text-slate-900 dark:text-white">{{ source.name }}</span>
              <span v-if="source.origin === 'upload'" class="text-slate-500">
                <i class="pi pi-upload text-xs mr-1"></i>uploaded worktree
                <span class="font-mono">{{ source.digest?.slice(0, 12) }}</span>
                <template v-if="source.sizeBytes"> · {{ formatBytes(source.sizeBytes) }}</template>
              </span>
              <span v-else class="text-slate-500 font-mono break-all">
                {{ source.ref }}<template v-if="source.commit"> @ {{ source.commit.slice(0, 7) }}</template>
              </span>
            </li>
          </ul>
        </section>
      </div>

      <!-- Last job -->
      <section v-if="environment.lastJob" class="panel mb-6">
        <h2 class="panel-title"><i class="pi pi-list text-sm"></i>Last job</h2>
        <JobLog :job="environment.lastJob" @finished="refresh" />
      </section>

      <!-- Services -->
      <section class="panel mb-6">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 class="panel-title !mb-0"><i class="pi pi-box text-sm"></i>Services</h2>
          <div v-if="selectedService" class="flex gap-1">
            <Button label="Logs" size="small" :outlined="serviceView !== 'logs'" @click="serviceView = 'logs'" />
            <Button
              label="Terminal"
              size="small"
              :outlined="serviceView !== 'terminal'"
              :disabled="selectedService.state !== 'running'"
              @click="serviceView = 'terminal'"
            />
          </div>
        </div>

        <p v-if="services.length === 0" class="text-sm text-slate-500">No container is running.</p>
        <template v-else>
          <div class="flex flex-wrap gap-2 mb-4">
            <button
              v-for="service in services"
              :key="service.name"
              class="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors"
              :class="
                service.name === selected
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-500/10 text-purple-700 dark:text-purple-300'
                  : 'border-slate-300 dark:border-purple-800/30 text-slate-600 dark:text-slate-400 hover:border-slate-400'
              "
              @click="selected = service.name"
            >
              <span class="h-2 w-2 rounded-full" :class="service.state === 'running' ? 'bg-green-500' : 'bg-slate-400'"></span>
              <span class="font-medium">{{ service.name }}</span>
              <span class="text-xs opacity-70">{{ service.status }}</span>
            </button>
          </div>

          <div v-if="selectedService && serviceView === 'logs'">
            <div class="flex justify-end mb-2">
              <button class="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white" @click="loadServiceLogs">
                <i class="pi pi-refresh text-xs mr-1" :class="{ 'pi-spin': loadingLogs }"></i>Reload
              </button>
            </div>
            <pre
              ref="logsBox"
              class="h-96 overflow-auto rounded-lg bg-slate-950 text-slate-200 text-xs leading-relaxed p-4 font-mono whitespace-pre-wrap break-all"
            >{{ serviceLogs || 'No output.' }}</pre>
          </div>
          <XtermTerminal
            v-else-if="selectedService && serviceView === 'terminal'"
            :key="selectedService.name"
            :environment-id="environment.id"
            :resource-name="selectedService.name"
          />
        </template>
      </section>

      <StatsChart v-if="environment.status === 'ready'" :environment-id="environment.id" />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import SplitButton from 'primevue/splitbutton';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import JobLog from '../components/JobLog.vue';
import StatsChart from '../components/StatsChart.vue';
import XtermTerminal from '../components/XtermTerminal.vue';
import { useNotification } from '../composables/useNotification';
import { environmentsApi, errorMessage } from '../services/api';
import type { Environment, JobAccepted, ServiceState } from '../types';
import { isBusy, redeployRequest } from '../utils/environment';
import { formatBytes, timeAgo, timeLeft } from '../utils/format';

const POLL_MS = 3000;

const route = useRoute();
const router = useRouter();
const { showError, showSuccess, confirmAction, confirmDelete } = useNotification();

const environment = ref<Environment | null>(null);
const services = ref<ServiceState[]>([]);
const selected = ref('');
const serviceView = ref<'logs' | 'terminal'>('logs');
const serviceLogs = ref('');
const loadingLogs = ref(false);
const logsBox = ref<HTMLElement | null>(null);
const loading = ref(true);
const loadError = ref('');
const acting = ref(false);
let poll: ReturnType<typeof setInterval> | null = null;

const id = computed(() => route.params.id as string);
const busy = computed(() => (environment.value ? isBusy(environment.value.status) : false));
const selectedService = computed(() => services.value.find((service) => service.name === selected.value));

const redeployBlocked = computed(() =>
  environment.value && !redeployRequest(environment.value) ? 'Deployed from a local worktree: redeploy it with the CLI' : null,
);

const redeployOptions = [
  { label: 'Redeploy and replay the seed', icon: 'pi pi-database', command: () => redeploy({ reseed: true }) },
  {
    label: 'Redeploy from scratch (deletes the data)',
    icon: 'pi pi-exclamation-triangle',
    command: () =>
      confirmAction(
        'The containers and volumes of this environment are removed, then it is rebuilt and seeded again. Its data is lost.',
        () => redeploy({ fresh: true }),
        undefined,
        'Redeploy from scratch',
      ),
  },
];

async function refresh() {
  try {
    environment.value = await environmentsApi.get(id.value);
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err, 'The environment could not be loaded');
  } finally {
    loading.value = false;
  }
  await loadServices();
}

async function loadServices() {
  services.value = await environmentsApi.services(id.value).catch(() => []);
  if (!services.value.some((service) => service.name === selected.value)) {
    selected.value = services.value.find((service) => service.state === 'running')?.name ?? services.value[0]?.name ?? '';
  }
}

async function loadServiceLogs() {
  if (!selectedService.value) {
    return;
  }
  loadingLogs.value = true;
  try {
    serviceLogs.value = await environmentsApi.logs(id.value, selectedService.value.name);
  } catch (err) {
    serviceLogs.value = errorMessage(err, 'The logs could not be read');
  } finally {
    loadingLogs.value = false;
  }
  await nextTick();
  logsBox.value?.scrollTo({ top: logsBox.value.scrollHeight });
}

watch([selected, serviceView], () => {
  if (serviceView.value === 'logs') {
    loadServiceLogs();
  }
});

function accepted(result: JobAccepted) {
  environment.value = { ...result.environment, lastJob: result.job };
}

async function act(action: 'stop' | 'start') {
  acting.value = true;
  try {
    accepted(await environmentsApi[action](id.value));
  } catch (err) {
    showError(errorMessage(err, `The environment could not ${action}`));
  } finally {
    acting.value = false;
  }
}

async function redeploy(options: { fresh?: boolean; reseed?: boolean }) {
  const deploy = environment.value && redeployRequest(environment.value);
  if (!deploy) {
    return;
  }
  acting.value = true;
  try {
    accepted(await environmentsApi.update(id.value, deploy, options));
  } catch (err) {
    showError(errorMessage(err, 'The environment could not be redeployed'));
  } finally {
    acting.value = false;
  }
}

function confirmRemove() {
  const current = environment.value;
  if (!current) {
    return;
  }
  confirmDelete(current.slug, async () => {
    try {
      await environmentsApi.remove(current.id);
      showSuccess(`${current.slug} is being deleted`);
      router.push({ path: '/environments', query: { project: current.project } });
    } catch (err) {
      showError(errorMessage(err, 'The environment could not be deleted'));
    }
  });
}

onMounted(() => {
  refresh();
  // Follows the status while a job works on the environment.
  poll = setInterval(() => {
    if (busy.value) {
      environmentsApi
        .get(id.value)
        .then((value) => (environment.value = value))
        .catch(() => undefined);
    }
  }, POLL_MS);
});

watch(id, () => {
  loading.value = true;
  environment.value = null;
  refresh();
});

onBeforeUnmount(() => {
  if (poll) {
    clearInterval(poll);
  }
});
</script>
