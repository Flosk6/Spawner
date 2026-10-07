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
      <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
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
            Created {{ timeAgo(environment.createdAt) }} by {{ ownerLabel(environment) }}, from the {{ environment.createdVia }}
            <template v-if="environment.usage"> · {{ formatSize(environment.usage.memoryBytes) }} of memory now</template>
            <template v-if="environment.expiresAt && !deleted && environment.status !== 'failed'"> · expires {{ timeLeft(environment.expiresAt) }}</template>
          </p>
        </div>

        <div v-if="!deleted" class="flex flex-wrap items-center gap-2">
          <a v-if="environment.url && environment.status === 'ready'" :href="environment.url" target="_blank" rel="noopener">
            <Button label="Open" icon="pi pi-external-link" />
          </a>
          <span v-if="manageable" v-tooltip.bottom="redeployBlocked ?? ''">
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
            v-if="manageable && environment.status === 'ready'"
            label="Stop"
            icon="pi pi-pause"
            severity="secondary"
            outlined
            :disabled="busy || acting"
            @click="act('stop')"
          />
          <Button
            v-if="manageable && environment.status === 'stopped'"
            label="Start"
            icon="pi pi-play"
            severity="secondary"
            outlined
            :disabled="busy || acting"
            @click="act('start')"
          />
          <Button v-if="manageable && environment.expiresAt" label="Extend" icon="pi pi-clock" severity="secondary" outlined :disabled="acting" @click="extendMenu?.toggle($event)" />
          <Menu ref="extendMenu" :model="extendOptions" popup />
          <Button
            v-if="manageable"
            label="Delete"
            icon="pi pi-trash"
            severity="danger"
            outlined
            :disabled="environment.status === 'deleting' || acting"
            @click="confirmRemove"
          />
        </div>
      </div>

      <Message v-if="deleted" severity="secondary" :closable="false" class="mb-6">
        Deleted {{ timeAgo(environment.deletedAt) }}. Its timeline and the last logs of its services stay readable until
        {{ keptUntil }}.
      </Message>
      <Message v-for="loop in crashLoops" :key="loop.service" severity="error" :closable="false" class="mb-4">
        <span class="font-semibold">{{ loop.service }}</span> failed {{ loop.count }} times in {{ loop.windowMinutes }} minutes, last cause:
        {{ loop.lastCause }}.
        <button class="underline ml-1" @click="showLogs(loop.service, true)">See its errors</button>
      </Message>
      <Message v-if="environment.status === 'failed' && environment.error" severity="error" :closable="false" class="mb-6">
        <div class="font-semibold mb-1">Failed{{ environment.phase ? ` during ${environment.phase}` : '' }}</div>
        <pre class="whitespace-pre-wrap text-sm font-mono">{{ environment.error }}</pre>
        <button v-if="environment.lastJob" class="underline text-sm mt-2" @click="showJob(environment.lastJob.id)">Read the job log</button>
      </Message>
      <Message v-if="busy && environment.lastJob && tab !== 'jobs'" severity="info" :closable="false" class="mb-6">
        {{ environment.status === 'queued' ? 'Waiting for its turn' : `${environment.status.charAt(0).toUpperCase()}${environment.status.slice(1)}` }}...
        <button class="underline ml-1" @click="showJob(environment.lastJob.id)">Follow the job log</button>
      </Message>

      <Tabs v-model:value="tab">
        <TabList>
          <Tab value="overview">Overview</Tab>
          <Tab value="logs">Logs</Tab>
          <Tab value="resources">Resources</Tab>
          <Tab value="timeline">Timeline</Tab>
          <Tab value="jobs">Jobs</Tab>
          <Tab v-if="manageable && !deleted" value="terminal">Terminal</Tab>
        </TabList>
        <TabPanels class="!px-0">
          <TabPanel value="overview">
            <div v-if="tab === 'overview'" class="space-y-6">
              <div class="grid gap-6 lg:grid-cols-2">
                <section class="panel">
                  <h2 class="panel-title"><i class="pi pi-globe text-sm"></i>URLs</h2>
                  <p v-if="environment.exposures.length === 0" class="text-sm text-slate-500">Known once the environment is deployed.</p>
                  <ul v-else class="space-y-3">
                    <li v-for="exposure in environment.exposures" :key="exposure.name" class="flex flex-wrap items-center justify-between gap-2">
                      <div class="flex items-center gap-2 min-w-0">
                        <span class="font-medium text-slate-900 dark:text-white">{{ exposure.name }}</span>
                        <span
                          v-if="exposure.entrypoint"
                          class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300"
                          >entrypoint</span
                        >
                        <span v-if="exposure.auth === 'none'" class="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                          >public</span
                        >
                        <span class="text-xs text-slate-500 font-mono">{{ exposure.service }}:{{ exposure.port }}</span>
                      </div>
                      <a :href="environment.urls[exposure.name]" target="_blank" rel="noopener" class="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline break-all">{{
                        environment.urls[exposure.name]
                      }}</a>
                    </li>
                  </ul>
                </section>

                <section class="panel">
                  <h2 class="panel-title"><i class="pi pi-code-branch text-sm"></i>Sources</h2>
                  <p v-if="environment.sources.length === 0" class="text-sm text-slate-500">Known once the code is fetched.</p>
                  <ul v-else class="space-y-3">
                    <li v-for="source in environment.sources" :key="source.name" class="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span class="font-medium text-slate-900 dark:text-white">{{ source.name }}</span>
                      <span v-if="source.origin === 'upload'" class="text-slate-500">
                        <i class="pi pi-upload text-xs mr-1"></i>uploaded worktree, uncommitted changes included
                        <span class="font-mono">{{ source.digest?.slice(0, 12) }}</span>
                        <template v-if="source.sizeBytes"> · {{ formatSize(source.sizeBytes) }}</template>
                      </span>
                      <span v-else class="text-slate-500 font-mono break-all">
                        {{ source.ref }}<template v-if="source.commit"> @ {{ source.commit.slice(0, 7) }}</template>
                      </span>
                    </li>
                  </ul>
                </section>
              </div>

              <section class="panel">
                <h2 class="panel-title"><i class="pi pi-box text-sm"></i>Services</h2>
                <p v-if="services.length === 0" class="text-sm text-slate-500">{{ deleted ? 'The containers are gone.' : 'No container yet.' }}</p>
                <div v-else class="overflow-x-auto">
                  <table class="w-full text-sm">
                    <thead class="text-left text-xs uppercase text-slate-500">
                      <tr>
                        <th class="py-2 pr-4">Service</th>
                        <th class="py-2 pr-4">State</th>
                        <th class="py-2 pr-4">Health</th>
                        <th class="py-2 pr-4">Restarts</th>
                        <th class="py-2 pr-4">Out of memory</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-200 dark:divide-purple-800/30">
                      <tr v-for="service in services" :key="service.name">
                        <td class="py-2 pr-4 font-medium">{{ service.name }}</td>
                        <td class="py-2 pr-4">
                          <span :class="service.state === 'running' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">{{ service.state }}</span>
                          <span v-if="service.exitCode !== null && service.state !== 'running'" class="text-slate-500"> (exit {{ service.exitCode }})</span>
                        </td>
                        <td class="py-2 pr-4">
                          <span :class="service.health === 'unhealthy' ? 'text-red-600 dark:text-red-400' : service.health === 'healthy' ? 'text-green-600 dark:text-green-400' : 'text-slate-500'">{{
                            service.health ?? '-'
                          }}</span>
                        </td>
                        <td class="py-2 pr-4" :class="service.restartCount > 0 ? 'text-amber-600 dark:text-amber-400 font-semibold' : ''">{{ service.restartCount }}</td>
                        <td class="py-2 pr-4">
                          <span v-if="service.oomKilled" class="text-red-600 dark:text-red-400 font-semibold">yes</span><span v-else class="text-slate-500">-</span>
                        </td>
                        <td class="py-2 text-right whitespace-nowrap">
                          <Button label="Logs" size="small" text @click="showLogs(service.name)" />
                          <Button
                            v-if="manageable && !deleted"
                            label="Terminal"
                            size="small"
                            text
                            :disabled="service.state !== 'running'"
                            @click="openTerminal(service.name)"
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <div class="grid gap-6 lg:grid-cols-2">
                <section v-if="manageable && !deleted && environment.exposures.length > 0" class="panel">
                  <div class="flex flex-wrap items-center justify-between gap-3 mb-2">
                    <h2 class="panel-title !mb-0"><i class="pi pi-share-alt text-sm"></i>Share</h2>
                    <div class="flex items-center gap-2">
                      <Select v-model="shareHours" :options="shareDurations" option-label="label" option-value="value" size="small" class="w-32" />
                      <Button label="Create a link" icon="pi pi-link" size="small" :loading="sharing" @click="share" />
                    </div>
                  </div>
                  <p class="field-hint mb-3">The team opens the URLs once logged in. A link lets someone without an account in, until it expires.</p>
                  <Message v-if="sharedLink" severity="success" :closable="true" class="mb-3" @close="sharedLink = null">
                    <p class="mb-2">Copy this link now: it will not be shown again. It works until {{ new Date(sharedLink.expiresAt).toLocaleString() }}.</p>
                    <div class="flex items-center gap-2">
                      <code class="flex-1 break-all text-xs bg-white/60 dark:bg-black/20 rounded px-2 py-1">{{ sharedLink.url }}</code>
                      <Button icon="pi pi-copy" size="small" text v-tooltip.top="'Copy'" @click="copy(sharedLink.url)" />
                    </div>
                  </Message>
                  <ul v-if="shares.length > 0" class="divide-y divide-slate-200 dark:divide-purple-800/30">
                    <li v-for="link in shares" :key="link.id" class="flex items-center justify-between gap-3 py-2 text-sm">
                      <span>Link by {{ link.createdBy ?? 'the installation token' }}, {{ timeAgo(link.createdAt) }}, expires {{ timeLeft(link.expiresAt) }}</span>
                      <Button icon="pi pi-times" severity="danger" text rounded size="small" v-tooltip.top="'Revoke'" @click="revokeShare(link.id)" />
                    </li>
                  </ul>
                </section>

                <section v-if="!deleted" class="panel">
                  <h2 class="panel-title"><i class="pi pi-database text-sm"></i>Disk</h2>
                  <DiskPanel :environment-id="environment.id" />
                </section>
              </div>
            </div>
          </TabPanel>

          <TabPanel value="logs">
            <section v-if="tab === 'logs'" class="panel">
              <LogViewer
                :key="logsKey"
                :environment-id="environment.id"
                :services="serviceNames"
                :archived="deleted"
                :initial-service="logService"
                :initial-errors="logErrors"
              />
            </section>
          </TabPanel>

          <TabPanel value="resources">
            <section v-if="tab === 'resources'" class="panel">
              <ResourcePanel :environment-id="environment.id" />
            </section>
          </TabPanel>

          <TabPanel value="timeline">
            <section v-if="tab === 'timeline'" class="panel">
              <TimelinePanel :environment-id="environment.id" :live="!deleted" @logs="(name: string) => showLogs(name, true)" @job="showJob" />
            </section>
          </TabPanel>

          <TabPanel value="jobs">
            <section v-if="tab === 'jobs'" class="panel">
              <JobsPanel :environment-id="environment.id" :last-job-id="environment.lastJob?.id" :focus-job="focusJob" @finished="refresh" />
            </section>
          </TabPanel>

          <TabPanel v-if="manageable && !deleted" value="terminal">
            <section v-if="tab === 'terminal'" class="panel">
              <div class="flex flex-wrap items-center gap-2 mb-4">
                <span class="text-sm text-slate-500">Service</span>
                <Select v-model="terminalService" :options="runningServices" class="w-48" size="small" placeholder="Choose a service" />
                <span class="field-hint !mt-0">Sessions are recorded for the admins, close after 15 minutes without input, and last 4 hours at most.</span>
              </div>
              <XtermTerminal v-if="terminalService" :key="terminalService" :environment-id="environment.id" :resource-name="terminalService" />
              <p v-else class="text-sm text-slate-500">No running service.</p>
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button';
import Menu from 'primevue/menu';
import Message from 'primevue/message';
import ProgressSpinner from 'primevue/progressspinner';
import Select from 'primevue/select';
import SplitButton from 'primevue/splitbutton';
import Tab from 'primevue/tab';
import TabList from 'primevue/tablist';
import TabPanel from 'primevue/tabpanel';
import TabPanels from 'primevue/tabpanels';
import Tabs from 'primevue/tabs';
import DiskPanel from '../components/DiskPanel.vue';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import JobsPanel from '../components/JobsPanel.vue';
import LogViewer from '../components/LogViewer.vue';
import ResourcePanel from '../components/ResourcePanel.vue';
import TimelinePanel from '../components/TimelinePanel.vue';
import XtermTerminal from '../components/XtermTerminal.vue';
import { useNotification } from '../composables/useNotification';
import { useAuthStore } from '../stores/auth';
import { environmentsApi, errorMessage } from '../services/api';
import type { CrashLoop, CreatedShareLink, Environment, JobAccepted, ServiceState, ShareLink } from '../types';
import { canManage, isBusy, ownerLabel, redeployRequest } from '../utils/environment';
import { timeAgo, timeLeft } from '../utils/format';
import { formatSize } from '../utils/palette';

