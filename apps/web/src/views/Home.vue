<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">Overview</h1>
      <p class="page-lead">What runs on {{ info?.previewDomain ?? 'this server' }}, and the room left for more.</p>
    </div>
    <div class="page-actions">
      <RouterLink to="/environments" class="btn btn-secondary">All environments</RouterLink>
      <RouterLink :to="{ path: '/environments', query: { new: '1' } }" class="btn btn-primary"><Plus />New environment</RouterLink>
    </div>
  </div>

  <div v-if="loading" class="flex justify-center py-16"><LoaderCircle class="spinner size-6 text-fg-3" /></div>

  <template v-else>
    <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <section class="card stat">
        <div class="stat-label"><Layers />Live environments</div>
        <div class="stat-value">{{ environments.length }}<small>{{ count('ready') }} ready</small></div>
        <div class="bar">
          <span v-for="part in statusParts" :key="part.tone" class="bar-fill" :class="part.fill" :style="{ width: `${part.share}%` }"></span>
        </div>
        <div v-if="problems.length" class="legend">
          <span v-for="part in problems" :key="part.label" class="legend-item"><span class="swatch" :class="part.fill"></span>{{ part.count }} {{ part.label }}</span>
        </div>
        <div v-else class="stat-meta">{{ environments.length ? 'Nothing needs a look.' : 'None yet.' }}</div>
      </section>

      <section class="card stat">
        <div class="stat-label"><UserRound />Your environments</div>
        <template v-if="capacity?.quota">
          <div class="stat-value">{{ capacity.quota.used }}<small>of {{ capacity.quota.limit }}</small></div>
          <div class="bar"><span class="bar-fill bg-accent" :style="{ width: `${Math.min(100, (capacity.quota.used / capacity.quota.limit) * 100)}%` }"></span></div>
          <div class="stat-meta">
            {{ capacity.quota.remaining > 0 ? `Your quota leaves room for ${capacity.quota.remaining} more.` : 'Your quota is full: delete one to create another.' }}
          </div>
        </template>
        <template v-else>
          <div class="stat-value">{{ mine }}</div>
          <div class="stat-meta">No quota per person on this server.</div>
        </template>
      </section>

      <section class="card stat">
        <div class="stat-label"><MemoryStick />Memory available</div>
        <div class="stat-value">{{ capacity?.host ? formatSize(capacity.host.availableMemoryBytes) : '-' }}</div>
        <div class="stat-meta">
          <template v-if="capacity?.host?.buildGuards?.memoryBytes">Builds wait until {{ formatSize(capacity.host.buildGuards.memoryBytes) }} are free.</template>
          <template v-else-if="capacity?.host">{{ formatSize(capacity.host.freeDiskBytes) }} of disk free.</template>
          <template v-else>The first sample comes 30 seconds after Spawner starts.</template>
        </div>
      </section>

      <section class="card stat">
        <div class="stat-label"><Gauge />Room for</div>
        <div class="stat-value">{{ room.places }}<small v-if="room.places !== '-'">more</small></div>
        <div class="stat-meta">{{ room.detail }}</div>
      </section>
    </div>

    <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section class="card">
        <div class="card-head is-flush">
          <div class="card-title">Recent environments</div>
          <RouterLink to="/environments" class="btn btn-ghost btn-sm">View all<ChevronRight /></RouterLink>
        </div>
        <div v-if="environments.length === 0" class="empty border-t">
          <span class="empty-title">No environment yet</span>
          <span>Create one from the dashboard, or from a worktree with <code>spawner up</code>.</span>
        </div>
        <div v-else class="table-wrap">
          <table class="table">
            <tbody>
              <tr v-for="environment in recent" :key="environment.id">
                <td class="max-w-[14rem]">
                  <RouterLink :to="`/environments/${environment.id}`" class="row-title block">{{ environment.slug }}</RouterLink>
                  <div class="row-sub">
                    <span class="font-medium text-fg-2">{{ environment.project }}</span><span aria-hidden="true">·</span><span>{{ timeAgo(environment.createdAt) }}</span>
                  </div>
                </td>
                <td><EnvironmentStatus :status="environment.status" /></td>
                <td class="hidden max-w-[12rem] xl:table-cell">
                  <SourceLabel v-if="primarySource(environment)" :source="primarySource(environment)!" />
                </td>
                <td class="hidden md:table-cell">
                  <div class="flex items-center gap-2">
                    <UserAvatar v-if="environment.owner" :user="environment.owner" small />
                    <span class="truncate text-fg-2">{{ environment.owner?.name ?? 'Installation token' }}</span>
                  </div>
                </td>
                <td class="cell-actions">
                  <a
                    v-if="environment.url && environment.status === 'ready'"
                    :href="environment.url"
                    target="_blank"
                    rel="noopener"
                    class="btn btn-ghost btn-sm btn-icon"
                    :aria-label="`Open ${environment.slug}`"
                    v-tooltip.top="'Open'"
                  >
                    <ExternalLink />
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="flex min-w-0 flex-col gap-4">
        <section class="card">
          <div class="card-head is-flush">
            <div class="card-title">Projects</div>
            <RouterLink to="/projects" class="btn btn-ghost btn-sm">View all<ChevronRight /></RouterLink>
          </div>
          <div class="list">
            <div v-if="projects.length === 0" class="list-row text-fg-3">{{ authStore.isAdmin ? 'Add a project from the projects page.' : 'An admin adds the projects.' }}</div>
            <RouterLink v-for="project in projects" :key="project.id" :to="`/projects/${project.slug}`" class="list-row hover:bg-surface-hover">
              <span class="project-icon size-8 text-[13px]">{{ project.name.charAt(0).toUpperCase() }}</span>
              <span class="list-main">
                <span class="list-title">{{ project.name }}</span>
                <span class="list-sub">{{ project.environmentCount }} environment{{ project.environmentCount === 1 ? '' : 's' }}</span>
              </span>
              <span v-if="placesOf(project.slug) !== null" class="badge badge-sm" :title="'Environments of this project the server can still hold'">
                {{ placesOf(project.slug) }} more
              </span>
            </RouterLink>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title"><SquareTerminal />From your terminal</div></div>
          <div class="card-body flex flex-col gap-3">
            <p class="text-[13px] text-fg-2">
              The CLI sends your worktree, uncommitted changes included, and waits until its URL answers. Coding agents use the same commands through
              <code>spawner mcp</code>.
            </p>
            <div class="cmd">
              <span class="cmd-text"><span class="text-fg-3">$ </span>spawner up --wait</span>
              <button type="button" class="btn btn-ghost btn-sm btn-icon" aria-label="Copy the command" @click="copy('spawner up --wait')"><Copy /></button>
            </div>
            <RouterLink to="/account" class="link text-[13px]">Install the CLI</RouterLink>
          </div>
        </section>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ChevronRight, Copy, ExternalLink, Gauge, Layers, LoaderCircle, MemoryStick, Plus, SquareTerminal, UserRound } from 'lucide-vue-next';
