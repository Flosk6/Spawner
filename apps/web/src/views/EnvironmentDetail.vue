<template>
  <div v-if="loading && !environment" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <div v-else-if="loadError" class="alert tone-danger">
    <CircleX />
    <div class="alert-body"><span class="alert-title">{{ loadError }}</span></div>
    <div class="alert-actions"><RouterLink to="/environments" class="btn btn-secondary btn-sm">Back to the environments</RouterLink></div>
  </div>

  <template v-else-if="environment">
    <div class="env-head">
      <div class="flex min-w-0 flex-1 basis-[30rem] flex-col gap-2">
        <div class="flex flex-wrap items-center gap-2.5">
          <h1 class="page-title break-all">{{ environment.slug }}</h1>
          <EnvironmentStatus :status="environment.status" />
        </div>
        <div class="env-meta">
          <RouterLink :to="{ path: '/environments', query: { project: environment.project } }" class="meta-item font-medium text-fg-2 hover:text-accent-text">
            <FolderGit2 />{{ environment.project }}
          </RouterLink>
          <SourceLabel v-if="primarySource" :source="primarySource" />
          <span class="meta-item">
            <UserAvatar v-if="environment.owner" :user="environment.owner" small />
            <span><span class="font-medium text-fg-2">{{ ownerLabel(environment) }}</span>, {{ timeAgo(environment.createdAt) }} {{ originLabel(environment.createdVia) }}</span>
          </span>
          <span v-if="environment.usage && !deleted" class="meta-item"><MemoryStick />{{ formatSize(environment.usage.memoryBytes) }} of memory now</span>
          <span v-if="environment.expiresAt && !deleted" class="meta-item"><Clock />expires {{ whenDue(environment.expiresAt) }}</span>
          <span v-if="awake && environment.sleepsAt && new Date(environment.sleepsAt) > new Date()" class="meta-item">
            <Moon />sleeps {{ timeLeft(environment.sleepsAt) }} without activity
          </span>
        </div>
        <div v-if="environment.url && !deleted" class="flex min-w-0">
          <div class="url-chip">
            <Globe />
            <a :href="environment.url" target="_blank" rel="noopener">{{ hostOf(environment.url) }}</a>
            <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the URL" v-tooltip.top="'Copy'" @click="copy(environment.url)"><Copy /></button>
          </div>
        </div>
      </div>

      <div v-if="!deleted" class="page-actions">
        <a v-if="environment.url && awake" :href="environment.url" target="_blank" rel="noopener" class="btn btn-primary"><ExternalLink />Open</a>
        <template v-if="manageable">
          <button v-if="environment.status === 'sleeping'" type="button" class="btn btn-primary" :disabled="acting" @click="act('wake')"><Sun />Wake up</button>
          <button v-else-if="environment.status === 'stopped'" type="button" class="btn btn-primary" :disabled="acting" @click="act('start')"><Play />Start</button>
          <button v-else-if="busy && environment.lastJob" type="button" class="btn btn-secondary" @click="showJob(environment.lastJob.id)"><ScrollText />Follow the job</button>

          <div v-if="redeployable && !busy" class="btn-group">
            <button type="button" class="btn" :class="redeployButton" :disabled="acting" @click="redeploy({})"><RefreshCw />Redeploy</button>
            <button type="button" class="btn" :class="redeployButton" aria-label="More ways to redeploy" :disabled="acting" @click="redeployMenu?.toggle($event)">
              <ChevronDown />
            </button>
          </div>
          <button v-else-if="!busy" type="button" class="btn" :class="redeployButton" @click="cliPopover?.toggle($event)"><RefreshCw />Redeploy</button>

          <button type="button" class="btn btn-secondary btn-icon" aria-label="More actions" @click="moreMenu?.toggle($event)"><Ellipsis /></button>
        </template>
      </div>
    </div>

    <div v-if="deleted" class="alert">
      <Trash2 />
      <div class="alert-body">
        <span class="alert-title">Deleted {{ timeAgo(environment.deletedAt) }}</span>
        <span class="alert-text">Its timeline and the last logs of its services stay readable until {{ keptUntil }}.</span>
      </div>
    </div>
    <div v-for="loop in crashLoops" :key="loop.service" class="alert tone-danger">
      <TriangleAlert />
      <div class="alert-body">
        <span class="alert-title">{{ loop.service }} is in a crash loop</span>
        <span class="alert-text">It failed {{ loop.count }} times in {{ loop.windowMinutes }} minutes, last cause: {{ loop.lastCause }}.</span>
      </div>
      <div class="alert-actions"><button type="button" class="btn btn-secondary btn-sm" @click="showLogs(loop.service, true)">See its errors</button></div>
    </div>
    <div v-if="environment.status === 'sleeping'" class="alert tone-sleep">
      <Moon />
      <div class="alert-body">
        <span class="alert-title">Asleep</span>
        <span class="alert-text">
          After {{ formatIdle(environment.idleSeconds) }} without activity: its containers are stopped, its data stays. The next visit to one of its URLs wakes it up.
        </span>
      </div>
    </div>
    <div v-if="environment.status === 'degraded' && environment.error" class="alert tone-warn">
      <TriangleAlert />
      <div class="alert-body">
        <span class="alert-title">Degraded</span>
        <span class="alert-text">{{ environment.error }}. The timeline and the logs say why.</span>
      </div>
      <div class="alert-actions"><button type="button" class="btn btn-secondary btn-sm" @click="tab = 'timeline'">Timeline</button></div>
    </div>
    <div v-if="environment.status === 'failed' && environment.error" class="alert tone-danger">
      <CircleX />
      <div class="alert-body">
        <span class="alert-title">Failed{{ environment.phase ? ` during ${environment.phase}` : '' }}</span>
        <pre class="pre">{{ environment.error }}</pre>
      </div>
      <div v-if="environment.lastJob" class="alert-actions">
        <button type="button" class="btn btn-secondary btn-sm" @click="showJob(environment.lastJob.id)">Read the job log</button>
      </div>
    </div>
    <div v-if="busy && environment.lastJob && tab !== 'jobs'" class="alert tone-info">
      <LoaderCircle class="spinner" />
      <div class="alert-body">
        <span class="alert-title">{{ environment.status === 'queued' ? 'Waiting for its turn' : `${statusLabel(environment.status)}...` }}</span>
        <span class="alert-text">{{ busyNote }}</span>
      </div>
      <div class="alert-actions">
        <button type="button" class="btn btn-secondary btn-sm" @click="showJob(environment.lastJob.id)">Follow the job log</button>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="Environment" @keydown="onTabKeydown">
      <button
        v-for="item in tabs"
        :id="`tab-${item.value}`"
        :key="item.value"
        type="button"
        role="tab"
        class="tab"
        :class="{ 'is-active': tab === item.value }"
        :aria-selected="tab === item.value"
        :aria-controls="`panel-${item.value}`"
        :tabindex="tab === item.value ? 0 : -1"
        @click="tab = item.value"
      >
        <component :is="item.icon" />{{ item.label }}
      </button>
    </div>

    <div :id="`panel-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
      <div v-if="tab === 'overview'" class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="flex min-w-0 flex-col gap-4">
          <section class="card">
            <div class="card-head">
              <div class="card-title"><Box />Services<span class="count">{{ services.length }}</span></div>
              <span v-if="environment.usage && awake" class="field-hint hidden sm:block">
                {{ formatPercent(environment.usage.cpuPercent) }} CPU, {{ formatSize(environment.usage.memoryBytes) }} of memory in all
              </span>
            </div>
            <div v-if="services.length" class="svc-grid">
              <div v-for="service in services" :key="service.name" class="svc" :class="{ 'is-problem': serviceTone(service) === 'danger' }">
                <div class="svc-head">
                  <div class="svc-icon"><component :is="serviceIcon(service.name)" /></div>
                  <div class="min-w-0 flex-1">
                    <div class="svc-name truncate">{{ service.name }}</div>
                    <div class="svc-detail" :title="service.status">{{ uptime(service) }}</div>
                  </div>
                  <span class="badge badge-sm" :class="`tone-${serviceTone(service)}`"><span class="dot"></span>{{ serviceState(service) }}</span>
                </div>
                <div v-if="usage[service.name]">
                  <div class="meter-label">
                    <span>Memory</span><b>{{ formatSize(usage[service.name].memoryBytes) }} of {{ formatSize(usage[service.name].memoryLimitBytes) }}</b>
                  </div>
                  <div class="bar">
                    <span class="bar-fill" :class="memoryShare(service.name) > 85 ? 'bg-warn' : 'bg-accent'" :style="{ width: `${memoryShare(service.name)}%` }"></span>
                  </div>
                </div>
                <div class="svc-foot">
                  <div class="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-1 pl-1">
                    <span v-if="usage[service.name]">CPU {{ formatPercent(usage[service.name].cpuPercent) }}</span>
                    <span v-if="service.restartCount > 0" class="text-warn-text">{{ service.restartCount }} restart{{ service.restartCount === 1 ? '' : 's' }}</span>
                    <span v-if="service.oomKilled" class="text-danger-text">out of memory</span>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm" @click="showLogs(service.name)">Logs</button>
                  <button
                    v-if="manageable && !deleted"
                    type="button"
                    class="btn btn-ghost btn-sm"
                    :disabled="service.state !== 'running'"
                    @click="openTerminal(service.name)"
                  >
                    Terminal
                  </button>
                </div>
              </div>
            </div>
            <div v-else class="empty">{{ deleted ? 'The containers are gone.' : busy ? 'No container yet: they start once the build is done.' : 'No container.' }}</div>
          </section>

          <section class="card">
            <div class="card-head is-flush">
              <div class="card-title"><Globe />URLs</div>
              <span class="field-hint hidden sm:block">The team logs in; a share link lets guests in</span>
            </div>
            <div class="list">
              <div v-if="environment.exposures.length === 0" class="list-row text-fg-3">Known once the environment is deployed.</div>
              <div v-for="exposure in environment.exposures" :key="exposure.name" class="list-row">
                <div class="list-main gap-0.5">
                  <div class="list-title">
                    {{ exposure.name }}
                    <span v-if="exposure.entrypoint" class="badge badge-sm tone-accent">entrypoint</span>
                    <span v-if="exposure.auth === 'none'" class="badge badge-sm tone-warn">public</span>
                    <span class="commit">{{ exposure.service }}:{{ exposure.port }}</span>
                  </div>
                  <a :href="environment.urls[exposure.name]" target="_blank" rel="noopener" class="truncate font-mono text-sm text-fg-2 hover:text-accent-text">{{
                    environment.urls[exposure.name]
                  }}</a>
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the URL" v-tooltip.top="'Copy'" @click="copy(environment.urls[exposure.name])">
                  <Copy />
                </button>
              </div>
            </div>
          </section>

          <section class="card">
            <div class="card-head is-flush"><div class="card-title"><GitBranch />Sources</div></div>
            <div class="list">
              <div v-if="environment.sources.length === 0" class="list-row text-fg-3">Known once the code is fetched.</div>
              <div v-for="source in environment.sources" :key="source.name" class="list-row">
                <div class="svc-icon"><Upload v-if="source.origin === 'upload'" /><GitBranch v-else /></div>
                <div class="list-main">
                  <div class="list-title">
                    {{ source.name }}<span class="truncate text-xs font-normal text-fg-3">{{ source.primary ? 'this repository' : source.repoUrl }}</span>
                  </div>
                  <div class="list-sub font-mono">
                    <template v-if="source.origin === 'upload'">
                      worktree {{ source.digest?.slice(0, 12) }}<template v-if="source.sizeBytes">, {{ formatSize(source.sizeBytes) }}</template>, uncommitted changes included
                    </template>
                    <template v-else>{{ source.ref }}<template v-if="source.commit"> @ {{ source.commit.slice(0, 7) }}</template></template>
                  </div>
                </div>
              </div>
              <div v-if="removedSources" class="list-row">
                <p class="field-hint">The code of {{ removedSources }} was removed after the build, which alone needed it: the next deploy brings it back.</p>
              </div>
            </div>
          </section>
        </div>

        <div class="flex min-w-0 flex-col gap-4">
          <section v-if="!deleted" class="card">
            <div class="card-head"><div class="card-title"><Clock />Lifecycle</div></div>
            <div class="card-body flex flex-col gap-4">
              <dl class="kv">
                <dt>Expires</dt>
                <dd>
                  {{ environment.expiresAt ? whenDue(environment.expiresAt) : 'Never' }}
                  <small v-if="environment.expiresAt">{{ new Date(environment.expiresAt).toLocaleString() }}</small>
                </dd>
                <dt>Sleeps</dt>
                <dd>
                  {{ sleepState }}
                  <small>{{ environment.idleSeconds ? `after ${formatIdle(environment.idleSeconds)} without activity` : 'never: idle is set to never' }}</small>
                </dd>
                <dt>Last activity</dt>
                <dd>{{ environment.lastActivityAt ? timeAgo(environment.lastActivityAt) : '-' }}</dd>
              </dl>
              <div v-if="manageable && environment.expiresAt" class="flex flex-wrap items-center justify-between gap-2">
                <span class="field-hint">Keep it longer</span>
                <div class="seg">
                  <button v-for="option in EXTEND_OPTIONS" :key="option.ttl" type="button" class="seg-btn" :disabled="acting" @click="extend(option.ttl)">
                    {{ option.label }}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section v-if="manageable && !deleted && environment.exposures.length > 0" class="card">
            <div class="card-head"><div class="card-title"><Link />Share</div></div>
            <div class="card-body flex flex-col gap-3">
              <p class="field-hint">A link lets someone without an account open the URLs until it expires. The team just logs in.</p>
              <div class="flex items-center gap-2">
                <Select v-model="shareHours" :options="SHARE_DURATIONS" option-label="label" option-value="value" class="min-w-0 flex-1" aria-label="Valid for" />
                <button type="button" class="btn btn-secondary" :disabled="sharing" @click="share"><LoaderCircle v-if="sharing" class="spinner" /><Plus v-else />Create a link</button>
              </div>
              <div v-if="sharedLink" class="alert tone-ok">
                <CircleCheck />
                <div class="alert-body gap-2">
                  <span class="alert-text">Copy it now: it is shown once. It works until {{ new Date(sharedLink.expiresAt).toLocaleString() }}.</span>
                  <div class="cmd">
                    <span class="cmd-text">{{ sharedLink.url }}</span>
                    <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the link" @click="copy(sharedLink.url)"><Copy /></button>
                  </div>
                </div>
                <button type="button" class="btn btn-ghost btn-sm btn-icon -mr-1 -mt-1 self-start" aria-label="Dismiss" @click="sharedLink = null"><X /></button>
              </div>
              <ul v-if="shares.length > 0" class="flex flex-col">
                <li v-for="link in shares" :key="link.id" class="flex items-center justify-between gap-3 border-t py-2 first:border-t-0">
                  <div class="flex min-w-0 flex-col leading-5">
                    <span class="truncate text-sm font-medium">Link by {{ link.createdBy ?? 'the installation token' }}</span>
                    <span class="text-xs text-fg-3">{{ timeAgo(link.createdAt) }}, expires {{ timeLeft(link.expiresAt) }}</span>
                  </div>
                  <button type="button" class="btn btn-ghost btn-sm" @click="revokeShare(link.id)">Revoke</button>
                </li>
              </ul>
            </div>
          </section>

          <DiskPanel v-if="!deleted" :environment-id="environment.id" />
        </div>
      </div>

      <LogViewer
        v-else-if="tab === 'logs'"
        :key="logsKey"
        :environment-id="environment.id"
        :services="serviceNames"
        :archived="deleted"
        :initial-service="logService"
        :initial-errors="logErrors"
      />

      <ResourcePanel v-else-if="tab === 'resources'" :environment-id="environment.id" />

      <TimelinePanel
        v-else-if="tab === 'timeline'"
        :environment-id="environment.id"
        :live="!deleted"
        @logs="(name: string) => showLogs(name, true)"
        @job="showJob"
      />

      <JobsPanel
        v-else-if="tab === 'jobs'"
        :environment-id="environment.id"
        :environment-status="environment.status"
        :last-job-id="environment.lastJob?.id"
        :focus-job="focusJob"
        @finished="refresh"
      />

      <section v-else-if="tab === 'terminal' && manageable && !deleted" class="card">
        <div class="card-head flex-wrap">
          <div class="flex min-w-0 flex-wrap items-center gap-3">
            <SegmentedControl v-if="runningServices.length" v-model="terminalService" :options="terminalOptions" label="Service" />
            <span class="field-hint">Recorded for the admins; closes after 15 minutes without input, 4 hours at most.</span>
          </div>
        </div>
        <div v-if="terminalService" class="p-3">
          <XtermTerminal :key="terminalService" :environment-id="environment.id" :resource-name="terminalService" />
        </div>
        <div v-else class="empty">No running service to open a terminal in.</div>
      </section>
    </div>

    <ActionMenu ref="moreMenu" :items="moreItems" />
    <ActionMenu ref="redeployMenu" :items="redeployItems" />
    <Popover ref="cliPopover">
      <div class="flex w-80 max-w-[calc(100vw-3rem)] flex-col gap-2 p-1">
        <span class="text-base font-semibold">Redeploy from its worktree</span>
        <span class="field-hint">It runs code that <code>spawner up</code> sent, uncommitted changes included. Send it again from the same worktree:</span>
        <div class="cmd">
          <span class="cmd-text">spawner up {{ environment.slug }} --wait</span>
          <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the command" @click="copy(`spawner up ${environment.slug} --wait`)"><Copy /></button>
        </div>
      </div>
    </Popover>
  </template>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Popover from 'primevue/popover';