const POLL_MS = 3000;
const SERVICES_POLL_MS = 15_000;
const TABS = ['overview', 'logs', 'resources', 'timeline', 'jobs', 'terminal'];
const KEPT_DAYS = 7;

const route = useRoute();
const router = useRouter();
const { showError, showSuccess, confirmAction, confirmDelete } = useNotification();

const environment = ref<Environment | null>(null);
const services = ref<ServiceState[]>([]);
const crashLoops = ref<CrashLoop[]>([]);
const loading = ref(true);
const loadError = ref('');
const acting = ref(false);
const tab = ref(TABS.includes(String(route.query.tab)) ? String(route.query.tab) : 'overview');
const logService = ref<string | null>(null);
const logErrors = ref(false);
const logsKey = ref(0);
const focusJob = ref<string | null>(null);
const terminalService = ref<string | null>(null);
const extendMenu = ref<InstanceType<typeof Menu> | null>(null);
let poll: ReturnType<typeof setInterval> | null = null;
let servicesPoll: ReturnType<typeof setInterval> | null = null;

const id = computed(() => route.params.id as string);
const deleted = computed(() => Boolean(environment.value?.deletedAt));
const busy = computed(() => (environment.value ? isBusy(environment.value.status) : false));
const serviceNames = computed(() => {
  const names = new Set(services.value.map((service) => service.name));
  environment.value?.exposures.forEach((exposure) => names.add(exposure.service));
  return [...names].sort();
});
const runningServices = computed(() => services.value.filter((service) => service.state === 'running').map((service) => service.name));
const keptUntil = computed(() =>
  environment.value?.deletedAt ? new Date(new Date(environment.value.deletedAt).getTime() + KEPT_DAYS * 86_400_000).toLocaleString() : '',
);