import EnvironmentStatus from '../components/EnvironmentStatus.vue';
import SourceLabel from '../components/SourceLabel.vue';
import UserAvatar from '../components/UserAvatar.vue';
import { useNotification } from '../composables/useNotification';
import { useServerInfo } from '../composables/useServerInfo';
import { environmentsApi, errorMessage, projectsApi, systemApi } from '../services/api';
import { useAuthStore } from '../stores/auth';
import type { Capacity, Environment, ProjectSummary } from '../types';
import { STATUS_TONES, statusTone, type StatusTone } from '../utils/environment';
import { timeAgo } from '../utils/format';
import { formatSize } from '../utils/palette';

const RECENT = 6;
const FILLS: Record<StatusTone, string> = {
  ready: 'bg-ok',
  degraded: 'bg-warn',
  failed: 'bg-danger',
  busy: 'bg-info',
  sleeping: 'bg-sleep',
  stopped: 'bg-muted',
};
const PROBLEM_LABELS: Partial<Record<StatusTone, string>> = { degraded: 'degraded', failed: 'failed', busy: 'in progress', sleeping: 'asleep' };

const authStore = useAuthStore();
const info = useServerInfo();
const { showError, showSuccess } = useNotification();
const loading = ref(true);
const environments = ref<Environment[]>([]);
const projects = ref<ProjectSummary[]>([]);
const capacity = ref<Capacity | null>(null);

const recent = computed(() => [...environments.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT));
const mine = computed(() => environments.value.filter((environment) => environment.owner?.id === authStore.user?.id).length);

function count(tone: StatusTone): number {
  return environments.value.filter((environment) => statusTone(environment.status) === tone).length;
}

const statusParts = computed(() =>
  (Object.keys(FILLS) as StatusTone[])
    .map((tone) => ({ tone: STATUS_TONES[tone], fill: FILLS[tone], share: environments.value.length ? (count(tone) / environments.value.length) * 100 : 0 }))
    .filter((part) => part.share > 0),
);

const problems = computed(() =>
  (Object.keys(PROBLEM_LABELS) as StatusTone[]).map((tone) => ({ label: PROBLEM_LABELS[tone]!, fill: FILLS[tone], count: count(tone) })).filter((part) => part.count > 0),
);

function primarySource(environment: Environment) {
  return environment.sources.find((source) => source.primary) ?? null;
}

function placesOf(project: string): number | null {
  return capacity.value?.projects.find((entry) => entry.project === project)?.places ?? null;
}

/**
 * More environments the server can hold: those of the only project, or the
 * range from the heaviest project to the lightest.
 */
const room = computed(() => {
  const entries = (capacity.value?.projects ?? []).filter((project) => project.places !== null);
  if (entries.length === 0) {
    return { places: '-', detail: 'Known once the server is sampled and a project exists.' };
  }
  const counts = entries.map((project) => project.places ?? 0);
  const [least, most] = [Math.min(...counts), Math.max(...counts)];
  if (entries.every((entry) => entry.limitedBy === 'quota')) {
    return { places: String(least), detail: 'Environments: your quota is what limits them.' };
  }
  if (entries.length === 1) {
    return { places: String(least), detail: `${entries[0].name} environments${entries[0].limitedBy ? `, limited by the ${entries[0].limitedBy}` : ''}.` };
  }
  return { places: least === most ? String(least) : `${least} to ${most}`, detail: 'Environments, depending on the project.' };
});

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
  showSuccess('Copied');
}

onMounted(async () => {
  try {
    [environments.value, projects.value, capacity.value] = await Promise.all([
      environmentsApi.list(),
      projectsApi.list(),
      systemApi.capacity().catch(() => null),
    ]);
  } catch (err) {
    showError(errorMessage(err, 'The overview could not be loaded'));
  } finally {
    loading.value = false;
  }
});
</script>