import Select from 'primevue/select';
import {
  Activity,
  Box,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  Copy,
  Database,
  Ellipsis,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Globe,
  History,
  LayoutDashboard,
  Link,
  ListChecks,
  LoaderCircle,
  Mail,
  MemoryStick,
  Moon,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Sprout,
  Square,
  SquareTerminal,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-vue-next';
import ActionMenu, { type MenuAction } from '../components/ActionMenu.vue';
import DiskPanel from '../components/DiskPanel.vue';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import JobsPanel from '../components/JobsPanel.vue';
import LogViewer from '../components/LogViewer.vue';
import ResourcePanel from '../components/ResourcePanel.vue';
import SegmentedControl from '../components/SegmentedControl.vue';
import SourceLabel from '../components/SourceLabel.vue';
import TimelinePanel from '../components/TimelinePanel.vue';
import UserAvatar from '../components/UserAvatar.vue';
import XtermTerminal from '../components/XtermTerminal.vue';
import { setBreadcrumbs } from '../composables/useBreadcrumbs';
import { useNotification } from '../composables/useNotification';
import { useAuthStore } from '../stores/auth';
import { environmentsApi, errorMessage } from '../services/api';
import type { CrashLoop, CreatedShareLink, Environment, EnvironmentMetrics, JobAccepted, ServiceState, ShareLink } from '../types';
import { canManage, isBusy, originLabel, ownerLabel, redeployRequest, statusLabel, type Tone } from '../utils/environment';
import { timeAgo, timeLeft, whenDue } from '../utils/format';
import { formatPercent, formatSize } from '../utils/palette';

const POLL_MS = 3000;
const SERVICES_POLL_MS = 15_000;
const KEPT_DAYS = 7;
const TABS = ['overview', 'logs', 'resources', 'timeline', 'jobs', 'terminal'] as const;
type TabName = (typeof TABS)[number];

const SHARE_DURATIONS = [
  { label: 'For 1 hour', value: 1 },
  { label: 'For 1 day', value: 24 },
  { label: 'For 1 week', value: 168 },
];

const EXTEND_OPTIONS = [
  { label: '1 day', ttl: '24h' },
  { label: '3 days', ttl: '72h' },
  { label: '1 week', ttl: '168h' },
];

/** The badge of a running service that has a healthcheck. */
const HEALTH_LABELS: Record<string, string> = { healthy: 'Healthy', unhealthy: 'Unhealthy', starting: 'Starting' };

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const { showError, showSuccess, confirmAction, confirmDelete } = useNotification();

const environment = ref<Environment | null>(null);
const services = ref<ServiceState[]>([]);
const usage = ref<NonNullable<EnvironmentMetrics['now']>['services']>({});
const crashLoops = ref<CrashLoop[]>([]);
const loading = ref(true);
const loadError = ref('');
const acting = ref(false);
const tab = ref<TabName>(TABS.includes(route.query.tab as TabName) ? (route.query.tab as TabName) : 'overview');
const logService = ref<string | null>(null);
const logErrors = ref(false);
const logsKey = ref(0);
const focusJob = ref<string | null>(null);
const terminalService = ref<string | null>(null);
const moreMenu = ref<InstanceType<typeof ActionMenu> | null>(null);
const redeployMenu = ref<InstanceType<typeof ActionMenu> | null>(null);
const cliPopover = ref<InstanceType<typeof Popover> | null>(null);
const shareHours = ref(24);
const shares = ref<ShareLink[]>([]);
const sharedLink = ref<CreatedShareLink | null>(null);
const sharing = ref(false);
let poll: ReturnType<typeof setInterval> | null = null;
let servicesPoll: ReturnType<typeof setInterval> | null = null;

const id = computed(() => route.params.id as string);
const deleted = computed(() => Boolean(environment.value?.deletedAt));
const busy = computed(() => (environment.value ? isBusy(environment.value.status) : false));
const awake = computed(() => ['ready', 'degraded'].includes(environment.value?.status ?? ''));
const manageable = computed(() => (environment.value ? canManage(authStore.user, environment.value) : false));
const redeployable = computed(() => (environment.value ? redeployRequest(environment.value) !== null : false));
/** Redeploying is the way out of a failure: there it is the main action. */
const redeployButton = computed(() => (environment.value?.status === 'failed' ? 'btn-primary' : 'btn-secondary'));
const primarySource = computed(() => environment.value?.sources.find((source) => source.primary) ?? null);
const serviceNames = computed(() => {
  const names = new Set(services.value.map((service) => service.name));
  environment.value?.exposures.forEach((exposure) => names.add(exposure.service));
  return [...names].sort();
});
const runningServices = computed(() => services.value.filter((service) => service.state === 'running').map((service) => service.name));
const terminalOptions = computed(() => runningServices.value.map((name) => ({ label: name, value: name as string | null })));
const removedSources = computed(() =>
  (environment.value?.sources ?? [])
    .filter((source) => !source.onDisk)
    .map((source) => source.name)
    .join(', '),
);
const keptUntil = computed(() =>
  environment.value?.deletedAt ? new Date(new Date(environment.value.deletedAt).getTime() + KEPT_DAYS * 86_400_000).toLocaleString() : '',
);

/** When the environment goes to sleep: only an awake one counts down. */
const sleepState = computed(() => {
  const current = environment.value;
  if (!current || current.idleSeconds === 0) {
    return 'Never';
  }
  if (current.status === 'sleeping') {
    return 'Asleep';
  }
  if (current.status !== 'ready' && current.status !== 'degraded') {
    return '-';
  }
  return current.sleepsAt && new Date(current.sleepsAt) > new Date() ? timeLeft(current.sleepsAt) : 'Soon';
});

/** What the running job leads to, from its type. */
const busyNote = computed(() => {
  switch (environment.value?.lastJob?.type) {
    case 'stop':
      return 'Its containers stop; its data stays.';
    case 'sleep':
      return 'Its containers stop until the next visit; its data stays.';
    case 'delete':
      return 'Its containers, volumes and code are removed.';
    default:
      return 'Its URLs answer once the job is done.';
  }
});

const tabs = computed(() => {
  const all: { value: TabName; label: string; icon: Component }[] = [
    { value: 'overview', label: 'Overview', icon: LayoutDashboard },
    { value: 'logs', label: 'Logs', icon: ScrollText },
    { value: 'resources', label: 'Resources', icon: Activity },
    { value: 'timeline', label: 'Timeline', icon: History },
    { value: 'jobs', label: 'Jobs', icon: ListChecks },
    { value: 'terminal', label: 'Terminal', icon: SquareTerminal },
  ];
  return all.filter((item) => item.value !== 'terminal' || (manageable.value && !deleted.value));
});

/** A tab the reader may not open (?tab=terminal on someone else's environment) falls back to the overview, once the environment is known. */
watch([tabs, () => environment.value?.id], ([list]) => {
  if (environment.value && !list.some((item) => item.value === tab.value)) {
    tab.value = 'overview';
  }
});

/** Arrow keys, Home and End move between the tabs, as in a WAI-ARIA tab list. */
function onTabKeydown(event: KeyboardEvent) {
  const values = tabs.value.map((item) => item.value);
  const index = values.indexOf(tab.value);
  const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: values.length - 1 };
  if (!(event.key in moves)) {
    return;
  }
  event.preventDefault();
  const list = event.currentTarget as HTMLElement;
  tab.value = values[(moves[event.key] + values.length) % values.length];
  nextTick(() => list.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
}

const moreItems = computed<MenuAction[]>(() => {
  const current = environment.value;
  if (!current) {
    return [];
  }
  const items: MenuAction[] = [];
  if (awake.value) {
    items.push({ label: 'Sleep now', icon: Moon, hint: 'until the next visit', disabled: acting.value, command: () => act('sleep') });
  }
  if (current.status === 'ready') {
    items.push({ label: 'Stop', icon: Square, disabled: acting.value, command: () => act('stop') });
  }
  if (current.expiresAt) {
    items.push(...EXTEND_OPTIONS.map((option) => ({ label: `Keep ${option.label} more`, icon: Clock, disabled: acting.value, command: () => extend(option.ttl) })));
  }
  return [
    ...items,
    ...(items.length ? [{ separator: true }] : []),
    { label: 'Delete environment', icon: Trash2, danger: true, disabled: current.status === 'deleting' || acting.value, command: confirmRemove },
  ];
});

const redeployItems = computed<MenuAction[]>(() => [
  { label: 'Redeploy', icon: RefreshCw, hint: 'latest commits', command: () => redeploy({}) },
  { label: 'Redeploy and replay the seed', icon: Sprout, command: () => redeploy({ reseed: true }) },
  {
    label: 'Redeploy from scratch',
    icon: Database,
    hint: 'deletes the data',
    danger: true,
    command: () =>
      confirmAction('The containers and volumes of this environment are removed, then it is rebuilt and seeded again. Its data is lost.', () => redeploy({ fresh: true }), {
        header: 'Redeploy from scratch',
        danger: true,
      }),
  },
]);

watch(tab, (value) => {
  router.replace({ query: { ...route.query, tab: value === 'overview' ? undefined : value } });
});

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

/** "2 hours", "45 minutes". */
function formatIdle(seconds: number): string {
  if (seconds % 3600 === 0) {
    return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`;
  }
  return `${Math.round(seconds / 60)} minutes`;
}

function serviceIcon(name: string): Component {
  if (/db|sql|postgres|maria|mongo|redis|valkey|meili|elastic|search/i.test(name)) {
    return Database;
  }
  return /mail|smtp/i.test(name) ? Mail : Box;
}

function serviceTone(service: ServiceState): Tone {
  if (service.state === 'restarting' || service.oomKilled || service.health === 'unhealthy' || (service.state === 'exited' && service.exitCode !== 0)) {
    return 'danger';
  }
  if (service.state === 'running') {
    return service.health === 'starting' ? 'info' : 'ok';
  }
  return 'muted';
}

function serviceState(service: ServiceState): string {
  if (service.state === 'running') {
    return (service.health && HEALTH_LABELS[service.health]) || 'Running';
  }
  if (service.state === 'exited' && service.exitCode !== null) {
    return `Exited ${service.exitCode}`;
  }
  return statusLabel(service.state);
}

/** Docker's status without the health it ends with, which the badge shows: "Up 3 hours". */
function uptime(service: ServiceState): string {
  return service.status.replace(/\s*\((healthy|unhealthy|health: starting)\)$/, '');
}

function memoryShare(name: string): number {
  const now = usage.value[name];
  return now?.memoryLimitBytes ? Math.min(100, (now.memoryBytes / now.memoryLimitBytes) * 100) : 0;
}

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

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

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
  confirmAction(
    'Whoever uses this link loses access at once.',
    async () => {
      try {
        await environmentsApi.revokeShare(id.value, shareId);
        await loadShares();
      } catch (err) {
        showError(errorMessage(err, 'The link could not be revoked'));
      }
    },
    { header: 'Revoke this link?', acceptLabel: 'Revoke', danger: true },
  );
}

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

async function refresh() {
  try {
    environment.value = await environmentsApi.get(id.value);
    loadError.value = '';
  } catch (err) {
    loadError.value = errorMessage(err, 'The environment could not be loaded');
  } finally {
    loading.value = false;
  }
  await Promise.all([loadServices(), loadShares(), loadCrashLoops(), loadUsage()]);
}

async function loadServices() {
  services.value = await environmentsApi.services(id.value).catch(() => []);
  if (!terminalService.value || !runningServices.value.includes(terminalService.value)) {
    terminalService.value = runningServices.value[0] ?? null;
  }
}

/** Memory and CPU of each service at the last sample, taken every 30 seconds. */
async function loadUsage() {
  usage.value = deleted.value ? {} : await environmentsApi.metrics(id.value, '1h').then((metrics) => metrics.now?.services ?? {}).catch(() => ({}));
}

async function loadCrashLoops() {
  crashLoops.value = deleted.value ? [] : await environmentsApi.events(id.value).then((result) => result.crashLoops).catch(() => []);
}

function accepted(result: { environment: Environment; job: JobAccepted['job'] | null }) {
  environment.value = { ...result.environment, lastJob: result.job ?? result.environment.lastJob };
}

async function act(action: 'stop' | 'start' | 'sleep' | 'wake') {
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

watch(
  () => (environment.value ? `${environment.value.project}/${environment.value.slug}` : ''),
  (key) => {
    if (key) {
      const [project, slug] = key.split('/');
      setBreadcrumbs([{ label: 'Environments', to: '/environments' }, { label: project, to: { path: '/environments', query: { project } } }, { label: slug }]);
    }
  },
);

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
      void loadUsage();
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