const authStore = useAuthStore();
const manageable = computed(() => (environment.value ? canManage(authStore.user, environment.value) : false));

watch(tab, (value) => {
  router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } });
});

function showLogs(service: string | null, errors = false) {
  logService.value = service;
  logErrors.value = errors;
  logsKey.value++;
  tab.value = 'logs';
}

function showJob(jobId: string) {
  focusJob.value = jobId;
  tab.value = 'jobs';
}

function openTerminal(service: string) {
  terminalService.value = service;
  tab.value = 'terminal';
}

const shareDurations = [
  { label: '1 hour', value: 1 },
  { label: '1 day', value: 24 },
  { label: '1 week', value: 168 },
];
const shareHours = ref(24);
const shares = ref<ShareLink[]>([]);
const sharedLink = ref<CreatedShareLink | null>(null);
const sharing = ref(false);

async function loadShares() {
  shares.value = manageable.value && !deleted.value ? await environmentsApi.shares(id.value).catch(() => []) : [];
}

async function share() {
  sharing.value = true;
  try {
    sharedLink.value = await environmentsApi.share(id.value, shareHours.value);
    await loadShares();
  } catch (err) {
    showError(errorMessage(err, 'The link could not be created'));
  } finally {
    sharing.value = false;
  }
}

function revokeShare(shareId: string) {
  confirmAction('Revoke this link? Whoever uses it loses access at once.', async () => {
    try {
      await environmentsApi.revokeShare(id.value, shareId);
      await loadShares();
    } catch (err) {
      showError(errorMessage(err, 'The link could not be revoked'));
    }
  });
}

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

const extendOptions = [
  { label: 'Keep 1 more day', command: () => extend('24h') },
  { label: 'Keep 3 more days', command: () => extend('72h') },
  { label: 'Keep 1 more week', command: () => extend('168h') },
];

async function extend(ttl: string) {
  acting.value = true;
  try {
    const updated = await environmentsApi.extend(id.value, ttl);
    environment.value = updated;
    showSuccess(`Expires ${timeLeft(updated.expiresAt)}`);
  } catch (err) {
    showError(errorMessage(err, 'The expiry could not be postponed'));
  } finally {
    acting.value = false;
  }
}

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
  await Promise.all([loadServices(), loadShares(), loadCrashLoops()]);
}

async function loadServices() {
  services.value = await environmentsApi.services(id.value).catch(() => []);
  if (!terminalService.value || !runningServices.value.includes(terminalService.value)) {
    terminalService.value = runningServices.value[0] ?? null;
  }
}

async function loadCrashLoops() {
  crashLoops.value = deleted.value ? [] : await environmentsApi.events(id.value).then((result) => result.crashLoops).catch(() => []);
}

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
  confirmDelete(
    current.slug,
    async () => {
      try {
        await environmentsApi.remove(current.id);
        showSuccess(`${current.slug} is being deleted`);
        router.push({ path: '/environments', query: { project: current.project } });
      } catch (err) {
        showError(errorMessage(err, 'The environment could not be deleted'));
      }
    },
    'Its containers, volumes and data are removed for good; its timeline and last logs stay readable for 7 days.',
  );
}

onMounted(() => {
  refresh();
  // Follows the status while a job works on the environment, and the services otherwise.
  poll = setInterval(() => {
    if (busy.value) {
      environmentsApi
        .get(id.value)
        .then((value) => (environment.value = value))
        .catch(() => undefined);
    }
  }, POLL_MS);
  servicesPoll = setInterval(() => {
    if (!deleted.value && tab.value === 'overview') {
      void loadServices();
      void loadCrashLoops();
    }
  }, SERVICES_POLL_MS);
});

watch(id, () => {
  loading.value = true;
  environment.value = null;
  refresh();
});

watch(busy, (now, before) => {
  if (before && !now) {
    void refresh();
  }
});

onBeforeUnmount(() => {
  if (poll) {
    clearInterval(poll);
  }
  if (servicesPoll) {
    clearInterval(servicesPoll);
  }
});
</script>
